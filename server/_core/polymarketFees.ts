/**
 * Polymarket round-trip cost calculator (fees + spread-cross).
 *
 * Phase 2 of the hardening pass.  Polymarket's CLOB charges 0 % taker
 * fee on binaries (per https://docs.polymarket.com/#fees as of 2026-Q1)
 * and gas on Polygon is subsidized via the proxy wallet (~$0.02 round
 * trip on small notionals; flat).  Spread is the dominant cost — the
 * book is typically tighter than Kalshi (1-2 ¢ on liquid markets,
 * 3-8 ¢ on long-tail political/sports markets).
 *
 * Returns the same `RoundTripCost` shape as `kalshiFees` so the EV gate,
 * audit log, and signal persistence treat the two platforms uniformly.
 *
 * Pricing pinned to `feeScheduleVersion = '2026-Q1'`.  When Polymarket
 * publishes a fee change (rare), bump this constant + any per-leg fee
 * constants below and add a regression test row.
 */

import type { RoundTripCost } from "./kalshiFees";

export const POLYMARKET_FEE_SCHEDULE_VERSION = "2026-Q1";

/** Subsidized gas estimate (USD) per round-trip Polymarket trade. */
const POLYMARKET_ROUND_TRIP_GAS_USD = 0.02;

interface ComputePolymarketRoundTripCostArgs {
  /** Side-specific entry price in cents (1-99). */
  priceCents: number;
  /** Number of contracts (USDC equivalent units). */
  contracts: number;
  /** Best bid in cents on the side being bought. */
  bestBidCents: number;
  /** Best ask in cents on the side being bought. */
  bestAskCents: number;
}

export function computePolymarketRoundTripCost(
  args: ComputePolymarketRoundTripCostArgs,
): RoundTripCost {
  const priceCents = clampCents(args.priceCents);
  const contracts = Math.max(0, Math.floor(args.contracts));
  const bestBidCents = clampCents(args.bestBidCents);
  const bestAskCents = clampCents(args.bestAskCents);

  const entryPriceUsd = priceCents / 100;
  const notionalUsd = contracts * entryPriceUsd;

  // Polymarket: 0% taker fee on binaries.  Round-trip cost is gas only.
  const feeUsd = contracts > 0 ? POLYMARKET_ROUND_TRIP_GAS_USD : 0;

  const halfSpreadCents = Math.max(0, (bestAskCents - bestBidCents) / 2);
  const spreadCostUsd = (halfSpreadCents / 100) * contracts * 2;

  const totalCostUsd = feeUsd + spreadCostUsd;
  const costAsFraction = notionalUsd > 0 ? totalCostUsd / notionalUsd : 0;

  return {
    feeUsd,
    spreadCostUsd,
    totalCostUsd,
    costAsFraction,
    notionalUsd,
    priceCents,
    contracts,
    bestBidCents,
    bestAskCents,
    feeScheduleVersion: POLYMARKET_FEE_SCHEDULE_VERSION,
  };
}

/**
 * Convenience wrapper: derive bid/ask from a Polymarket signal's
 * `limitPrice` + an estimated spread.  Polymarket signals already carry
 * a side-specific limitPrice; we approximate the half-spread when the
 * orderbook isn't passed in.
 *
 * Default spread assumption: 2 ¢ on liquid mid-price markets.  Operator
 * can override via `spreadCents` when the orderbook is available.
 */
export function computePolymarketRoundTripCostFromLimit(args: {
  limitPriceUsd: number;
  contracts: number;
  spreadCents?: number;
}): RoundTripCost {
  const priceCents = Math.round(Math.max(0, Math.min(1, args.limitPriceUsd)) * 100);
  const spreadCents = Math.max(1, Math.round(args.spreadCents ?? 2));
  const half = spreadCents / 2;
  return computePolymarketRoundTripCost({
    priceCents,
    contracts: args.contracts,
    bestBidCents: clampCents(priceCents - half),
    bestAskCents: clampCents(priceCents + half),
  });
}

function clampCents(c: number): number {
  if (!Number.isFinite(c)) return 0;
  if (c < 0) return 0;
  if (c > 100) return 100;
  return c;
}
