/**
 * Drawdown circuit breaker — capital-preservation gate.
 *
 * Rules (all must be satisfied to allow a new trade):
 *   1. Daily loss ≤ DAILY_DRAWDOWN_PAUSE_FRAC (default 3 %) of capital.
 *   2. Weekly loss ≤ WEEKLY_DRAWDOWN_PAUSE_FRAC (default 8 %) of capital.
 *   3. Consecutive losses < COLD_STREAK_LOSS_COUNT (default 5).
 *   4. 7-day realized edge ≥ COLD_STREAK_MIN_REALIZED_EDGE_PCT (default 3 %).
 *
 * Returns `{ allowed, reason, breaker? }`. `allowed=false` means the autonomy
 * pipeline should skip placing new orders this cycle; existing exits still
 * fire normally.
 */

import { ENV } from "./env";

export interface DrawdownInputs {
  /** Total available capital in USD. */
  capitalUsd: number;
  /** Realized P&L (USD) for the current UTC day. Negative on losing days. */
  todayPnlUsd: number;
  /** Realized P&L (USD) for the trailing 7 days. Negative on losing weeks. */
  weeklyPnlUsd: number;
  /** Consecutive loss count at the trade level. */
  consecutiveLosses: number;
  /** Realized edge (fraction) over the trailing 7 days. */
  weeklyRealizedEdgePct: number;
}

export type BreakerKind =
  | "daily_drawdown"
  | "weekly_drawdown"
  | "cold_streak_losses"
  | "cold_streak_realized_edge";

export interface DrawdownDecision {
  allowed: boolean;
  reason: string;
  breaker?: BreakerKind;
  details: {
    capitalUsd: number;
    dailyDrawdownFrac: number;
    weeklyDrawdownFrac: number;
    consecutiveLosses: number;
    weeklyRealizedEdgePct: number;
    thresholds: {
      dailyPauseFrac: number;
      weeklyPauseFrac: number;
      coldStreakLossCount: number;
      coldStreakMinRealizedEdgePct: number;
    };
  };
}

export function checkDrawdownBreaker(input: DrawdownInputs): DrawdownDecision {
  const cap = Math.max(0, input.capitalUsd);
  const dailyLoss = Math.max(0, -input.todayPnlUsd); // positive when losing
  const weeklyLoss = Math.max(0, -input.weeklyPnlUsd);
  const dailyFrac = cap > 0 ? dailyLoss / cap : 0;
  const weeklyFrac = cap > 0 ? weeklyLoss / cap : 0;

  const t = ENV.profitGuardrails;
  const details: DrawdownDecision["details"] = {
    capitalUsd: cap,
    dailyDrawdownFrac: dailyFrac,
    weeklyDrawdownFrac: weeklyFrac,
    consecutiveLosses: input.consecutiveLosses,
    weeklyRealizedEdgePct: input.weeklyRealizedEdgePct,
    thresholds: {
      dailyPauseFrac: t.dailyDrawdownPauseFrac,
      weeklyPauseFrac: t.weeklyDrawdownPauseFrac,
      coldStreakLossCount: t.coldStreakLossCount,
      coldStreakMinRealizedEdgePct: t.coldStreakMinRealizedEdgePct,
    },
  };

  if (dailyFrac > t.dailyDrawdownPauseFrac) {
    return {
      allowed: false,
      reason: `Daily drawdown ${(dailyFrac * 100).toFixed(2)}% exceeds ${(t.dailyDrawdownPauseFrac * 100).toFixed(2)}% pause threshold`,
      breaker: "daily_drawdown",
      details,
    };
  }

  if (weeklyFrac > t.weeklyDrawdownPauseFrac) {
    return {
      allowed: false,
      reason: `Weekly drawdown ${(weeklyFrac * 100).toFixed(2)}% exceeds ${(t.weeklyDrawdownPauseFrac * 100).toFixed(2)}% pause threshold`,
      breaker: "weekly_drawdown",
      details,
    };
  }

  if (input.consecutiveLosses >= t.coldStreakLossCount) {
    return {
      allowed: false,
      reason: `Cold streak: ${input.consecutiveLosses} consecutive losses ≥ ${t.coldStreakLossCount}`,
      breaker: "cold_streak_losses",
      details,
    };
  }

  if (input.weeklyRealizedEdgePct < t.coldStreakMinRealizedEdgePct) {
    return {
      allowed: false,
      reason: `7-day realized edge ${(input.weeklyRealizedEdgePct * 100).toFixed(2)}% below ${(t.coldStreakMinRealizedEdgePct * 100).toFixed(2)}% floor`,
      breaker: "cold_streak_realized_edge",
      details,
    };
  }

  return {
    allowed: true,
    reason: "All capital-preservation breakers green",
    details,
  };
}
