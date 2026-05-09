/**
 * Daily scoreboard — running net of (realized P&L − AI cost − trade fees) for
 * the current UTC day.  This is the "pay-for-yourself" tracker the bots
 * consult before every trade decision.
 *
 * Three consumers:
 *   1. isDailyLossLimitExceeded() — hard-skips the autonomy tick when the
 *      day's realized net has fallen below -DAILY_LOSS_LIMIT_USD.  Uses real
 *      P&L from the DB, not AI-cost estimates.  Profitable days always run.
 *   2. The Claude reviewers — see the running scoreboard injected into
 *      their system prompt every cycle so they actively tighten their
 *      bar when net-negative.  Layer 2 of the pay-for-yourself system.
 *   3. profitGuardrails — the post-review hard floors auto-tighten by up
 *      to 1.5× when the day's net is deeply negative.  Layer 3.
 *
 * Concurrency / lifecycle:
 *   - One in-memory snapshot per process, refreshed at the top of each
 *     autonomy tick (in index.ts schedulers) before any AI call fires.
 *   - All sync getters (`getCachedScoreboard`) just read the cached snapshot
 *     so per-signal callsites stay fast.
 *   - Cache is per-process — a Railway redeploy resets the snapshot, which
 *     is fine because the next tick's refresh repopulates it from the DB.
 *   - UTC midnight rollover is automatic via the DB query filter
 *     (closedAt >= utc_today_midnight).
 *
 * Fee estimation:
 *   - Kalshi's published fee schedule is roughly 1¢ per share or 7 % of
 *     gain (whichever is greater), capped at 1.5 % of notional.  We don't
 *     have actual fee per fill in the DB, so we approximate with a flat
 *     2 % of round-trip notional on filled orders today.  This biases
 *     conservative (over-counts fees) which is the safe direction for the
 *     scoreboard — pushes the bots to be slightly more selective.
 *   - Polymarket has on-chain gas + relayer fees; we leave those at 0 for
 *     now since they're tiny relative to AI cost, and add a TODO.
 */

import { and, eq, gte } from "drizzle-orm";
import { kalshiPositions, kalshiOrders } from "../../drizzle/schema";
import { logger } from "./logger";
import { getSpentUsdToday } from "./aiCostBudget";

export type DailyScoreboard = {
  /** UTC day epoch (ms at start of day) the snapshot covers. */
  dayBucketMs: number;
  /** Realized P&L from positions closed since UTC midnight (sum across platforms). */
  realizedPnlUsd: number;
  /** Estimated round-trip trade fees on positions touched today. */
  estimatedFeesUsd: number;
  /** AI spend today (Anthropic), as tracked by aiCostBudget. */
  aiSpendUsd: number;
  /** Net = realized P&L − AI cost − fees. */
  netUsd: number;
  /** Effective overrun = max(0, AI cost + fees − realized P&L).  Used by the throttle. */
  effectiveOverrunUsd: number;
  /** Wall-clock when this snapshot was taken. */
  refreshedAtMs: number;
};

const KALSHI_FEE_RATE = 0.02; // round-trip estimate, see header note
const COLD_START_AI_USD = 5; // below this, no throttle regardless of net

// Hard-stop gate: when the UTC day's net P&L falls below this, the scheduler
// skips the tick entirely until UTC rollover.  Defaults to $20 (≈4.5% of a
// $450 account — stops after roughly one losing trade + AI overhead).  Raise
// proportionally if you deposit more (e.g. $45 at $1,000).  Set via
// DAILY_LOSS_LIMIT_USD env var.  0 = unlimited (no stop-loss on the day).
const DAILY_LOSS_LIMIT_USD = (() => {
  const raw = (process.env.DAILY_LOSS_LIMIT_USD ?? "").trim();
  if (!raw) return 20;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 20;
})();

let CACHE: DailyScoreboard | null = null;

function utcDayBucketMs(now: number = Date.now()): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function makeEmptyScoreboard(now: number = Date.now()): DailyScoreboard {
  return {
    dayBucketMs: utcDayBucketMs(now),
    realizedPnlUsd: 0,
    estimatedFeesUsd: 0,
    aiSpendUsd: getSpentUsdToday(),
    netUsd: -getSpentUsdToday(),
    effectiveOverrunUsd: getSpentUsdToday(),
    refreshedAtMs: now,
  };
}

/**
 * Refresh the in-memory scoreboard for one user.  Schedulers call this once
 * per tick before any AI/order activity.  Returns the new snapshot.  Errors
 * are swallowed — the cache falls back to an empty (zero-P&L) scoreboard
 * so the autonomy tick can proceed.  We log + audit so the operator sees
 * the data-quality issue without losing the trade run.
 */
export async function refreshScoreboard(
  userId: number,
  now: number = Date.now(),
): Promise<DailyScoreboard> {
  const dayStartMs = utcDayBucketMs(now);
  const dayStart = new Date(dayStartMs);
  try {
    const { getDb } = await import("../db");
    const database = await getDb();
    if (!database) {
      const empty = makeEmptyScoreboard(now);
      CACHE = empty;
      return empty;
    }

    // Sum realized P&L on Kalshi positions closed since UTC midnight.
    const [kalshiClosed, kalshiFilledToday] = await Promise.all([
      database
        .select({
          realizedPnl: kalshiPositions.realizedPnl,
        })
        .from(kalshiPositions)
        .where(
          and(
            eq(kalshiPositions.userId, userId),
            eq(kalshiPositions.positionStatus, "closed"),
            gte(kalshiPositions.closedAt, dayStart),
          ),
        ),
      // Filled Kalshi orders today — used to estimate round-trip fees.
      database
        .select({
          filledQuantity: kalshiOrders.filledQuantity,
          averagePrice: kalshiOrders.averagePrice,
        })
        .from(kalshiOrders)
        .where(
          and(
            eq(kalshiOrders.userId, userId),
            eq(kalshiOrders.status, "filled"),
            gte(kalshiOrders.filledAt, dayStart),
          ),
        ),
    ]);

    const sumRealized = (rows: Array<{ realizedPnl: number | null }>): number =>
      rows.reduce((sum: number, r) => sum + Number(r.realizedPnl ?? 0), 0);
    const realizedPnlUsd = sumRealized(kalshiClosed);

    // Notional that traded today = sum(filledQuantity × averagePrice).
    // Round-trip means we'd pay fees on both legs; use 2 × KALSHI_FEE_RATE / 2
    // = KALSHI_FEE_RATE on the *one-leg* notional for an estimate of total
    // round-trip fees on positions opened today.  Conservative (slightly
    // over-counts on multi-leg same-day round trips).
    const oneLegNotional = kalshiFilledToday.reduce(
      (sum: number, r: { filledQuantity: number | null; averagePrice: number | null }) =>
        sum + Number(r.filledQuantity ?? 0) * Number(r.averagePrice ?? 0),
      0,
    );
    const estimatedFeesUsd = oneLegNotional * KALSHI_FEE_RATE;

    const aiSpendUsd = getSpentUsdToday();
    const netUsd = realizedPnlUsd - aiSpendUsd - estimatedFeesUsd;
    const effectiveOverrunUsd = Math.max(0, aiSpendUsd + estimatedFeesUsd - realizedPnlUsd);

    const snapshot: DailyScoreboard = {
      dayBucketMs: dayStartMs,
      realizedPnlUsd,
      estimatedFeesUsd,
      aiSpendUsd,
      netUsd,
      effectiveOverrunUsd,
      refreshedAtMs: now,
    };
    CACHE = snapshot;
    return snapshot;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[dailyScoreboard] refresh failed; falling back to empty scoreboard",
    );
    const empty = makeEmptyScoreboard(now);
    CACHE = empty;
    return empty;
  }
}

/**
 * Get the most recently refreshed scoreboard.  Returns null when no
 * tick has refreshed yet (test path / first boot).  Sync getter — safe
 * to call from per-signal callsites (adaptive cadence, profit guardrail).
 *
 * Always returns a fresh `aiSpendUsd` from the budget module so the
 * scoreboard stays current as AI calls fire within a single tick.
 */
export function getCachedScoreboard(): DailyScoreboard | null {
  if (!CACHE) return null;
  // Refresh AI spend live so within a tick, multi-call accumulation is
  // reflected without re-querying the DB.  P&L + fees stay tick-stable
  // because they only update when a position closes / fill clears, which
  // happens out-of-band of the reviewer pipeline.
  const aiSpendUsd = getSpentUsdToday();
  const netUsd = CACHE.realizedPnlUsd - aiSpendUsd - CACHE.estimatedFeesUsd;
  const effectiveOverrunUsd = Math.max(
    0,
    aiSpendUsd + CACHE.estimatedFeesUsd - CACHE.realizedPnlUsd,
  );
  return { ...CACHE, aiSpendUsd, netUsd, effectiveOverrunUsd };
}

/**
 * Cold-start guard: until the bot has spent at least this much on AI
 * for the day, the throttle stays off regardless of P&L.  Prevents the
 * "no trades on day 1 because no P&L yet" deadlock.  Exposed so the
 * throttle and scoreboard share the same threshold.
 */
export function getColdStartAiUsd(): number {
  return COLD_START_AI_USD;
}

/**
 * Format the scoreboard as a one-line system-prompt block for the
 * reviewer.  Returns null when the cache is empty so callers can skip
 * injecting an empty block (cold start / test path).
 */
export function formatScoreboardForPrompt(snapshot: DailyScoreboard | null): string | null {
  if (!snapshot) return null;
  const fmt = (usd: number) => `$${usd.toFixed(2)}`;
  const status =
    snapshot.netUsd > 0
      ? "NET POSITIVE"
      : snapshot.netUsd < 0
        ? "NET NEGATIVE"
        : "BREAKEVEN";
  return [
    `## Today's running scoreboard (UTC)`,
    `  Realized P&L: ${fmt(snapshot.realizedPnlUsd)}`,
    `  AI cost: ${fmt(snapshot.aiSpendUsd)}`,
    `  Trade fees (est.): ${fmt(snapshot.estimatedFeesUsd)}`,
    `  Net: ${fmt(snapshot.netUsd)} (${status})`,
    "",
    `Pay-for-yourself rule: every approved trade must contribute to making today net-positive.`,
    `When net is NEGATIVE: raise your EV/confidence bar materially.  Skip marginal opportunities.  Take only A+ setups with clear catalyst + healthy liquidity.`,
    `When net is POSITIVE: normal posture.  You've earned the day's overhead; you can take well-justified standard setups.`,
    `Never take a trade just to "pay back" today's cost — that's hubris.  A bad trade is worse than no trade.`,
  ].join("\n");
}

/**
 * Three-zone daily loss response.
 *
 *   green  (net > -warnThreshold)  : run normally at user's confidence floor
 *   yellow (net > -stopThreshold)  : run but raise confidence floor to YELLOW_CONFIDENCE_FLOOR
 *                                    — only A+ setups pass the pre-reviewer filter
 *   red    (net ≤ -stopThreshold)  : hard stop until UTC rollover
 *
 * Thresholds:
 *   stop  = DAILY_LOSS_LIMIT_USD          (env var, default $20)
 *   warn  = DAILY_LOSS_LIMIT_USD * 0.5    (half the hard-stop; no separate env needed)
 *
 * At $450 balance with default $20 limit:
 *   -$10 triggers yellow (raised bar) → 0.85+ conf plays still run
 *   -$20 triggers red    (hard stop)
 */
export type DailyLossTier = "green" | "yellow" | "red";

/** Minimum signal confidence injected when in the yellow zone. */
const YELLOW_CONFIDENCE_FLOOR = 0.82;

export function getDailyLossTier(): DailyLossTier {
  if (DAILY_LOSS_LIMIT_USD <= 0) return "green";
  const board = getCachedScoreboard();
  if (!board) return "green"; // cold start — let first tick proceed normally
  if (board.netUsd < -DAILY_LOSS_LIMIT_USD) return "red";
  if (board.netUsd < -(DAILY_LOSS_LIMIT_USD / 2)) return "yellow";
  return "green";
}

/**
 * Returns the minimum confidence override to apply in the yellow zone,
 * or null when the system is in green (no override needed).
 * Callers should use Math.max(userPreference, override) so the user's
 * own higher floor is never inadvertently lowered.
 */
export function getDailyConfidenceFloorOverride(): number | null {
  const tier = getDailyLossTier();
  if (tier === "yellow") return YELLOW_CONFIDENCE_FLOOR;
  return null;
}

/**
 * Returns true when the running daily net has fallen below the configured
 * loss limit (red zone).  The scheduler calls this before arming each
 * autonomy tick.
 *
 *   net > -limit  → false (run normally, or day is profitable)
 *   net ≤ -limit  → true  (hard skip until UTC rollover)
 *   no cache yet  → false (cold start — let the first tick proceed)
 */
export function isDailyLossLimitExceeded(): boolean {
  return getDailyLossTier() === "red";
}

/** Read-only access to the configured limit (for logging / self-test). */
export function getDailyLossLimitUsd(): number {
  return DAILY_LOSS_LIMIT_USD;
}

// ── Test-only helpers ─────────────────────────────────────────────────────

export const __TEST_ONLY__ = {
  reset(): void {
    CACHE = null;
  },
  setCached(snapshot: DailyScoreboard | null): void {
    CACHE = snapshot;
  },
  utcDayBucketMs,
  KALSHI_FEE_RATE,
  COLD_START_AI_USD,
};
