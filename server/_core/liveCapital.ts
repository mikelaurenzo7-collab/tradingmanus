/**
 * Live Kalshi capital — read directly from the exchange, not from a static
 * "starting balance" config. As your account grows, every percentage-based
 * threshold (Kelly, drawdown, exposure caps, high-stakes cutoffs, scanner
 * tier) auto-scales with live balance.
 *
 * Cached for 30 seconds so the autonomy loop's tight tick doesn't hammer
 * the Kalshi balance endpoint.
 */

import { logger } from "./logger";
import { getPortfolioBalance } from "./kalshiClient";

const CACHE_TTL_MS = 30_000;
let _cache: { ts: number; usd: number } | null = null;

/**
 * Returns the current Kalshi account balance in USD. Uses a 30-second cache
 * to amortize the cost of a signed balance request across an autonomy tick.
 *
 * Failure mode: returns the last cached value if the live fetch fails. If
 * there is no cached value, returns 0 — and the caller (e.g. drawdown
 * breaker, Kelly sizer) will refuse to trade until balance is known.
 */
export async function getLiveCapitalUsd(opts: {
  /** Force a fresh fetch, bypassing the cache. */
  force?: boolean;
} = {}): Promise<number> {
  const now = Date.now();
  if (!opts.force && _cache && now - _cache.ts < CACHE_TTL_MS) {
    return _cache.usd;
  }

  try {
    const result = await getPortfolioBalance();
    // Kalshi returns balance in cents; the kalshiClient already converts
    // to dollars at the response shape. `result.balance` is cents-scale on
    // the raw API but our wrapper exposes it in dollars.
    const balance =
      typeof result?.balance === "number" && Number.isFinite(result.balance)
        ? result.balance / 100 // raw API gives cents; convert to USD here
        : 0;
    _cache = { ts: now, usd: balance };
    return balance;
  } catch (err) {
    logger.warn(
      { err, hasCachedValue: !!_cache },
      "[LiveCapital] balance fetch failed; using last cached value",
    );
    return _cache?.usd ?? 0;
  }
}

/**
 * Synchronous getter — returns the last-cached value (or 0 if none).
 * Use this in hot paths where awaiting a fetch isn't acceptable; pair
 * with a periodic refresh from `getLiveCapitalUsd()`.
 */
export function getCachedCapitalUsd(): number {
  return _cache?.usd ?? 0;
}

/**
 * Test helper — clears the cache so tests can mock `getPortfolioBalance`.
 */
export function _resetLiveCapitalCacheForTests(): void {
  _cache = null;
}
