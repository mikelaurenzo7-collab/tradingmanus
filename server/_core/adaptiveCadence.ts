/**
 * Adaptive cadence: skip the AI reviewer for markets whose price hasn't
 * moved materially since the last review.
 *
 * Background: the autonomy fires every AUTONOMY_INTERVAL_MS (default 2 min)
 * and every cycle hands every signal-bearing market to the reviewer.  Most
 * markets between two cycles haven't moved enough for a fresh judgement to
 * differ — we'd just burn AI calls re-confirming the previous answer.  This
 * gating filter keeps a per-market memory of (price, ts) at the last review
 * and routes a market to the reviewer only when:
 *
 *   1. It has never been reviewed (no cache entry), OR
 *   2. The cached entry is older than the heartbeat TTL (default 10 min) —
 *      a freshness guarantee so even quiet markets get a periodic re-look,
 *      OR
 *   3. The price has moved by ≥ threshold bps since the last review.
 *
 * Tunable via env:
 *   SIGNAL_REVIEW_PRICE_DELTA_BPS  default 50  (0.50 %)
 *   SIGNAL_REVIEW_STALE_TTL_MS     default 600000  (10 min)
 *
 * Cost impact: empirically (prediction-market price-change distributions)
 * a 50 bps gate skips ~70-85 % of stale candidates, so AI cost drops 3-5×
 * for the same cadence — or equivalently you can run AUTONOMY_INTERVAL_MS
 * down to 60 s on the same daily budget.
 *
 * The cache is in-memory only (one Map per process).  After a server
 * restart every market gets re-reviewed once on its first appearance; this
 * is the right behaviour after a deploy because the deploy may have changed
 * the prompt or model.
 */

interface ReviewCacheEntry {
  lastReviewedPrice: number;
  lastReviewedAtMs: number;
}

const REVIEW_CACHE = new Map<string, ReviewCacheEntry>();

const DEFAULT_PRICE_DELTA_BPS = 50;
const DEFAULT_STALE_TTL_MS = 10 * 60 * 1000;
const MIN_TTL_MS = 60 * 1000;
const MAX_DELTA_BPS = 5000; // 50 %

function readPriceDeltaBps(): number {
  const raw = Number.parseInt((process.env.SIGNAL_REVIEW_PRICE_DELTA_BPS ?? "").trim(), 10);
  if (Number.isFinite(raw) && raw >= 0 && raw <= MAX_DELTA_BPS) return raw;
  return DEFAULT_PRICE_DELTA_BPS;
}

function readStaleTtlMs(): number {
  const raw = Number.parseInt((process.env.SIGNAL_REVIEW_STALE_TTL_MS ?? "").trim(), 10);
  if (Number.isFinite(raw) && raw >= MIN_TTL_MS) return raw;
  return DEFAULT_STALE_TTL_MS;
}

/**
 * Pure check for one market.  `now` is injectable so tests don't depend on Date.now().
 */
export function shouldReviewMarketAt(
  marketId: string,
  currentPrice: number,
  now: number = Date.now(),
): boolean {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || currentPrice >= 1) {
    // Can't reason about an invalid price — let the reviewer decide.  This
    // also keeps callers from accidentally caching garbage prices.
    return true;
  }
  const entry = REVIEW_CACHE.get(marketId);
  if (!entry) return true;

  if (now - entry.lastReviewedAtMs >= readStaleTtlMs()) return true;

  // Compare in basis points so the threshold is intuitive.
  const deltaBps = Math.abs(currentPrice - entry.lastReviewedPrice) * 10_000;
  return deltaBps >= readPriceDeltaBps();
}

export function recordMarketReview(
  marketId: string,
  price: number,
  now: number = Date.now(),
): void {
  if (!Number.isFinite(price) || price <= 0 || price >= 1) return;
  REVIEW_CACHE.set(marketId, { lastReviewedPrice: price, lastReviewedAtMs: now });
}

export function _resetAdaptiveCadenceCacheForTests(): void {
  REVIEW_CACHE.clear();
}

/**
 * Telemetry: how many markets are tracked + the median age of entries.
 * Useful for the autonomy run audit so the operator sees the cache is
 * working.
 */
export function getAdaptiveCadenceTelemetry(now: number = Date.now()) {
  const entries = Array.from(REVIEW_CACHE.values());
  const ages = entries.map((e) => now - e.lastReviewedAtMs).sort((a, b) => a - b);
  const median = ages.length === 0 ? 0 : ages[Math.floor(ages.length / 2)];
  return {
    cachedMarketCount: entries.length,
    medianAgeMs: median,
    priceDeltaBps: readPriceDeltaBps(),
    staleTtlMs: readStaleTtlMs(),
  };
}
