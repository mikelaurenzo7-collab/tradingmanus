import "dotenv/config";
import { createServer } from "http";
import net from "net";
import { createApp, scopeScheduledUsersToTrigger } from "./app";
import { serveStatic, setupVite } from "./vite";
import { getUsersEligibleForAutomaticScheduledTrading, logAuditEvent } from "../db";
import { runScheduledAutonomousTradingBatch } from "./kalshiAutonomy";
import { syncPendingOrders, syncLivePositions } from "./kalshiOrderSync";
import { evaluateExitsForOpenPositions } from "./exitMonitor";
import {
  createAutonomousTradingLock,
  createOrderSyncLock,
} from "./distributedLock";
import { runStartupSelfTest } from "./startupSelfTest";
import { refreshScoreboard, isDailyLossLimitExceeded, getDailyLossLimitUsd, getCachedScoreboard, getDailyLossTier, getDailyConfidenceFloorOverride } from "./dailyScoreboard";
import { logger } from "./logger";
import * as hb from "./schedulerHeartbeat";
import { fetchKalshiMarkets } from "./kalshiMarketData";
import { detectAllCombinatorialArbitrage } from "./kalshiCombinatorial";
import { runCalibrationJob } from "./calibrationJob";
import { runDailySportsPlay } from "./dailySportsPlay";
import { runDailyMoonshotPlay } from "./dailyMoonshotPlay";
import { ENV } from "./env";
import {
  decideAutonomyCadence,
  loadAutonomyCadenceConfig,
  type AutonomyCadenceTier,
} from "./autonomyCadence";

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

// Autonomy cron at 5-min default. Sports/tech/econ TTLs (2-5 min) align
// better with a 5-min tick than a 10-min one — each market reaches its
// staleness threshold every tick at 5 min rather than every other tick.
// Estimated ~$2.50–3.50/day vs ~$1.90/day at 10 min.
// Default 10 min: validated via Monte Carlo on a $407 starting balance as the
// best AI-cost vs market-coverage tradeoff for accounts <$1k. At 10 min the
// Haiku-only stack costs ~$0.15/day instead of ~$0.94/day at 5 min with full
// escalation, which moves the median 90-day P&L from −18% to +8%.
// Override with AUTONOMY_INTERVAL_MS once equity > $1k to recapture more crypto/sports ticks.
const AUTONOMOUS_TRADING_INTERVAL_MS = envIntervalMs("AUTONOMY_INTERVAL_MS", 10 * 60 * 1000);
const ORDER_SYNC_INTERVAL_MS = envIntervalMs("ORDER_SYNC_INTERVAL_MS", 30 * 1000);
// Cross-platform arb scanner removed — Kalshi-only.
const COMBINATORIAL_ARB_INTERVAL_MS = envIntervalMs(
  "COMBINATORIAL_ARB_INTERVAL_MS",
  60 * 1000,
);
// Weekly Brier-score calibration (default Sunday 00:00 UTC + every 7 days).
const CALIBRATION_INTERVAL_MS = envIntervalMs(
  "CALIBRATION_INTERVAL_MS",
  7 * 24 * 60 * 60 * 1000,
);
// Wikipedia recent-edits watcher — free real-time signal on watched politicians,
// executives, and companies.  5 min default keeps within the 500-req/hour
// Wikipedia rate limit even with a ~50-page watchlist.
const WIKIPEDIA_WATCH_INTERVAL_MS = envIntervalMs(
  "WIKIPEDIA_WATCH_INTERVAL_MS",
  5 * 60 * 1000,
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

    if (isDailyLossLimitExceeded()) {
      const board = getCachedScoreboard();
      logger.warn(
        { netUsd: board ? Number(board.netUsd.toFixed(2)) : null, limitUsd: getDailyLossLimitUsd() },
        "[Scheduler] Daily loss limit exceeded (red zone); Kalshi autonomy skipping until UTC rollover",
      );
      hb.setBlocked(
        "autonomy_kalshi",
        `Daily loss limit exceeded (net $${board ? board.netUsd.toFixed(2) : "?"}  < -$${getDailyLossLimitUsd()})`,
      );
      // Emit a dedicated audit event so the operator can see in the audit log
      // when the daily loss stop fired.  Without this, the skip is invisible
      // beyond a warn log line, making it impossible to count red-zone days
      // or correlate with strategy / market events.
      try {
        await logAuditEvent(
          "kalshi_daily_loss_limit_triggered",
          JSON.stringify({
            netUsd: board ? Number(board.netUsd.toFixed(2)) : null,
            limitUsd: getDailyLossLimitUsd(),
            tier: "red",
            scopedUserCount: scopedUsers.length,
          }),
          "local_scheduler",
        );
      } catch (err) {
        logger.warn({ err }, "[Scheduler] Failed to emit daily loss limit audit event");
      }
      return;
    }

    const lossTier = getDailyLossTier();
    const confidenceFloorOverride = getDailyConfidenceFloorOverride();
    if (lossTier === "yellow") {
      const board = getCachedScoreboard();
      logger.info(
        { netUsd: board ? Number(board.netUsd.toFixed(2)) : null, confidenceFloor: confidenceFloorOverride },
        "[Scheduler] Yellow zone: net negative but above hard stop — continuing with raised confidence floor %.2f",
        confidenceFloorOverride,
      );
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
      const batchResult = await runScheduledAutonomousTradingBatch(
        lockedUsers as any,
        "local_scheduler",
        confidenceFloorOverride !== null ? { confidenceFloorOverride } : undefined,
      );
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

// ── Wikipedia recent-edits watcher ─────────────────────────────────────────
// Polls Wikipedia for significant edits to a curated watchlist (politicians,
// executives, public figures, companies).  When a significant edit lands —
// large size delta or alarm-keyword in the comment — we audit-log it so the
// dashboard surfaces the alert and the operator (or future tighter
// integration) can act before mainstream news catches up.  Detection-only:
// no auto-execution.
let wikipediaWatcherInFlight = false;
async function runWikipediaWatcher() {
  if (wikipediaWatcherInFlight) return;
  wikipediaWatcherInFlight = true;
  const startedAt = Date.now();
  try {
    const { pollWikipediaWatchlist, matchSignalsToMarkets } = await import(
      "./wikipediaEditWatcher"
    );
    const signals = await pollWikipediaWatchlist();
    if (signals.length === 0) return;

    const rawMarkets = await fetchKalshiMarkets({ status: "open" });
    const matchedMarkets = matchSignalsToMarkets(
      signals,
      rawMarkets.map((m) => ({ id: m.id, title: m.title, category: m.category })),
    );

    logger.info(
      {
        signalCount: signals.length,
        matchCount: matchedMarkets.length,
        durationMs: Date.now() - startedAt,
      },
      "[WikipediaWatcher] %d signal(s), %d market match(es)",
      signals.length,
      matchedMarkets.length,
    );

    try {
      const { logAuditEvent } = await import("../db");
      await logAuditEvent(
        "wikipedia_edit_scan",
        JSON.stringify({
          signalCount: signals.length,
          matchCount: matchedMarkets.length,
          signals: signals.slice(0, 10).map((s) => ({
            page: s.pageTitle,
            confidence: s.confidence,
            keywords: s.revision.matchedKeywords,
            sizeDelta: s.revision.sizeDelta,
            comment: s.revision.comment.slice(0, 200),
          })),
          matches: matchedMarkets.slice(0, 10).map((m) => ({
            marketId: m.market.id,
            page: m.signal.pageTitle,
            confidence: m.signal.confidence,
          })),
        }),
        "wikipedia_watcher",
      );
    } catch (err) {
      logger.warn({ err }, "[WikipediaWatcher] audit log failed");
    }
  } catch (err) {
    logger.warn({ err }, "[WikipediaWatcher] poll failed");
  } finally {
    wikipediaWatcherInFlight = false;
  }
}

// ── Daily Sports Play cron (playground mode) ────────────────────────────────
// Fires once per UTC day at ENV.dailySportsPlayHourUtc (default 14:00 UTC =
// 10am ET). Tick rate is 5 minutes — when the current UTC hour matches AND
// we haven't already fired today, run the play for every eligible user.
// Per-user gating with in-process AND Postgres-backed checks. The
// in-process Set is fast (avoids a DB round-trip every 5-min tick) but
// gets wiped on container restart. The DB check via auditLog is the
// source of truth — even if the container restarts mid-hour, we won't
// re-fire a play that already fired today.
//
// We scan the audit log for ANY same-user, same-day, same-play-type
// event (attempt / executed / blocked / skipped). The first call for
// each user+day populates the Set; subsequent ticks read from memory.
async function dailyPlayAlreadyRanToday(
  userId: number,
  utcDay: string,
  eventTypes: string[],
): Promise<boolean> {
  try {
    const { getDb } = await import("../db");
    const { auditLog } = await import("../../drizzle/schema");
    const { and, eq, gte, inArray } = await import("drizzle-orm");
    const database = await getDb();
    if (!database) return false;
    const dayStart = new Date(`${utcDay}T00:00:00.000Z`);
    const rows = await database
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          inArray(auditLog.eventType, eventTypes),
          eq(auditLog.triggeredByOpenId, `user:${userId}`),
          gte(auditLog.createdAt, dayStart),
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    // Fail open on lookup errors — better to potentially re-fire than to
    // permanently suppress on a transient DB hiccup. The in-process Set
    // catches the same-tick redundant case.
    logger.warn(
      { err, userId, utcDay },
      "[DailyPlay] auditLog dedup lookup failed; falling back to in-process Set only",
    );
    return false;
  }
}

const dailySportsPlayCompletedKeys = new Set<string>();
async function maybeRunDailySportsPlay() {
  if (!ENV.enableDailySportsPlay) return;
  const now = new Date();
  const utcHour = now.getUTCHours();
  if (utcHour !== ENV.dailySportsPlayHourUtc) return;
  const utcDay = now.toISOString().slice(0, 10);

  try {
    const eligibleUsers = await getUsersEligibleForAutomaticScheduledTrading();
    for (const user of eligibleUsers as Array<{ id: number }>) {
      const key = `${user.id}:${utcDay}`;
      // Skip users whose run already completed today (in-process fast path).
      if (dailySportsPlayCompletedKeys.has(key)) continue;
      // Postgres-backed cross-restart check. If the audit log shows a
      // play already ran for this user today, skip and seed the Set.
      const alreadyRan = await dailyPlayAlreadyRanToday(user.id, utcDay, [
        "kalshi_daily_sports_play_executed",
        "kalshi_daily_sports_play_attempt",
        "kalshi_daily_sports_play_blocked",
      ]);
      if (alreadyRan) {
        dailySportsPlayCompletedKeys.add(key);
        continue;
      }
      try {
        const result = await runDailySportsPlay(user.id);
        // Mark completed only AFTER the run returned (any status, even
        // skip/blocked/no_qualifying_play, counts — those are intended
        // outcomes, not failures). Exceptions below skip this line so
        // the next 5-min tick retries.
        dailySportsPlayCompletedKeys.add(key);
        logger.info(
          {
            userId: user.id,
            status: result.status,
            reason: result.reason,
            marketId: result.marketId,
            side: result.side,
            count: result.count,
            notionalUsd: result.notionalUsd,
            confidence: result.confidence,
          },
          "[DailySportsPlay] result for user %d: %s",
          user.id,
          result.status,
        );
      } catch (err) {
        logger.warn(
          { err, userId: user.id },
          "[DailySportsPlay] run failed for user %d",
          user.id,
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, "[DailySportsPlay] sweep failed");
  }
}

// ── Polymarket Daily Sports Play removed — Kalshi-only ──────────────────────

// ── Daily Moonshot Play cron (aggressive playground) ─────────────────────
// Fires once per UTC day at ENV.dailyMoonshotHourUtc (default 16:00 UTC =
// noon ET). Tick rate is 5 min; per-user gating prevents double-firing
// on transient retries within the configured hour.
const dailyMoonshotCompletedKeys = new Set<string>();
async function maybeRunDailyMoonshotPlay() {
  if (!ENV.enableDailyMoonshot) return;
  const now = new Date();
  const utcHour = now.getUTCHours();
  if (utcHour !== ENV.dailyMoonshotHourUtc) return;
  const utcDay = now.toISOString().slice(0, 10);

  try {
    const eligibleUsers = await getUsersEligibleForAutomaticScheduledTrading();
    for (const user of eligibleUsers as Array<{ id: number }>) {
      const key = `${user.id}:${utcDay}`;
      if (dailyMoonshotCompletedKeys.has(key)) continue;
      const alreadyRan = await dailyPlayAlreadyRanToday(user.id, utcDay, [
        "kalshi_daily_moonshot_play_executed",
        "kalshi_daily_moonshot_play_attempt",
        "kalshi_daily_moonshot_play_blocked",
      ]);
      if (alreadyRan) {
        dailyMoonshotCompletedKeys.add(key);
        continue;
      }
      try {
        const result = await runDailyMoonshotPlay(user.id);
        dailyMoonshotCompletedKeys.add(key);
        logger.info(
          {
            userId: user.id,
            status: result.status,
            reason: result.reason,
            marketId: result.marketId,
            side: result.side,
            count: result.count,
            notionalUsd: result.notionalUsd,
            confidence: result.confidence,
            impliedProbability: result.impliedProbability,
            payoutMultiple: result.payoutMultiple,
          },
          "[DailyMoonshotPlay] result for user %d: %s",
          user.id,
          result.status,
        );
      } catch (err) {
        logger.warn(
          { err, userId: user.id },
          "[DailyMoonshotPlay] run failed for user %d",
          user.id,
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, "[DailyMoonshotPlay] sweep failed");
  }
}

// ── Weekly calibration cron ──────────────────────────────────────────────────
// Recomputes Brier score per reviewer per category. Runs once per week.
async function runWeeklyCalibration() {
  try {
    const eligibleUsers = await getUsersEligibleForAutomaticScheduledTrading();
    for (const user of eligibleUsers as Array<{ id: number }>) {
      // Per-user try/catch — best-effort. One user's failure must not abort
      // the rest of the sweep.
      try {
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
      } catch (err) {
        logger.warn(
          { err, userId: user.id },
          "[Calibration] weekly run failed for user %d",
          user.id,
        );
      }
    }
  } catch (err) {
    // Outer catch covers fetch-level failures (e.g. eligibleUsers query).
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
        "[Startup] Self-test FAILED in production — schedulers will NOT arm. HTTP server stays up so /api/health/* and the dashboard remain reachable. Fix the failures above (most commonly: set OPENROUTER_API_KEY, KALSHI_KEY_ID + KALSHI_PRIVATE_KEY, run `pnpm db:push`, set DATABASE_URL) and redeploy.",
      );
    } else {
      hb.configureSchedulerInterval("autonomy_kalshi", AUTONOMOUS_TRADING_INTERVAL_MS);
      hb.configureSchedulerInterval("order_sync", ORDER_SYNC_INTERVAL_MS);

      // Time-of-day adaptive cadence: prime hours run at base interval,
      // overnight quiet hours slow by AUTONOMY_OVERNIGHT_MULTIPLIER (default 4×).
      // Self-rescheduling setTimeout so each tick re-evaluates the tier.
      const cadenceConfig = loadAutonomyCadenceConfig(AUTONOMOUS_TRADING_INTERVAL_MS);
      let lastCadenceTier: AutonomyCadenceTier | null = null;
      logger.info(
        {
          baseIntervalMs: cadenceConfig.baseIntervalMs,
          overnightMultiplier: cadenceConfig.overnightMultiplier,
          primeStartUtcHour: cadenceConfig.primeStartUtcHour,
          primeEndUtcHour: cadenceConfig.primeEndUtcHour,
        },
        "[Scheduler] Autonomy cadence: prime %dh-%dh UTC at %dms, overnight %d× slower",
        cadenceConfig.primeStartUtcHour,
        cadenceConfig.primeEndUtcHour,
        cadenceConfig.baseIntervalMs,
        cadenceConfig.overnightMultiplier,
      );
      const runAutonomyTickAndReschedule = async () => {
        try {
          await runAutonomousScheduler();
        } catch (err) {
          logger.error({ err }, "[Scheduler] Autonomy tick threw");
        } finally {
          const decision = decideAutonomyCadence(new Date(), cadenceConfig);
          if (decision.tier !== lastCadenceTier) {
            logger.info(
              { tier: decision.tier, hourUtc: decision.hourUtc, nextIntervalMs: decision.intervalMs },
              "[Scheduler] Autonomy cadence tier transitioned to %s (UTC hour %d, next tick in %dms)",
              decision.tier,
              decision.hourUtc,
              decision.intervalMs,
            );
            lastCadenceTier = decision.tier;
            hb.configureSchedulerInterval("autonomy_kalshi", decision.intervalMs);
          }
          setTimeout(runAutonomyTickAndReschedule, decision.intervalMs);
        }
      };
      // First tick fires from the existing 30s warmup setTimeout below; this
      // helper schedules every subsequent tick using the live tier interval.
      setInterval(runOrderSync, ORDER_SYNC_INTERVAL_MS);
      // Combinatorial-arb scanner — risk-free math, no AI cost. Detection-only.
      setInterval(runCombinatorialArbScanner, COMBINATORIAL_ARB_INTERVAL_MS);
      // Wikipedia recent-edits watcher — free real-time signal.
      setInterval(runWikipediaWatcher, WIKIPEDIA_WATCH_INTERVAL_MS);
      // Weekly Brier-score calibration cron.
      setInterval(runWeeklyCalibration, CALIBRATION_INTERVAL_MS);
      // Daily plays — check every 5 minutes; idempotent within a UTC day.
      setInterval(maybeRunDailySportsPlay, 5 * 60 * 1000);
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

      // First autonomy tick fires after a 30s warmup; the helper then
      // self-reschedules using the time-of-day-aware interval.
      setTimeout(runAutonomyTickAndReschedule, 30 * 1000);
      const autonomyMin = (AUTONOMOUS_TRADING_INTERVAL_MS / 60_000).toFixed(1);
      const orderSyncSec = (ORDER_SYNC_INTERVAL_MS / 1_000).toFixed(0);
      logger.info("[Scheduler] Kalshi autonomy started (%s-min interval)", autonomyMin);
      logger.info("[OrderSync] Kalshi order sync started (%s-sec interval)", orderSyncSec);
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
