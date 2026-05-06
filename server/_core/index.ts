import "dotenv/config";
import { createServer } from "http";
import net from "net";
import { createApp, scopeScheduledUsersToTrigger } from "./app";
import { serveStatic, setupVite } from "./vite";
import { getUsersEligibleForAutomaticScheduledTrading } from "../db";
import { runScheduledAutonomousTradingBatch } from "./kalshiAutonomy";
import { syncPendingOrders, syncLivePositions } from "./kalshiOrderSync";
import { createAutonomousTradingLock, createOrderSyncLock } from "./distributedLock";
import { logger } from "./logger";
import { fetchKalshiMarkets } from "./kalshiMarketData";
import { fetchPolymarketMarkets } from "./polymarketAuth";
import {
  detectCrossPlatformArbitrage,
  summariseCrossPlatformOpportunities,
} from "./crossPlatformArbitrage";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = await createApp({ runStartupMigrations: false });
  const server = createServer(app);

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // PaaS contract: when `PORT` is provided (Railway, Render, Fly, Heroku,
  // Cloud Run, etc.) we MUST listen on exactly that port, on `0.0.0.0`.
  // Probing for a "free" alternate port is dangerous on those platforms:
  //   • the probe + bind sequence has a race window where the port can be
  //     considered busy and we silently fall back to a port the platform's
  //     ingress cannot route to (manifests as "Application failed to
  //     respond" while our logs say the server is up); and
  //   • IPv6/IPv4 dual-stack quirks make the probe bind one family while
  //     the real listener picks the other.
  // We only fall back to alternate-port discovery in local dev where the
  // port might genuinely be in use by another instance of the same dev
  // server.
  const portFromEnv = process.env.PORT;
  const inProduction = process.env.NODE_ENV === "production";
  const host = process.env.HOST || "0.0.0.0";

  let port: number;
  if (portFromEnv) {
    const parsed = parseInt(portFromEnv, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
      throw new Error(`Invalid PORT environment variable: ${portFromEnv}`);
    }
    port = parsed;
  } else if (inProduction) {
    // Production with no PORT set is almost certainly a misconfigured
    // deployment — fail loudly so the platform restarts us instead of
    // running a zombie process the operator can't reach.
    throw new Error("PORT environment variable must be set in production");
  } else {
    port = await findAvailablePort(3000);
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      logger.info({ host, port }, "Server running on http://%s:%d/", host, port);
      resolve();
    });
  });
}

const AUTONOMOUS_TRADING_INTERVAL_MS = 15 * 60 * 1000;
const ORDER_SYNC_INTERVAL_MS = 30 * 1000;
const CROSS_PLATFORM_ARB_INTERVAL_MS = 10 * 1000;
const POLYMARKET_MARKET_LIMIT = 80;

async function runAutonomousScheduler() {
  try {
    const eligibleUsers = await getUsersEligibleForAutomaticScheduledTrading();
    // Mirror the HTTP handler: scope to the configured owner only.
    const scopedUsers = scopeScheduledUsersToTrigger(
      eligibleUsers as Array<{ id: number; openId: string; email?: string | null }>,
      "local_scheduler"
    );

    const ownerUser = scopedUsers[0];
    if (!ownerUser) return;

    const lock = createAutonomousTradingLock(ownerUser.id);
    const acquired = await lock.acquire({ ttlMs: 5 * 60 * 1000 });
    if (!acquired) {
      logger.info("[Scheduler] Autonomous trading already in progress, skipping");
      return;
    }

    try {
      logger.info({ userCount: scopedUsers.length }, "[Scheduler] Running autonomous trading for %d eligible user(s)", scopedUsers.length);
      await runScheduledAutonomousTradingBatch(scopedUsers as any, "local_scheduler");
    } finally {
      await lock.release();
    }
  } catch (error) {
    logger.error({ err: error }, "[Scheduler] Autonomous trading run failed");
  }
}

async function runOrderSync() {
  try {
    const eligibleUsers = await getUsersEligibleForAutomaticScheduledTrading();
    const scopedUsers = scopeScheduledUsersToTrigger(
      eligibleUsers as Array<{ id: number; openId: string; email?: string | null }>,
      "local_scheduler"
    );

    for (const user of scopedUsers as Array<{ id: number; openId: string }>) {
      const lock = createOrderSyncLock(user.id);
      const acquired = await lock.acquire({ ttlMs: 60 * 1000 });
      if (!acquired) {
        logger.info({ userId: user.id }, "[OrderSync] Sync already in progress for user %d, skipping", user.id);
        continue;
      }

      try {
        await syncPendingOrders(user.id);
        await syncLivePositions(user.id);
      } catch (err) {
        logger.error({ err, userId: user.id }, "[OrderSync] Sync failed for user %d", user.id);
      } finally {
        await lock.release();
      }
    }
  } catch (error) {
    logger.error({ err: error }, "[OrderSync] Order sync run failed");
  }
}

// In-flight guard for the 10-second realtime arb scanner.  Without this,
// a slow exchange (Kalshi or Polymarket > 10 s) would let the next interval
// fire on top of the in-flight scan, producing a connection storm and
// tripping the circuit breakers.
let crossArbScanInFlight = false;

async function runRealtimeCrossPlatformArbScan() {
  if (crossArbScanInFlight) {
    return;
  }
  crossArbScanInFlight = true;
  try {
    const [rawKalshi, rawPolymarket] = await Promise.all([
      fetchKalshiMarkets({ status: "open" }),
      fetchPolymarketMarkets({ limit: POLYMARKET_MARKET_LIMIT }),
    ]);

    const kalshiMarkets = rawKalshi
      .filter((m) => m.status === "open")
      .map((m) => ({
        marketId: m.id,
        title: m.title,
        category: m.category,
        yesPrice: Number(m.yesPrice ?? 0),
        noPrice: Number(m.noPrice ?? 0),
        liquidity: Number(m.yesVolume ?? 0) + Number(m.noVolume ?? 0),
      }));

    const polymarketMarkets = rawPolymarket.map((m) => ({
      marketId: m.marketId,
      question: m.question,
      category: m.category,
      yesPrice: m.tokens.find((t) => t.outcome.toLowerCase() === "yes")?.price ?? m.impliedProbabilityYes,
      noPrice: m.tokens.find((t) => t.outcome.toLowerCase() === "no")?.price ?? (1 - m.impliedProbabilityYes),
      liquidity: m.liquidity,
    }));

    const opportunities = detectCrossPlatformArbitrage(kalshiMarkets, polymarketMarkets, {
      minSimilarity: 0.35,
      minSpread: 0.03,
      minLiquidity: 100,
      minNetEdge: 0.05,
    });

    if (opportunities.length > 0) {
      const summary = summariseCrossPlatformOpportunities(opportunities);
      logger.info(
        {
          opportunities: summary.total,
          topNetEdge: summary.topNetEdge,
          avgConfidence: summary.avgConfidence,
        },
        "[CrossArb] realtime scan found %d opportunity(ies)",
        summary.total,
      );
    }
  } catch (error) {
    logger.warn({ err: error }, "[CrossArb] realtime scan failed");
  } finally {
    crossArbScanInFlight = false;
  }
}

startServer()
  .then(() => {
    setInterval(runAutonomousScheduler, AUTONOMOUS_TRADING_INTERVAL_MS);
    setInterval(runOrderSync, ORDER_SYNC_INTERVAL_MS);
    setInterval(runRealtimeCrossPlatformArbScan, CROSS_PLATFORM_ARB_INTERVAL_MS);
    setTimeout(runAutonomousScheduler, 2 * 60 * 1000);
    logger.info("[Scheduler] Autonomous trading scheduler started (15-min interval)");
    logger.info("[OrderSync] Order sync started (30-sec interval)");
    logger.info("[CrossArb] Realtime scanner started (10-sec interval)");
  })
  .catch((error) => {
    // Crash hard so the platform's restart policy kicks in. Logging only and
    // staying alive leaves a zombie process that fails every health-check —
    // the exact "Application failed to respond" symptom we keep seeing.
    logger.fatal({ err: error }, "[Startup] Fatal error during server start");
    process.exit(1);
  });

// Surface unhandled rejections / uncaught exceptions in the long-running
// process so they appear in the Railway log stream instead of being silently
// dropped (which can mask scheduler or DB issues until the next restart).
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "[Process] unhandledRejection");
});
process.on("uncaughtException", (error) => {
  logger.error({ err: error }, "[Process] uncaughtException");
});
