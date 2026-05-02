/**
 * Cold-start sizing.
 *
 * A fresh account has no track record on this strategy stack.  Even if
 * synthetic backtests look good, the strategy may interact badly with this
 * specific user's chosen markets, posture, or personal preferences in ways
 * we won't detect until real trades resolve.  Cold-start sizing scales the
 * bot's bet size DOWN until the account has either (a) lived long enough
 * or (b) executed enough trades to give us a real-world track record.
 *
 * The scale starts at COLD_START_SIZE_FLOOR (default 10%) and ramps
 * linearly to 1.0 as the account graduates.  Two conditions, whichever
 * comes first, finish the ramp:
 *   - account age >= COLD_START_DAYS (default 30 days)
 *   - completed trades >= COLD_START_TRADES (default 30 trades)
 *
 * When both numbers are zero/undefined the function returns 1.0 (no
 * scaling), which means the feature is opt-in via env.
 */

import { ENV } from "./env";

export type ColdStartInputs = {
  /** Days since the user's account was created.  May be 0 for brand-new accounts. */
  accountAgeDays: number;
  /**
   * Trades that have completed (won, lost, or scratched) for this user
   * across all platforms.  Open positions don't count yet — we only care
   * about realized outcomes.
   */
  completedTrades: number;
};

export type ColdStartScale = {
  /** Multiplier in [floor, 1.0] to apply to the recommended bet size. */
  scale: number;
  /** Reason this scale was chosen, for audit logs. */
  reason: "graduated" | "ramping_age" | "ramping_trades" | "feature_off";
  /** Progress toward graduation in [0, 1].  1.0 means graduated. */
  progress: number;
};

function clamp(value: number, lo: number, hi: number) {
  if (!Number.isFinite(value)) return lo;
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Compute the cold-start size scale for an account.  Pure function — pass
 * the account's age + trade count, get back a multiplier the autonomy
 * loop applies to the recommended order size.
 *
 * Both axes (age, trade count) are checked; we take the MAX of their
 * progress so a user who hits one threshold quickly still graduates.
 */
export function computeColdStartScale(
  inputs: ColdStartInputs,
  options: {
    enabled?: boolean;
    floor?: number;
    daysToGraduate?: number;
    tradesToGraduate?: number;
  } = {},
): ColdStartScale {
  const enabled = options.enabled ?? ENV.enableColdStartSizing;
  if (!enabled) return { scale: 1, reason: "feature_off", progress: 1 };

  const floor = clamp(options.floor ?? ENV.coldStartSizeFloor, 0.01, 1);
  const days = Math.max(1, options.daysToGraduate ?? ENV.coldStartDays);
  const trades = Math.max(1, options.tradesToGraduate ?? ENV.coldStartTrades);

  const ageProgress = clamp(inputs.accountAgeDays / days, 0, 1);
  const tradeProgress = clamp(inputs.completedTrades / trades, 0, 1);
  const progress = Math.max(ageProgress, tradeProgress);

  if (progress >= 1) {
    return { scale: 1, reason: "graduated", progress: 1 };
  }

  // Linear ramp from floor to 1.0 as progress goes from 0 to 1.
  const scale = floor + (1 - floor) * progress;
  return {
    scale,
    reason: ageProgress >= tradeProgress ? "ramping_age" : "ramping_trades",
    progress,
  };
}
