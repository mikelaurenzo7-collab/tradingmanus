/**
 * Kalshi fee calculator — exact, round-up-to-cent formula.
 *
 * Kalshi fee on a fill of `count` contracts at price `p` (in dollars, 0..1):
 *   fee_per_contract = round_up_to_cent(multiplier × count × p × (1 − p))
 *   maker multiplier = 0.0175  (limit orders that rest)
 *   taker multiplier = 0.07    (orders that cross the book)
 *
 * Returned amount is in DOLLARS (rounded up to the cent). Always strictly
 * positive when count > 0 and 0 < p < 1.
 *
 * Strongly prefer maker (limit) orders for the cheaper tier.
 */

import { ENV } from "./env";

/** Round a dollar amount UP to the nearest cent. */
export function roundUpToCent(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  // Use integer-cents math to avoid binary-float rounding glitches.
  return Math.ceil(usd * 100) / 100;
}

export type Liquidity = "maker" | "taker";

/** Per-contract fee in dollars, before per-fill aggregation. */
export function perContractFeeUsd(price: number, liquidity: Liquidity): number {
  if (price <= 0 || price >= 1 || !Number.isFinite(price)) return 0;
  const m =
    liquidity === "maker"
      ? ENV.kalshiMakerFeeMultiplier
      : ENV.kalshiTakerFeeMultiplier;
  // Kalshi rounds up the *aggregate* fee, not per contract — see calculateFillFeeUsd.
  return m * price * (1 - price);
}

/**
 * Total fee (USD) for a fill of `count` contracts at `price`, rounded up to
 * the cent per Kalshi's published fee schedule.
 *
 *   round_up_to_cent(multiplier × count × p × (1 − p))
 */
export function calculateFillFeeUsd(input: {
  count: number;
  price: number;
  liquidity: Liquidity;
}): number {
  const { count, price, liquidity } = input;
  if (count <= 0 || price <= 0 || price >= 1) return 0;
  const m =
    liquidity === "maker"
      ? ENV.kalshiMakerFeeMultiplier
      : ENV.kalshiTakerFeeMultiplier;
  return roundUpToCent(m * count * price * (1 - price));
}

/**
 * Round-trip fee estimate (entry + exit), assuming exit at the same price
 * (worst-case symmetry; in practice profitable exits pay a slightly different
 * fee). Used by the EV gate to subtract round-trip cost up front.
 */
export function calculateRoundTripFeeUsd(input: {
  count: number;
  entryPrice: number;
  exitPrice?: number;
  entryLiquidity: Liquidity;
  exitLiquidity: Liquidity;
}): number {
  const entryFee = calculateFillFeeUsd({
    count: input.count,
    price: input.entryPrice,
    liquidity: input.entryLiquidity,
  });
  const exitFee = calculateFillFeeUsd({
    count: input.count,
    price: input.exitPrice ?? input.entryPrice,
    liquidity: input.exitLiquidity,
  });
  return entryFee + exitFee;
}

/**
 * Net EV calculator: convert "gross" expected-value (model edge over fair
 * price) into post-fee, post-AI-cost EV.
 *
 *   notional        = count × entryPrice                                (USD)
 *   grossEdgeUsd    = grossEvFraction × notional
 *   roundTripFee    = exact Kalshi fee at entry + (assumed) exit
 *   amortizedAiCost = ENV.grokCostPerReviewUsd  (per review — already amortized)
 *   netEvUsd        = grossEdgeUsd − roundTripFee − amortizedAiCost
 *   netEvFraction   = netEvUsd / notional
 *
 * `grossEvFraction` is the Grok-reviewed expected return as a fraction of
 * notional (e.g. 0.10 = 10 % edge).
 */
export function calculateNetEv(input: {
  count: number;
  entryPrice: number;
  grossEvFraction: number;
  entryLiquidity?: Liquidity;
  exitLiquidity?: Liquidity;
  exitPrice?: number;
  amortizedAiCostUsd?: number;
}): {
  notionalUsd: number;
  grossEdgeUsd: number;
  feeUsd: number;
  aiCostUsd: number;
  netEvUsd: number;
  netEvFraction: number;
} {
  const notionalUsd = Math.max(0, input.count * input.entryPrice);
  const grossEdgeUsd = notionalUsd * input.grossEvFraction;
  const feeUsd = calculateRoundTripFeeUsd({
    count: input.count,
    entryPrice: input.entryPrice,
    exitPrice: input.exitPrice,
    entryLiquidity: input.entryLiquidity ?? "maker",
    exitLiquidity: input.exitLiquidity ?? "maker",
  });
  const aiCostUsd =
    input.amortizedAiCostUsd ?? ENV.grokCostPerReviewUsd ?? 0;
  const netEvUsd = grossEdgeUsd - feeUsd - aiCostUsd;
  const netEvFraction = notionalUsd > 0 ? netEvUsd / notionalUsd : 0;
  return {
    notionalUsd,
    grossEdgeUsd,
    feeUsd,
    aiCostUsd,
    netEvUsd,
    netEvFraction,
  };
}
