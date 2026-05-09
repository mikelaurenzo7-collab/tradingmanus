import "dotenv/config";
import { createServer } from "http";
import net from "net";
import { createApp, scopeScheduledUsersToTrigger } from "./app";
import { serveStatic, setupVite } from "./vite";
import { getUsersEligibleForAutomaticScheduledTrading } from "../db";
import { runScheduledAutonomousTradingBatch } from "./kalshiAutonomy";
import { syncPendingOrders, syncLivePositions } from "./kalshiOrderSync";
import { evaluateExitsForOpenPositions } from "./exitMonitor";
import {
  createAutonomousTradingLock,
  createOrderSyncLock,
  createPolymarketAutonomousTradingLock,
  createPolymarketOrderSyncLock,
} from "./distributedLock";
import { runPolymarketAutonomousTrading } from "./polymarketAutonomy";
import { syncPolymarketPositions } from "./polymarketPositionSync";
import { evaluatePolymarketExitsForOpenPositions } from "./polymarketExitMonitor";
import { fetchPolymarketMarkets } from "./polymarketAuth";
import { detectCrossPlatformArbitrage } from "./crossPlatformArbitrage";
import * as polymarketCredDb from "../db.polymarket-credentials";
import { runStartupSelfTest } from "./startupSelfTest";
import { checkBudgetForRun } from "./aiCostBudget";
import { refreshScoreboard } from "./dailyScoreboard";
import { logger } from "./logger";
import * as hb from "./schedulerHeartbeat";
import { fetchKalshiMarkets } from "./kalshiMarketData";
import { detectAllCombinatorialArbitrage } from "./kalshiCombinatorial";
import { runCalibrationJob } from "./calibrationJob";
import { runDailySportsPlay } from "./dailySportsPlay";
import { runDailyMoonshotPlay } from "./dailyMoonshotPlay";
import { ENV } from "./env";

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

// Autonomy cron at 10-min default. Earlier 60s default burned AI cost
// without commensurate edge — Kalshi signal supply doesn't refresh
// fast enough to warrant minute-level review. 10 min keeps us reactive
// to event-day repricing while cutting AI cost ~10×.
const AUTONOMOUS_TRADING_INTERVAL_MS = envIntervalMs("AUTONOMY_INTERVAL_MS", 10 * 60 * 1000);
const ORDER_SYNC_INTERVAL_MS = envIntervalMs("ORDER_SYNC_INTERVAL_MS", 30 * 1000);
// Combinatorial arbitrage is rule-based math (no AI cost). Runs every 60s
// across all open Kalshi markets to detect YES + NO > 1.00 mispricings.
const COMBINATORIAL_ARB_INTERVAL_MS = envIntervalMs(
  "COMBINATORIAL_ARB_INTERVAL_MS",
  60 * 1000,
);
// Cross-platform arbitrage scanner — Kalshi ↔ Polymarket. Detection-only by
// default (auto-execute requires CROSS_ARB_AUTO_EXECUTE=true and connected
// credentials on both platforms).  10 s default mirrors CLAUDE.md.
const CROSS_ARB_INTERVAL_MS = envIntervalMs(
  "CROSS_ARB_INTERVAL_MS",
  10 * 1000,
);
// Polymarket autonomy + position-sync. Defaults match the Kalshi side so a
// shared AUTONOMY_INTERVAL_MS / ORDER_SYNC_INTERVAL_MS tuning knob applies to
// both platforms uniformly.
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

// ── Polymarket autonomy ──────────────────────────────────────────────────────
// Mirrors runAutonomousScheduler but routed to runPolymarketAutonomousTrading.
// Per-user Polymarket subscription is checked inside the run; users who haven't
// connected Polymarket credentials are no-ops (audit-logged as `skipped`).
async function runPolymarketAutonomousScheduler() {
  const startedAt = Date.now();
  hb.markTickStart("autonomy_polymarket", "scanning", "Checking Polymarket eligibility");
  try {
    const eligibleUsers = await getUsersEligibleForAutomaticScheduledTrading();
    const scopedUsers = scopeScheduledUsersToTrigger(
      eligibleUsers as Array<{ id: number; openId: string; email?: string | null }>,
      "local_scheduler",
    );
    if (scopedUsers.length === 0) {
      hb.setSkipped("autonomy_polymarket", "no eligible users (live trading disarmed)");
      return;
    }

    // Same daily-budget gate as Kalshi — when AI cost has overrun the
    // pay-for-yourself cap, both platforms skip until UTC rollover.
    const budget = checkBudgetForRun();
    if (!budget.proceed) {
      hb.setBlocked(
        "autonomy_polymarket",
        `AI daily budget overrun (${Math.round(budget.fractionSpent * 100)}%) — ${budget.reason}`,
      );
      return;
    }

    let executedUsers = 0;
    for (const user of scopedUsers as Array<{ id: number; openId: string }>) {
      // Single-owner fence: Polymarket creds + the POLYMARKET_OWNER_ADDRESS
      // env var both belong to the operator's wallet.  In default lockdown
      // mode `getUsersEligibleForAutomaticScheduledTrading()` already only
      // returns `owner:primary`, but enforce it explicitly here so a future
      // ALLOW_PUBLIC_REGISTRATION=true rollout can't accidentally apply the
      // owner's wallet to another user's autonomy run.
      if (user.openId !== "owner:primary") continue;
      // Skip the per-user lock when Polymarket creds aren't connected — keeps
      // the audit log clean of "skipped — no creds" rows when the operator
      // hasn't yet wired Polymarket up.
      const hasPolymarket = await polymarketCredDb.isUserSubscribedToPolymarket(user.id);
      if (!hasPolymarket) continue;

      const lock = createPolymarketAutonomousTradingLock(user.id);
      const acquired = await lock.acquire({ ttlMs: 5 * 60 * 1000 });
      if (!acquired) {
        logger.info(
          { userId: user.id },
          "[Scheduler] Polymarket autonomy already running for user %d, skipping",
          user.id,
        );
        continue;
      }
      try {
        const result = await runPolymarketAutonomousTrading(user.id, {
          triggeredByOpenId: "local_scheduler",
        });
        if (result.status === "executed") {
          executedUsers += 1;
        }
      } catch (err) {
        logger.error(
          { err, userId: user.id },
          "[Scheduler] Polymarket autonomy run failed for user %d",
          user.id,
        );
      } finally {
        await lock.release();
      }
    }
    hb.recordTickTelemetry("autonomy_polymarket", { ordersPlaced: executedUsers });
  } catch (error) {
    logger.error({ err: error }, "[Scheduler] Polymarket autonomous trading run failed");
    hb.setError("autonomy_polymarket", error);
  } finally {
    hb.markTickComplete("autonomy_polymarket", startedAt);
  }
}

// Polymarket position-sync + exit-monitor.  Equivalent of runOrderSync for
// Polymarket: refreshes the local positions table from data-api (catches
// manual UI closes) and evaluates trailing stops / profit targets.
async function runPolymarketOrderSync() {
  const startedAt = Date.now();
  hb.markTickStart("polymarket_order_sync", "syncing", "Reconciling Polymarket positions + checking exits");
  try {
    // Polymarket reconciliation must NOT inherit Kalshi's armed-state
    // requirement — if the operator has a Polymarket position open but
    // their Kalshi side is paused, manual UI closes still need to be
    // detected and trailing stops still need to ratchet.  Scope to the
    // owner directly + check Polymarket creds.
    const { getUserByOpenId } = await import("../db");
    const ownerUser = await getUserByOpenId("owner:primary");
    if (!ownerUser) {
      hb.setSkipped("polymarket_order_sync", "owner user not registered");
      return;
    }
    const scopedUsers = [{ id: ownerUser.id, openId: ownerUser.openId }];

    let exitTriggered = 0;
    for (const user of scopedUsers as Array<{ id: number; openId: string }>) {
      // Same single-owner fence as the autonomy scheduler: the data-api
      // sync uses the global POLYMARKET_OWNER_ADDRESS wallet, so it must
      // only apply to the owner's row.  Without this, a multi-tenant
      // rollout would copy the owner's positions into every subscribed
      // user and false-flag their real positions as drifted-closed.
      if (user.openId !== "owner:primary") continue;
      const hasPolymarket = await polymarketCredDb.isUserSubscribedToPolymarket(user.id);
      if (!hasPolymarket) continue;

      const lock = createPolymarketOrderSyncLock(user.id);
      const acquired = await lock.acquire({ ttlMs: 60 * 1000 });
      if (!acquired) continue;
      try {
        await syncPolymarketPositions(user.id);
        const exits = await evaluatePolymarketExitsForOpenPositions(user.id, "local_scheduler");
        const triggered = exits.filter((e) => e.decision.shouldExit);
        exitTriggered += triggered.length;
        if (triggered.length > 0) {
          logger.info(
            { userId: user.id, count: triggered.length, closed: triggered.filter((e) => e.closed).length },
            "[PolymarketExitMonitor] %d exit signal(s) triggered for user %d",
            triggered.length,
            user.id,
          );
        }
      } catch (err) {
        logger.error({ err, userId: user.id }, "[PolymarketOrderSync] Sync failed for user %d", user.id);
      } finally {
        await lock.release();
      }
    }
    hb.recordTickTelemetry("polymarket_order_sync", { ordersPlaced: exitTriggered });
  } catch (error) {
    logger.error({ err: error }, "[PolymarketOrderSync] Run failed");
    hb.setError("polymarket_order_sync", error);
  } finally {
    hb.markTickComplete("polymarket_order_sync", startedAt);
  }
}

// ── Cross-platform arbitrage scanner ─────────────────────────────────────────
// Pure rule-based math (no AI cost). Scans Kalshi ↔ Polymarket for matched
// markets where the spread covers fees + execution risk. Auto-execute is
// disabled by default; flip CROSS_ARB_AUTO_EXECUTE=true once both platforms
// are funded and you've seen a few clean detection cycles in the audit log.
let crossArbScanInFlight = false;
async function runCrossPlatformArbScanner() {
  if (crossArbScanInFlight) return;
  crossArbScanInFlight = true;
  const startedAt = Date.now();
  hb.markTickStart("cross_arb", "scanning", "Fetching Kalshi + Polymarket markets");
  try {
    const [rawKalshi, rawPoly] = await Promise.all([
      fetchKalshiMarkets({ status: "open" }),
      fetchPolymarketMarkets({ limit: 200 }),
    ]);
    const kalshiMarkets = rawKalshi
      .filter((m) => m.status === "open")
      .map((m) => ({
        marketId: m.id,
        title: m.title,
        category: m.category ?? "other",
        yesPrice: Number(m.yesPrice ?? 0),
        noPrice: Number(m.noPrice ?? 0),
        liquidity: Number(m.yesVolume ?? 0) + Number(m.noVolume ?? 0),
      }));
    const polymarketMarkets = rawPoly.map((m) => {
      const yesToken = m.tokens.find((t) => t.outcome.toLowerCase() === "yes");
      const noToken = m.tokens.find((t) => t.outcome.toLowerCase() === "no");
      return {
        marketId: m.marketId,
        question: m.question,
        category: m.category ?? "other",
        yesPrice: Number(yesToken?.price ?? m.impliedProbabilityYes ?? 0.5),
        noPrice: Number(noToken?.price ?? 1 - (m.impliedProbabilityYes ?? 0.5)),
        liquidity: Number(m.liquidity ?? 0),
      };
    });

    const opportunities = detectCrossPlatformArbitrage(kalshiMarkets, polymarketMarkets);
    if (opportunities.length === 0) return;

    const { logAuditEvent } = await import("../db");
    for (const opp of opportunities.slice(0, 10)) {
      await logAuditEvent(
        "cross_platform_arb_detected",
        JSON.stringify({
          type: opp.type,
          kalshiMarketId: opp.kalshiMarketId,
          polymarketMarketId: opp.polymarketMarketId,
          netEdge: opp.netEdge,
          confidence: opp.confidence,
        }),
        "system",
      );
    }
    logger.info(
      { count: opportunities.length, top: opportunities[0]?.netEdge },
      "[CrossArb] %d cross-platform opportunity(ies) detected",
      opportunities.length,
    );

    // Auto-execute is intentionally NOT wired here yet. Cross-platform
    // execution requires (1) per-user creds for both platforms, (2) a hard
    // size cap, (3) a tested two-leg execution path that handles partial
    // fills and currency conversion.  Until all three are in place, this
    // stays detection-only — opportunities surface in the audit log so the
    // operator can manually arb them.
  } catch (error) {
    logger.error({ err: error }, "[CrossArb] Scanner failed");
    hb.setError("cross_arb", error);
  } finally {
    crossArbScanInFlight = false;
    hb.recordTickTelemetry("cross_arb", { ordersPlaced: 0 });
    hb.markTickComplete("cross_arb", startedAt);
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
        "[Startup] Self-test FAILED in production — schedulers will NOT arm. HTTP server stays up so /api/health/* and the dashboard remain reachable. Fix the failures above (most commonly: set XAI_API_KEY, KALSHI_KEY_ID + KALSHI_PRIVATE_KEY, run `pnpm db:push`, set DATABASE_URL) and redeploy.",
      );
    } else {
      hb.configureSchedulerInterval("autonomy_kalshi", AUTONOMOUS_TRADING_INTERVAL_MS);
      hb.configureSchedulerInterval("autonomy_polymarket", AUTONOMOUS_TRADING_INTERVAL_MS);
      hb.configureSchedulerInterval("order_sync", ORDER_SYNC_INTERVAL_MS);
      hb.configureSchedulerInterval("polymarket_order_sync", ORDER_SYNC_INTERVAL_MS);
      hb.configureSchedulerInterval("cross_arb", CROSS_ARB_INTERVAL_MS);

      setInterval(runAutonomousScheduler, AUTONOMOUS_TRADING_INTERVAL_MS);
      setInterval(runOrderSync, ORDER_SYNC_INTERVAL_MS);
      setInterval(runPolymarketAutonomousScheduler, AUTONOMOUS_TRADING_INTERVAL_MS);
      setInterval(runPolymarketOrderSync, ORDER_SYNC_INTERVAL_MS);
      setInterval(runCrossPlatformArbScanner, CROSS_ARB_INTERVAL_MS);
      // Combinatorial-arb scanner — risk-free math, no AI cost. Detection-only
      // for now (auto-execution requires per-user creds + size cap).
      setInterval(runCombinatorialArbScanner, COMBINATORIAL_ARB_INTERVAL_MS);
      // Weekly Brier-score calibration cron.
      setInterval(runWeeklyCalibration, CALIBRATION_INTERVAL_MS);
      // Daily Sports Play (playground mode) — checks every 5 minutes
      // whether to fire; the function itself is idempotent within a UTC day.
      setInterval(maybeRunDailySportsPlay, 5 * 60 * 1000);
      setInterval(maybeRunDailyMoonshotPlay, 5 * 60 * 1000);

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
      setTimeout(runPolymarketAutonomousScheduler, 45 * 1000);
      setTimeout(runCrossPlatformArbScanner, 60 * 1000);
      const autonomyMin = (AUTONOMOUS_TRADING_INTERVAL_MS / 60_000).toFixed(1);
      const orderSyncSec = (ORDER_SYNC_INTERVAL_MS / 1_000).toFixed(0);
      const crossArbSec = (CROSS_ARB_INTERVAL_MS / 1_000).toFixed(0);
      logger.info("[Scheduler] Kalshi autonomy started (%s-min interval)", autonomyMin);
      logger.info("[Scheduler] Polymarket autonomy started (%s-min interval)", autonomyMin);
      logger.info("[OrderSync] Kalshi order sync started (%s-sec interval)", orderSyncSec);
      logger.info("[OrderSync] Polymarket order sync started (%s-sec interval)", orderSyncSec);
      logger.info("[CrossArb] Cross-platform arb scanner started (%s-sec interval, detection-only)", crossArbSec);
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
