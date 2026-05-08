/**
 * Per-market volatility estimator.
 *
 * Replaces the constant DEFAULT_VOLATILITY = 0.15 used by both exit monitors
 * with an empirical estimate from recent snapshots.  High-vol markets get
 * wider stops (avoiding noise-trip exits), low-vol markets get tighter stops
 * (locking in tighter profit/loss bands).
 *
 * Estimation approach (intentionally simple, no library dep):
 *   1. Load the last N snapshots (default 20) for the market, ordered by
 *      snapshotTime DESC.
 *   2. Take the per-period log-returns of the YES price.
 *   3. Compute the std-dev of those returns.
 *   4. Clamp to [0.02, 0.40] so a single outlier doesn't blow stops out
 *      and a zero-volatility quiet market doesn't get razor-thin stops.
 *
 * The result is a *normalised volatility figure* (not annualised) that
 * matches the input expected by exitStrategy.selectStopPct().
 *
 * Falls back to the constant fallback when there's not enough history or
 * the snapshots produce non-finite math — never throws.
 */

import { kalshiMarketSnapshots } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { getDb } from "../db";
import { logger } from "./logger";

const DEFAULT_VOLATILITY = 0.15;
const MIN_VOLATILITY = 0.02;
const MAX_VOLATILITY = 0.40;
const MIN_SNAPSHOTS = 5;
const SNAPSHOT_LIMIT = 20;

export function computeVolatilityFromPrices(prices: number[]): number {
  if (!Array.isArray(prices) || prices.length < MIN_SNAPSHOTS) {
    return DEFAULT_VOLATILITY;
  }

  const validPrices = prices.filter((p) => Number.isFinite(p) && p > 0 && p < 1);
  if (validPrices.length < MIN_SNAPSHOTS) {
    return DEFAULT_VOLATILITY;
  }

  // Log returns: ln(p_t / p_{t-1}).  Log returns are symmetric in price
  // direction and additive, which is the right shape for a vol estimate.
  const logReturns: number[] = [];
  for (let i = 1; i < validPrices.length; i++) {
    const prev = validPrices[i - 1];
    const cur = validPrices[i];
    if (prev <= 0 || cur <= 0) continue;
    logReturns.push(Math.log(cur / prev));
  }

  if (logReturns.length < MIN_SNAPSHOTS - 1) {
    return DEFAULT_VOLATILITY;
  }

  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance =
    logReturns.reduce((acc, r) => acc + (r - mean) * (r - mean), 0) /
    logReturns.length;
  const stdDev = Math.sqrt(variance);

  if (!Number.isFinite(stdDev) || stdDev <= 0) {
    return DEFAULT_VOLATILITY;
  }

  return Math.min(MAX_VOLATILITY, Math.max(MIN_VOLATILITY, stdDev));
}

const DEFAULT_ATR = 0.01;
const MIN_ATR = 0.002;
const MAX_ATR = 0.15;

/** Mean absolute price difference over consecutive snapshot prices. */
export function computeATRFromPrices(prices: number[]): number {
  const valid = prices.filter((p) => Number.isFinite(p) && p > 0 && p < 1);
  if (valid.length < 2) return DEFAULT_ATR;
  let total = 0;
  for (let i = 1; i < valid.length; i++) {
    total += Math.abs(valid[i] - valid[i - 1]);
  }
  const atr = total / (valid.length - 1);
  if (!Number.isFinite(atr) || atr <= 0) return DEFAULT_ATR;
  return Math.min(MAX_ATR, Math.max(MIN_ATR, atr));
}

export type MarketMetrics = { volatility: number; atr: number };

/**
 * Single DB query: returns both the per-period volatility (for stop-pct
 * selection) and the ATR (for trailing-stop gap sizing).  Old callers that
 * only need volatility can keep using estimateMarketVolatility(); this is
 * for the exit monitor which needs both.
 */
export async function estimateMarketMetrics(marketId: string): Promise<MarketMetrics> {
  const fallback: MarketMetrics = { volatility: DEFAULT_VOLATILITY, atr: DEFAULT_ATR };
  try {
    const database = await getDb();
    if (!database) return fallback;
    const rows = await database
      .select({ yesPrice: kalshiMarketSnapshots.yesPrice })
      .from(kalshiMarketSnapshots)
      .where(eq(kalshiMarketSnapshots.marketId, marketId))
      .orderBy(desc(kalshiMarketSnapshots.snapshotTime))
      .limit(SNAPSHOT_LIMIT);
    if (rows.length === 0) return fallback;
    const prices = rows
      .map((r: { yesPrice: number }) => Number(r.yesPrice))
      .reverse();
    return {
      volatility: computeVolatilityFromPrices(prices),
      atr: computeATRFromPrices(prices),
    };
  } catch (err) {
    logger.warn({ err, marketId }, "[marketVolatility] metrics estimate failed; using defaults");
    return fallback;
  }
}

/**
 * DB-bound version: loads recent snapshots for `marketId` and feeds them
 * into computeVolatilityFromPrices().  Returns DEFAULT_VOLATILITY on any
 * read failure.
 */
export async function estimateMarketVolatility(marketId: string): Promise<number> {
  return (await estimateMarketMetrics(marketId)).volatility;
}

export const MARKET_VOLATILITY_DEFAULT = DEFAULT_VOLATILITY;
