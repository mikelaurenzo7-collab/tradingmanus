import "dotenv/config";
import { createServer } from "http";
import net from "net";
import { createApp, scopeScheduledUsersToTrigger } from "./app";
import { serveStatic, setupVite } from "./vite";
import { getUsersEligibleForAutomaticScheduledTrading } from "../db";
import { runScheduledAutonomousTradingBatch } from "./kalshiAutonomy";
import { syncPendingOrders, syncLivePositions } from "./kalshiOrderSync";
import { evaluateExitsForOpenPositions } from "./exitMonitor";
import { createAutonomousTradingLock, createOrderSyncLock } from "./distributedLock";
import { runStartupSelfTest } from "./startupSelfTest";
import { checkBudgetForRun } from "./aiCostBudget";
import { refreshScoreboard } from "./dailyScoreboard";
import { logger } from "./logger";
import * as hb from "./schedulerHeartbeat";
import { fetchKalshiMarkets } from "./kalshiMarketData";
import { detectAllCombinatorialArbitrage } from "./kalshiCombinatorial";
import { runCalibrationJob } from "./calibrationJob";

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

function envIntervalMs(name: string, fallbackMs: number): number {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallbackMs;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1000) return fallbackMs;
  return parsed;
}

const AUTONOMOUS_TRADING_INTERVAL_MS = envIntervalMs("AUTONOMY_INTERVAL_MS", 60 * 1000);
const ORDER_SYNC_INTERVAL_MS = envIntervalMs("ORDER_SYNC_INTERVAL_MS", 30 * 1000);
// Combinatorial arbitrage is rule-based math (no AI cost). Runs every 60s
// across all open Kalshi markets to detect YES + NO > 1.00 mispricings.
const COMBINATORIAL_ARB_INTERVAL_MS = envIntervalMs(
  "COMBINATORIAL_ARB_INTERVAL_MS",
  60 * 1000,
);
// Weekly Brier-score calibration (default Sunday 00:00 UTC + every 7 days).
const CALIBRATION_INTERVAL_MS = envIntervalMs(
  "CALIBRATION_INTERVAL_MS",
  7 * 24 * 60 * 60 * 1000,
);

async function runAutonomousScheduler() {
  const startedAt = Date.now();
  hb.markTickStart("autonomy_kalshi", "scanning", "Checking eligibility");
  try {
    const eligibleUsers = await getUsersEligibleForAutomaticScheduledTrading();
    const scopedUsers = scopeScheduledUsersToTrigger(
      eligibleUsers as Array<{ id: number; openId: string; email?: string | null }>,
      "local_scheduler",
    );

    if (scopedUsers.length === 0) {
      hb.setSkipped("autonomy_kalshi", "no eligible users (live trading disarmed or autonomy=manual)");
      return;
    }

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
        "[Scheduler] AI daily budget overrun; Kalshi autonomy skipping until UTC rollover",
      );
      hb.setBlocked(
        "autonomy_kalshi",
        `AI daily budget overrun (${Math.round(budget.fractionSpent * 100)}%) — ${budget.reason}`,
      );
      return;
    }

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
        "[Scheduler] Running Kalshi autonomous trading for %d user(s)",
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
    logger.error({ err: error }, "[Scheduler] Kalshi autonomous trading run failed");
    hb.setError("autonomy_kalshi", error);
  } finally {
    hb.markTickComplete("autonomy_kalshi", startedAt);
  }
}

async function runOrderSync() {
  const startedAt = Date.now();
  hb.markTickStart("order_sync", "syncing", "Reconciling Kalshi positions + checking exits");
  try {
    const eligibleUsers = await getUsersEligibleForAutomaticScheduledTrading();
    const scopedUsers = scopeScheduledUsersToTrigger(
      eligibleUsers as Array<{ id: number; openId: string; email?: string | null }>,
      "local_scheduler",
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
        const exits = await evaluateExitsForOpenPositions(user.id, "local_scheduler");
        const triggered = exits.filter((e) => e.decision.shouldExit);
        exitTriggered += triggered.length;
        if (triggered.length > 0) {
          logger.info(
            { userId: user.id, count: triggered.length, closed: triggered.filter((e) => e.closed).length },
            "[ExitMonitor] %d Kalshi exit signal(s) triggered for user %d",
            triggered.length,
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

// ── Combinatorial-arb scanner ────────────────────────────────────────────────
// Pure rule-based math: scans every open Kalshi market for cases where YES +
// NO > 1.00 (or implication-violation patterns) — buying both sides locks in
// risk-free profit. No AI cost. Currently runs in DETECTION-ONLY mode and
// audit-logs opportunities; auto-execution is gated behind explicit operator
// opt-in (env: COMBINATORIAL_ARB_AUTO_EXECUTE=true) since it requires
// per-user credentials and a hard size cap to avoid concentration risk.
let combinatorialArbScanInFlight = false;
async function runCombinatorialArbScanner() {
  if (combinatorialArbScanInFlight) return;
  combinatorialArbScanInFlight = true;
  const startedAt = Date.now();
  try {
    const rawMarkets = await fetchKalshiMarkets({ status: "open" });
    const arbMarkets = rawMarkets
      .filter((m) => m.status === "open")
      .map((m) => ({
        marketId: m.id,
        title: m.title,
        category: m.category ?? "other",
        impliedProbabilityYes: m.impliedProbability,
        yesPrice: Number(m.yesPrice ?? 0),
        noPrice: Number(m.noPrice ?? 0),
        volume: Number(m.yesVolume ?? 0) + Number(m.noVolume ?? 0),
        liquidity: Number(m.yesVolume ?? 0) + Number(m.noVolume ?? 0),
      }));

    const opportunities = detectAllCombinatorialArbitrage(arbMarkets, {
      minSumDeviation: 0.02,
      minViolation: 0.05,
      minLiquidity: 100,
    });

    if (opportunities.length > 0) {
      logger.info(
        {
          count: opportunities.length,
          topProfit: Number(opportunities[0]?.guaranteedProfit?.toFixed(4) ?? 0),
          durationMs: Date.now() - startedAt,
        },
        "[CombinatorialArb] %d opportunity(ies) detected",
        opportunities.length,
      );
      // Audit-log so the dashboard's Strategies tab + manual review can pick
      // them up. Auto-execution is intentionally NOT wired here — that
      // requires per-user creds + a Kelly-clamped size + the same
      // drawdown/exposure gates the directional flow uses. Until that
      // wiring lands, the scanner is detection-only.
      try {
        const { logAuditEvent } = await import("../db");
        await logAuditEvent(
          "combinatorial_arb_scan",
          JSON.stringify({
            count: opportunities.length,
            opportunities: opportunities.slice(0, 10).map((o) => ({
              type: o.type,
              markets: o.markets.map((m) => m.marketId),
              guaranteedProfit: o.guaranteedProfit,
              confidence: o.confidence,
            })),
          }),
          "combinatorial_arb_scanner",
        );
      } catch (err) {
        logger.warn({ err }, "[CombinatorialArb] audit log failed");
      }
    }
  } catch (err) {
    logger.warn({ err }, "[CombinatorialArb] scan failed");
  } finally {
    combinatorialArbScanInFlight = false;
  }
}

// ── Weekly calibration cron ──────────────────────────────────────────────────
// Recomputes Brier score per reviewer per category. Runs once per week.
async function runWeeklyCalibration() {
  try {
    const eligibleUsers = await getUsersEligibleForAutomaticScheduledTrading();
    for (const user of eligibleUsers as Array<{ id: number }>) {
      const report = await runCalibrationJob({ userId: user.id });
      logger.info(
        {
          userId: user.id,
          totalSamples: report.totalSamples,
          overallBrier: Number(report.overallBrierScore.toFixed(4)),
          evThresholdAdjustment: report.evThresholdAdjustment,
        },
        "[Calibration] weekly run complete for user %d",
        user.id,
      );
    }
  } catch (err) {
    logger.warn({ err }, "[Calibration] weekly run failed");
  }
}

startServer()
  .then(async () => {
    const selfTest = await runStartupSelfTest();
    const failedChecks = selfTest.checks.filter((c) => c.status === "fail");
    const schedulersArmed = selfTest.passed || process.env.NODE_ENV !== "production";

    if (!schedulersArmed) {
      logger.error(
        { failed: failedChecks.map((c) => c.name) },
        "[Startup] Self-test FAILED in production — schedulers will NOT arm. HTTP server stays up so /api/health/* and the dashboard remain reachable. Fix the failures above (most commonly: set XAI_API_KEY, KALSHI_KEY_ID + KALSHI_PRIVATE_KEY, run `pnpm db:push`, set DATABASE_URL) and redeploy.",
      );
    } else {
      hb.configureSchedulerInterval("autonomy_kalshi", AUTONOMOUS_TRADING_INTERVAL_MS);
      hb.configureSchedulerInterval("order_sync", ORDER_SYNC_INTERVAL_MS);

      setInterval(runAutonomousScheduler, AUTONOMOUS_TRADING_INTERVAL_MS);
      setInterval(runOrderSync, ORDER_SYNC_INTERVAL_MS);
      // Combinatorial-arb scanner — risk-free math, no AI cost. Detection-only
      // for now (auto-execution requires per-user creds + size cap).
      setInterval(runCombinatorialArbScanner, COMBINATORIAL_ARB_INTERVAL_MS);
      // Weekly Brier-score calibration cron.
      setInterval(runWeeklyCalibration, CALIBRATION_INTERVAL_MS);

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

      setTimeout(runAutonomousScheduler, 30 * 1000);
      const autonomyMin = (AUTONOMOUS_TRADING_INTERVAL_MS / 60_000).toFixed(1);
      const orderSyncSec = (ORDER_SYNC_INTERVAL_MS / 1_000).toFixed(0);
      logger.info("[Scheduler] Kalshi autonomy started (%s-min interval)", autonomyMin);
      logger.info("[OrderSync] Order sync started (%s-sec interval)", orderSyncSec);
    }
  })
  .catch((error) => {
    logger.fatal({ err: error }, "[Startup] Fatal error during server start");
    process.exit(1);
  });

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "[Process] unhandledRejection");
});
process.on("uncaughtException", (error) => {
  logger.error({ err: error }, "[Process] uncaughtException");
});
