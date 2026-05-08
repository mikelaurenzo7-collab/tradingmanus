import "dotenv/config";
import { createServer } from "http";
import net from "net";
import { createApp, scopeScheduledUsersToTrigger } from "./app";
import { serveStatic, setupVite } from "./vite";
import { getUsersEligibleForAutomaticScheduledTrading } from "../db";
import { runScheduledAutonomousTradingBatch } from "./kalshiAutonomy";
import { runPolymarketAutonomousTrading } from "./polymarketAutonomy";
import { syncPendingOrders, syncLivePositions } from "./kalshiOrderSync";
import { evaluateExitsForOpenPositions } from "./exitMonitor";
import { evaluatePolymarketExitsForOpenPositions } from "./polymarketExitMonitor";
import { syncPolymarketPositions } from "./polymarketPositionSync";
import { createAutonomousTradingLock, createOrderSyncLock, DistributedLock } from "./distributedLock";
import { runStartupSelfTest } from "./startupSelfTest";
import { checkBudgetForRun } from "./aiCostBudget";
import { refreshScoreboard } from "./dailyScoreboard";
import { logger } from "./logger";
import * as hb from "./schedulerHeartbeat";
import { hasAnyDualConnectedUser } from "../db";

// 60-second cache for "any user has both Kalshi + Polymarket connected".
// The cross-arb scheduler ticks every 10s; without this we'd hit the DB
// 6 times a minute for a question whose answer almost never changes.
let _dualConnectedCache: { value: boolean; expiresAt: number } | null = null;
async function isDualConnectedCached(): Promise<boolean> {
  const now = Date.now();
  if (_dualConnectedCache && now < _dualConnectedCache.expiresAt) {
    return _dualConnectedCache.value;
  }
  let value = false;
  try {
    value = await hasAnyDualConnectedUser();
  } catch (err) {
    logger.warn({ err }, "[CrossArb] dual-connected probe failed; assuming false");
  }
  _dualConnectedCache = { value, expiresAt: now + 60_000 };
  return value;
}
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

// All scheduler intervals are env-tunable so the operator can dial cadence
// against AI cost.  Each Kalshi+Polymarket cycle issues 1-3 reviewer calls
// per active desk on average — adaptive cadence skips ~70-85 % of stale
// candidates so most ticks make zero AI calls.
function envIntervalMs(name: string, fallbackMs: number): number {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallbackMs;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1000) return fallbackMs;
  return parsed;
}
// Default 60 s: the cron tick rate.  This is the *opportunity* cadence;
// adaptive cadence (server/_core/adaptiveCadence.ts) decides which markets
// actually go to the reviewer on any given tick based on price movement +
// per-category staleness TTL.  60 s captures fast-moving sports/crypto
// alpha that persists only 1-3 minutes after a catalyst, while the
// adaptive layer keeps AI cost bounded by skipping quiet markets.
//
// Tune via env:
//   AUTONOMY_INTERVAL_MS=30000   → 30 s (max alpha, near-realtime markets)
//   AUTONOMY_INTERVAL_MS=60000   → 1 min (default — balanced)
//   AUTONOMY_INTERVAL_MS=120000  → 2 min (cost-conservative)
const AUTONOMOUS_TRADING_INTERVAL_MS = envIntervalMs("AUTONOMY_INTERVAL_MS", 60 * 1000);
const ORDER_SYNC_INTERVAL_MS = envIntervalMs("ORDER_SYNC_INTERVAL_MS", 30 * 1000);
const CROSS_PLATFORM_ARB_INTERVAL_MS = envIntervalMs("CROSS_ARB_INTERVAL_MS", 10 * 1000);
const POLYMARKET_MARKET_LIMIT = 80;

async function runAutonomousScheduler() {
  const startedAt = Date.now();
  hb.markTickStart("autonomy_kalshi", "scanning", "Checking eligibility");
  try {
    const eligibleUsers = await getUsersEligibleForAutomaticScheduledTrading();
    // The local scheduler now runs autonomy for every eligible user.
    // Eligibility was already filtered server-side (live trading enabled
    // + autonomy mode != manual + cadence != manual_only + credentials
    // connected), so this list is "everyone who's configured + opted in".
    const scopedUsers = scopeScheduledUsersToTrigger(
      eligibleUsers as Array<{ id: number; openId: string; email?: string | null }>,
      "local_scheduler"
    );

    if (scopedUsers.length === 0) {
      hb.setSkipped("autonomy_kalshi", "no eligible users (live trading disarmed or autonomy=manual)");
      return;
    }

    // Refresh the pay-for-yourself scoreboard before consulting the budget
    // throttle.  Scoreboard + AI cost budget are PROCESS-LEVEL counters
    // (single env-configured cap shared across users), so we sample once
    // per tick rather than per user.  When multi-user volume becomes
    // material, switch to per-user scoreboards keyed by userId.
    const firstUser = scopedUsers[0];
    if (firstUser) await refreshScoreboard(firstUser.id);

    // AI daily cost budget gate.  No-op when AI_DAILY_BUDGET_USD is unset.
    // Profitable days never throttle; losing days self-throttle as the
    // deficit widens.  Cold-start exemption: under $5 AI spend, no throttle.
    const budget = checkBudgetForRun();
    if (!budget.proceed) {
      logger.warn(
        {
          spentUsd: Number(budget.spentUsd.toFixed(4)),
          effectiveOverrunUsd: Number(budget.effectiveOverrunUsd.toFixed(4)),
          capUsd: budget.capUsd,
          fractionSpent: Number(budget.fractionSpent.toFixed(3)),
          reason: budget.reason,
        },
        "[Scheduler] Pay-for-yourself overrun exceeded daily cap; Kalshi autonomy skipping until UTC rollover",
      );
      hb.setBlocked(
        "autonomy_kalshi",
        `AI daily budget overrun (${Math.round(budget.fractionSpent * 100)}%) — ${budget.reason}`,
      );
      return;
    }

    // Per-user locks: each user's autonomy run is serialised against
    // itself so two concurrent ticks for the same user can't race.
    // Across users, runs proceed in parallel.
    const userIds = scopedUsers.map((u) => u.id);
    const locks = await Promise.all(
      userIds.map(async (id) => {
        const lock = createAutonomousTradingLock(id);
        const acquired = await lock.acquire({ ttlMs: 5 * 60 * 1000 });
        return { id, lock, acquired };
      }),
    );
    const lockedUsers = scopedUsers.filter((u) =>
      locks.find((l) => l.id === u.id)?.acquired,
    );
    const skippedCount = scopedUsers.length - lockedUsers.length;
    if (skippedCount > 0) {
      logger.info(
        { skippedCount, runningCount: lockedUsers.length },
        "[Scheduler] %d user(s) already had a run in progress; skipped",
        skippedCount,
      );
    }
    if (lockedUsers.length === 0) {
      hb.setSkipped("autonomy_kalshi", `${skippedCount} user(s) already running`);
      return;
    }

    try {
      hb.setActivity("autonomy_kalshi", "evaluating", `Reviewing markets for ${lockedUsers.length} user(s)`);
      logger.info(
        { userCount: lockedUsers.length },
        "[Scheduler] Running autonomous trading for %d eligible user(s)",
        lockedUsers.length,
      );
      const batchResult = await runScheduledAutonomousTradingBatch(lockedUsers as any, "local_scheduler");
      hb.recordTickTelemetry("autonomy_kalshi", {
        ordersPlaced: batchResult.executedUsers,
      });
      if (batchResult.executedUsers > 0) {
        hb.setActivity("autonomy_kalshi", "placing", `Placed orders for ${batchResult.executedUsers} user(s)`);
      }
    } finally {
      await Promise.all(
        locks.filter((l) => l.acquired).map((l) => l.lock.release()),
      );
    }
  } catch (error) {
    logger.error({ err: error }, "[Scheduler] Autonomous trading run failed");
    hb.setError("autonomy_kalshi", error);
  } finally {
    hb.markTickComplete("autonomy_kalshi", startedAt);
  }
}

// Polymarket runs on the same cadence as Kalshi but has its own per-user
// lock (`polymarket_autonomy_user_${id}`) so a slow Polymarket cycle never
// blocks the next Kalshi cycle (or vice-versa).  runPolymarketAutonomous-
// Trading internally guards subscription, credentials, and the in-process
// withUserLock around the risk-check → place sequence.
async function runPolymarketAutonomousScheduler() {
  const startedAt = Date.now();
  hb.markTickStart("autonomy_polymarket", "scanning", "Checking Polymarket eligibility");
  try {
    const eligibleUsers = await getUsersEligibleForAutomaticScheduledTrading();
    const scopedUsers = scopeScheduledUsersToTrigger(
      eligibleUsers as Array<{ id: number; openId: string; email?: string | null }>,
      "local_scheduler"
    );

    if (scopedUsers.length === 0) {
      hb.setSkipped("autonomy_polymarket", "no eligible users");
      return;
    }

    // Pay-for-yourself scoreboard refresh before the budget gate.  Single
    // process-level cap shared across users — sample once per tick.
    const firstUser = scopedUsers[0];
    if (firstUser) await refreshScoreboard(firstUser.id);

    const budget = checkBudgetForRun();
    if (!budget.proceed) {
      logger.warn(
        {
          spentUsd: Number(budget.spentUsd.toFixed(4)),
          effectiveOverrunUsd: Number(budget.effectiveOverrunUsd.toFixed(4)),
          capUsd: budget.capUsd,
          fractionSpent: Number(budget.fractionSpent.toFixed(3)),
          reason: budget.reason,
        },
        "[PolymarketScheduler] Pay-for-yourself overrun exceeded daily cap; Polymarket autonomy skipping until UTC rollover",
      );
      hb.setBlocked(
        "autonomy_polymarket",
        `AI daily budget overrun (${Math.round(budget.fractionSpent * 100)}%)`,
      );
      return;
    }

    hb.setActivity("autonomy_polymarket", "evaluating", `Reviewing markets for ${scopedUsers.length} user(s)`);

    // Per-user lock + run, in parallel across users.  runPolymarket-
    // AutonomousTrading internally guards credentials + uses withUserLock
    // around the risk-check → place sequence.
    const runs = await Promise.all(
      scopedUsers.map(async (user) => {
        const lock = new DistributedLock(`polymarket_autonomy_user_${user.id}`);
        const acquired = await lock.acquire({ ttlMs: 5 * 60 * 1000 });
        if (!acquired) {
          return { userId: user.id, skipped: true as const };
        }
        try {
          const result = await runPolymarketAutonomousTrading(user.id, {
            triggeredByOpenId: "local_scheduler",
          });
          return { userId: user.id, skipped: false as const, result };
        } finally {
          await lock.release();
        }
      }),
    );
    let placedCount = 0;
    for (const run of runs) {
      if (run.skipped) {
        logger.info({ userId: run.userId }, "[PolymarketScheduler] previous run still in progress; skipped this user");
      } else {
        if (run.result.orderPlaced) placedCount += 1;
        logger.info(
          { userId: run.userId, status: run.result.status, orderPlaced: run.result.orderPlaced },
          "[PolymarketScheduler] run complete",
        );
      }
    }
    hb.recordTickTelemetry("autonomy_polymarket", { ordersPlaced: placedCount });
  } catch (error) {
    logger.error({ err: error }, "[PolymarketScheduler] Polymarket autonomous run failed");
    hb.setError("autonomy_polymarket", error);
  } finally {
    hb.markTickComplete("autonomy_polymarket", startedAt);
  }
}

async function runOrderSync() {
  const startedAt = Date.now();
  hb.markTickStart("order_sync", "syncing", "Reconciling positions + checking exits");
  try {
    const eligibleUsers = await getUsersEligibleForAutomaticScheduledTrading();
    const scopedUsers = scopeScheduledUsersToTrigger(
      eligibleUsers as Array<{ id: number; openId: string; email?: string | null }>,
      "local_scheduler"
    );

    if (scopedUsers.length === 0) {
      hb.setSkipped("order_sync", "no eligible users");
      return;
    }

    let exitTriggered = 0;
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
        // Reconcile Polymarket positions against the data-api before the
        // exit monitor runs.  This catches manual UI closes (otherwise
        // the exit monitor would re-attempt to close a vanished position
        // every cycle) and refreshes mark prices on rows we already hold.
        // Silently no-ops when POLYMARKET_OWNER_ADDRESS is unset.
        const polymarketSync = await syncPolymarketPositions(user.id);
        if (polymarketSync.closedDriftCount > 0) {
          logger.info(
            {
              userId: user.id,
              closedDriftCount: polymarketSync.closedDriftCount,
              positionIds: polymarketSync.closedDriftPositionIds,
            },
            "[PolymarketSync] %d local position(s) closed due to drift from data-api",
            polymarketSync.closedDriftCount,
          );
        }
        // Evaluate stop-loss / profit-target on every open position with each
        // sync.  Inside the same lock so a concurrent autonomy run can't read
        // a half-closed position state.
        const [kalshiExits, polymarketExits] = await Promise.all([
          evaluateExitsForOpenPositions(user.id, "local_scheduler"),
          evaluatePolymarketExitsForOpenPositions(user.id, "local_scheduler"),
        ]);
        const kTriggered = kalshiExits.filter((e) => e.decision.shouldExit);
        const pTriggered = polymarketExits.filter((e) => e.decision.shouldExit);
        exitTriggered += kTriggered.length + pTriggered.length;
        if (kTriggered.length > 0) {
          logger.info(
            { userId: user.id, count: kTriggered.length, closed: kTriggered.filter((e) => e.closed).length },
            "[ExitMonitor] Kalshi: %d exit signal(s) triggered for user %d",
            kTriggered.length,
            user.id,
          );
        }
        if (pTriggered.length > 0) {
          logger.info(
            { userId: user.id, count: pTriggered.length, closed: pTriggered.filter((e) => e.closed).length },
            "[PolymarketExitMonitor] %d exit signal(s) triggered for user %d",
            pTriggered.length,
            user.id,
          );
        }
      } catch (err) {
        logger.error({ err, userId: user.id }, "[OrderSync] Sync failed for user %d", user.id);
      } finally {
        await lock.release();
      }
    }
    hb.recordTickTelemetry("order_sync", { ordersPlaced: exitTriggered });
  } catch (error) {
    logger.error({ err: error }, "[OrderSync] Order sync run failed");
    hb.setError("order_sync", error);
  } finally {
    hb.markTickComplete("order_sync", startedAt);
  }
}

// In-flight guard for the 10-second realtime arb scanner.  Without this,
// a slow exchange (Kalshi or Polymarket > 10 s) would let the next interval
// fire on top of the in-flight scan, producing a connection storm and
// tripping the circuit breakers.
let crossArbScanInFlight = false;

async function runRealtimeCrossPlatformArbScan() {
  if (crossArbScanInFlight) {
    hb.setSkipped("cross_arb", "previous scan still in flight");
    return;
  }
  // Don't waste fetch quota when no user has both Kalshi AND Polymarket
  // connected — cross-arb has no actionable value for single-platform
  // users.  Cache the gate for 60 s so we don't re-query the DB every
  // 10 s tick when the answer obviously isn't going to flip.
  const dualConnected = await isDualConnectedCached();
  if (!dualConnected) {
    hb.markTickStart("cross_arb", "skipped", "No user has both Kalshi + Polymarket connected");
    hb.setSkipped("cross_arb", "no dual-connected user — cross-arb has nothing to act on");
    hb.markTickComplete("cross_arb", Date.now());
    return;
  }
  crossArbScanInFlight = true;
  const startedAt = Date.now();
  hb.markTickStart("cross_arb", "scanning", "Scanning Kalshi ↔ Polymarket for arb");
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
    hb.recordTickTelemetry("cross_arb", {
      marketsScanned: kalshiMarkets.length + polymarketMarkets.length,
      ordersPlaced: opportunities.length,
    });
  } catch (error) {
    logger.warn({ err: error }, "[CrossArb] realtime scan failed");
    hb.setError("cross_arb", error);
  } finally {
    crossArbScanInFlight = false;
    hb.markTickComplete("cross_arb", startedAt);
  }
}

startServer()
  .then(async () => {
    // Pre-flight: surface mis-configurations LOUDLY before any autonomy
    // cycle places real orders.  In production, FAILs prevent the
    // schedulers from arming but the HTTP server keeps serving — this
    // way the dashboard stays reachable so the operator can see the
    // problem and fix it (Railway env var, db:push, etc.) without a
    // crash-loop hiding the diagnostic in restart noise.
    const selfTest = await runStartupSelfTest();
    const failedChecks = selfTest.checks.filter((c) => c.status === "fail");
    const schedulersArmed = selfTest.passed || process.env.NODE_ENV !== "production";

    if (!schedulersArmed) {
      logger.error(
        { failed: failedChecks.map((c) => c.name) },
        "[Startup] Self-test FAILED in production — schedulers will NOT arm.  HTTP server stays up so /api/health/* and the dashboard remain reachable.  Fix the failures above (most commonly: set ANTHROPIC_API_KEY, run `pnpm db:push`, set DATABASE_URL) and redeploy.",
      );
    } else {
      // Tell the heartbeat tracker what the actual configured intervals are
      // so the dashboard "next tick ETA" badge is accurate rather than the
      // 60/30/10 s defaults baked into schedulerHeartbeat.ts.
      hb.configureSchedulerInterval("autonomy_kalshi", AUTONOMOUS_TRADING_INTERVAL_MS);
      hb.configureSchedulerInterval("autonomy_polymarket", AUTONOMOUS_TRADING_INTERVAL_MS);
      hb.configureSchedulerInterval("order_sync", ORDER_SYNC_INTERVAL_MS);
      hb.configureSchedulerInterval("cross_arb", CROSS_PLATFORM_ARB_INTERVAL_MS);

      setInterval(runAutonomousScheduler, AUTONOMOUS_TRADING_INTERVAL_MS);
      setInterval(runPolymarketAutonomousScheduler, AUTONOMOUS_TRADING_INTERVAL_MS);
      setInterval(runOrderSync, ORDER_SYNC_INTERVAL_MS);
      setInterval(runRealtimeCrossPlatformArbScan, CROSS_PLATFORM_ARB_INTERVAL_MS);

      // Daily auditLog retention sweep (default 90 days).  Runs once now to
      // claw back any backlog and then every 24 hours.  Fire-and-forget; a
      // cleanup failure must never block the schedulers.
      const auditRetentionDays = Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? 90);
      const runAuditCleanup = async () => {
        try {
          const { cleanupOldAuditLogEntries } = await import("../db");
          const { deleted } = await cleanupOldAuditLogEntries(auditRetentionDays);
          if (deleted > 0) {
            logger.info(
              { deleted, retentionDays: auditRetentionDays },
              "[AuditCleanup] purged %d row(s) older than %d days",
              deleted,
              auditRetentionDays,
            );
          }
        } catch (err) {
          logger.warn({ err }, "[AuditCleanup] sweep failed");
        }
      };
      void runAuditCleanup();
      setInterval(runAuditCleanup, 24 * 60 * 60 * 1000);
      // Kick off the first Kalshi + Polymarket runs ~30s after boot so they
      // don't both hit the AI reviewer simultaneously on startup.
      setTimeout(runAutonomousScheduler, 30 * 1000);
      setTimeout(runPolymarketAutonomousScheduler, 60 * 1000);
      const autonomyMin = (AUTONOMOUS_TRADING_INTERVAL_MS / 60_000).toFixed(1);
      const orderSyncSec = (ORDER_SYNC_INTERVAL_MS / 1_000).toFixed(0);
      const crossArbSec = (CROSS_PLATFORM_ARB_INTERVAL_MS / 1_000).toFixed(0);
      logger.info("[Scheduler] Kalshi autonomy started (%s-min interval)", autonomyMin);
      logger.info("[PolymarketScheduler] Polymarket autonomy started (%s-min interval)", autonomyMin);
      logger.info("[OrderSync] Order sync started (%s-sec interval)", orderSyncSec);
      logger.info("[CrossArb] Realtime scanner started (%s-sec interval)", crossArbSec);
    }
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
