/**
 * Fractional Kelly position sizing for the personal Kalshi dashboard.
 *
 * For a binary contract bought at price `p` (in dollars, 0..1):
 *   payoff if YES = 1 - p
 *   payoff if NO  = -p
 *   netOdds b      = (1 - p) / p
 *
 * Full Kelly: f* = (winProb × b - lossProb) / b
 *
 * We apply fractional Kelly (default ½) and clamp the result into [KELLY_MIN_PCT, KELLY_MAX_PCT]
 * of capital (defaults: 0.5%–2%). Below the floor we return 0 instead of
 * the floor — never force a position when the edge is too thin to justify it.
 */

import { ENV } from "./env";

export interface KellySizeInput {
  /** Operator-estimated probability the contract resolves YES (0..1). */
  winProbability: number;
  /** Current YES contract price in dollars (0..1). */
  contractPrice: number;
  /** Total available capital in USD. */
  totalCapitalUsd: number;
}

export interface KellySizeResult {
  /** Full Kelly fraction (may be negative for negative-edge bets). */
  fullKelly: number;
  /** Fractional Kelly (default ½) fraction, clamped into [min, max]. */
  fractionalKelly: number;
  /** USD position size. 0 when edge is below the floor. */
  positionUsd: number;
  /** Number of YES contracts to buy at the given price. */
  contractCount: number;
  /** True when the raw Kelly fraction is at-or-above the configured floor. */
  meetsMinFloor: boolean;
  /** Diagnostic: explanation for caller / dashboard. */
  reason: string;
}

/**
 * Calculate fractional Kelly (default ½) position size, clamped to [floor, cap].
 *
 * Returns 0 when:
 *   - inputs are invalid / non-finite
 *   - winProbability ≤ contractPrice (no edge)
 *   - the Kelly fraction is below the configured floor (not worth the bet)
 */
export function calculateKellyPosition(
  input: KellySizeInput,
): KellySizeResult {
  const p = input.winProbability;
  const price = input.contractPrice;
  const cap = input.totalCapitalUsd;

  const fraction = ENV.profitGuardrails.kellyFraction; // fractional Kelly (default ½)
  const min = ENV.profitGuardrails.kellyMinPctOfCapital; // 0.5 %
  const max = ENV.profitGuardrails.kellyMaxPctOfCapital; // default 4 %

  const empty = (reason: string): KellySizeResult => ({
    fullKelly: 0,
    fractionalKelly: 0,
    positionUsd: 0,
    contractCount: 0,
    meetsMinFloor: false,
    reason,
  });

  if (
    !Number.isFinite(p) ||
    !Number.isFinite(price) ||
    !Number.isFinite(cap)
  ) {
    return empty("non-finite input");
  }
  if (cap <= 0) return empty("zero capital");
  if (p <= 0 || p >= 1) return empty("invalid winProbability");
  if (price <= 0 || price >= 1) return empty("invalid contractPrice");
  if (p <= price) return empty("no edge — winProb ≤ marketPrice");

  const b = (1 - price) / price; // net odds
  const fullKelly = (p * b - (1 - p)) / b;
  if (fullKelly <= 0) return empty("fullKelly ≤ 0");

  const scaled = fullKelly * fraction;
  const clamped = Math.min(max, Math.max(0, scaled));

  if (clamped < min) {
    return {
      fullKelly,
      fractionalKelly: clamped,
      positionUsd: 0,
      contractCount: 0,
      meetsMinFloor: false,
      reason: `Kelly fraction ${clamped.toFixed(4)} below ${(
        min * 100
      ).toFixed(2)}% floor — skip`,
    };
  }

  const positionUsd = clamped * cap;
  // Round DOWN so we never spend more than the Kelly cap.
  const contractCount = Math.max(0, Math.floor(positionUsd / price));

  return {
    fullKelly,
    fractionalKelly: clamped,
    positionUsd: contractCount * price,
    contractCount,
    meetsMinFloor: true,
    reason: `fractional Kelly (default ½) = ${(clamped * 100).toFixed(2)}% of $${cap.toFixed(2)}`,
  };
}
