/**
 * Kalshi round-trip cost calculator (fees + spread-cross).
 *
 * Phase 2 of the hardening pass.  The pre-Phase-2 EV gate subtracted only
 * the published Kalshi fee schedule from gross EV, ignoring spread cost.
 * On illiquid Kalshi markets the bid-ask spread is routinely 2-5 ¢ wide
 * — at a 30 ¢ contract that's a 7-17 % round-trip cost, larger than the
 * 5 % MIN_NET_EV floor.  Trades that look profitable on paper get
 * destroyed by spread crossing.
 *
 * This module composes the existing exact fee math (`feeCalculator.ts`)
 * with a half-spread × 2 = full-spread round-trip cost model.  Returns a
 * structured `RoundTripCost` that the EV gate, audit log, and signal
 * persistence all consume.
 *
 * Pricing pinned to `feeScheduleVersion = '2026-Q1'`.  When Kalshi
 * publishes a new schedule, bump this constant + the fee multipliers in
 * env.ts and add a regression test row.
 */

import { calculateFillFeeUsd, type Liquidity } from "./feeCalculator";
import type { KalshiMarket } from "./kalshiMarketData";

export const KALSHI_FEE_SCHEDULE_VERSION = "2026-Q1";

export interface RoundTripCost {
  /** Round-trip exchange fees (entry + exit), USD, rounded up to cent. */
  feeUsd: number;
  /** Round-trip spread cross cost (entry + exit), USD. */
  spreadCostUsd: number;
  /** feeUsd + spreadCostUsd. */
  totalCostUsd: number;
  /** totalCostUsd / notionalUsd — what the EV gate subtracts. */
  costAsFraction: number;
  /** count × entryPriceUsd. */
  notionalUsd: number;
  /** Echoed for audit-log diagnostics. */
  priceCents: number;
  contracts: number;
  bestBidCents: number;
  bestAskCents: number;
  feeScheduleVersion: string;
}

interface ComputeKalshiRoundTripCostArgs {
  /** Side-specific entry price in cents (1-99). */
  priceCents: number;
  /** Number of contracts. */
  contracts: number;
  /** Best bid in cents on the side being bought. */
  bestBidCents: number;
  /** Best ask in cents on the side being bought. */
  bestAskCents: number;
  /** Liquidity of the entry leg.  Defaults to taker (worst-case). */
  entryLiquidity?: Liquidity;
  /** Liquidity of the exit leg.  Defaults to taker (worst-case). */
  exitLiquidity?: Liquidity;
}

/**
 * Compute the round-trip cost for one prospective Kalshi trade.
 *
 * Spread cost model:
 *   half_spread_cents = max(0, (bestAsk − bestBid) / 2)
 *   round_trip_spread_usd = half_spread_cents/100 × contracts × 2
 *
 * Defaults (entry/exit both taker) bias the gate conservative — the
 * actual autonomy prefers maker via PREFER_MAKER_ORDERS=true; passing
 * `entryLiquidity: "maker"` reflects that and lowers the cost estimate.
 */
export function computeKalshiRoundTripCost(
  args: ComputeKalshiRoundTripCostArgs,
): RoundTripCost {
  const priceCents = clampCents(args.priceCents);
  const contracts = Math.max(0, Math.floor(args.contracts));
  const bestBidCents = clampCents(args.bestBidCents);
  const bestAskCents = clampCents(args.bestAskCents);

  const entryPriceUsd = priceCents / 100;
  const notionalUsd = contracts * entryPriceUsd;

  const entryFeeUsd = calculateFillFeeUsd({
    count: contracts,
    price: entryPriceUsd,
    liquidity: args.entryLiquidity ?? "taker",
  });
  const exitFeeUsd = calculateFillFeeUsd({
    count: contracts,
    price: entryPriceUsd,
    liquidity: args.exitLiquidity ?? "taker",
  });
  const feeUsd = entryFeeUsd + exitFeeUsd;

  // Spread cost: paying half the bid-ask spread on each leg.
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
    feeScheduleVersion: KALSHI_FEE_SCHEDULE_VERSION,
  };
}

/**
 * Convenience wrapper: derive bid/ask from a `KalshiMarket` snapshot.
 *
 * The autonomy hot path doesn't carry live orderbook data — only
 * yesPrice / noPrice from the snapshot.  We approximate the spread from
 * `|yesPrice + noPrice − 1|` (the kalshiSignals "spreadProxy") and
 * center it on the side-specific price.
 *
 * Use this in `profitGuardrails` and pre-sizing audits where adding an
 * orderbook fetch would slow the autonomy tick.  When a precise quote
 * is available (post-execution audit, cross-platform arb), use the
 * primary `computeKalshiRoundTripCost` directly.
 */
export function computeKalshiRoundTripCostFromMarket(args: {
  market: Pick<KalshiMarket, "yesPrice" | "noPrice">;
  side: "yes" | "no";
  contracts: number;
  spreadProxy?: number;
  entryLiquidity?: Liquidity;
  exitLiquidity?: Liquidity;
}): RoundTripCost {
  const priceUsd = args.side === "yes" ? args.market.yesPrice : args.market.noPrice;
  const priceCents = Math.round(priceUsd * 100);
  // |y + n − 1| in dollars; defaults to a small floor when the snapshot
  // is missing the field (treat as 1¢ spread to keep the gate honest).
  const proxyDollars =
    args.spreadProxy != null && Number.isFinite(args.spreadProxy)
      ? Math.max(0, Number(args.spreadProxy))
      : Math.max(0, Math.abs(args.market.yesPrice + args.market.noPrice - 1));
  const proxyCents = Math.max(1, Math.round(proxyDollars * 100));
  // Center the bid/ask around priceCents with the proxy as full-spread.
  const half = proxyCents / 2;
  const bestBidCents = clampCents(priceCents - half);
  const bestAskCents = clampCents(priceCents + half);
  return computeKalshiRoundTripCost({
    priceCents,
    contracts: args.contracts,
    bestBidCents,
    bestAskCents,
    entryLiquidity: args.entryLiquidity,
    exitLiquidity: args.exitLiquidity,
  });
}

function clampCents(c: number): number {
  if (!Number.isFinite(c)) return 0;
  if (c < 0) return 0;
  if (c > 100) return 100;
  return c;
}
