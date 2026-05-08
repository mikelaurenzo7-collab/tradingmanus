/**
 * Tests for the adaptive-cadence gating module.
 *
 * The clock is injected explicitly via the `now` parameter so we don't
 * have to fake-timer or mock Date.now().
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  shouldReviewMarketAt,
  recordMarketReview,
  getAdaptiveCadenceTelemetry,
  _resetAdaptiveCadenceCacheForTests,
} from "./_core/adaptiveCadence";

const T0 = 1_700_000_000_000;

beforeEach(() => {
  _resetAdaptiveCadenceCacheForTests();
  delete process.env.SIGNAL_REVIEW_PRICE_DELTA_BPS;
  delete process.env.SIGNAL_REVIEW_STALE_TTL_MS;
});

afterEach(() => {
  _resetAdaptiveCadenceCacheForTests();
});

describe("shouldReviewMarketAt", () => {
  it("allows review for a market never seen before", () => {
    expect(shouldReviewMarketAt("KX-NEW", 0.5, T0)).toBe(true);
  });

  it("blocks review when the price is unchanged within the staleness window", () => {
    recordMarketReview("KX-A", 0.5, T0);
    // 1 second later, same price → still cached
    expect(shouldReviewMarketAt("KX-A", 0.5, T0 + 1000)).toBe(false);
  });

  it("allows review when the price has moved past the default 50 bps threshold", () => {
    recordMarketReview("KX-A", 0.5, T0);
    // 0.5 → 0.5051 = 51 bps move (>= 50 bps threshold)
    expect(shouldReviewMarketAt("KX-A", 0.5051, T0 + 1000)).toBe(true);
  });

  it("blocks review when the price has moved less than the threshold", () => {
    recordMarketReview("KX-A", 0.5, T0);
    // 0.5 → 0.5049 = 49 bps move (< 50 bps threshold)
    expect(shouldReviewMarketAt("KX-A", 0.5049, T0 + 1000)).toBe(false);
  });

  it("allows review once the staleness TTL elapses, even if price unchanged", () => {
    recordMarketReview("KX-A", 0.5, T0);
    // Default TTL is 10 min = 600_000 ms
    expect(shouldReviewMarketAt("KX-A", 0.5, T0 + 600_001)).toBe(true);
    expect(shouldReviewMarketAt("KX-A", 0.5, T0 + 599_000)).toBe(false);
  });

  it("treats invalid current prices as 'always review' (delegates to reviewer)", () => {
    recordMarketReview("KX-A", 0.5, T0);
    expect(shouldReviewMarketAt("KX-A", NaN, T0 + 1000)).toBe(true);
    expect(shouldReviewMarketAt("KX-A", 0, T0 + 1000)).toBe(true);
    expect(shouldReviewMarketAt("KX-A", 1.0, T0 + 1000)).toBe(true);
  });

  it("respects SIGNAL_REVIEW_PRICE_DELTA_BPS env override", () => {
    process.env.SIGNAL_REVIEW_PRICE_DELTA_BPS = "200"; // 2 % threshold
    recordMarketReview("KX-A", 0.5, T0);
    // 0.5 → 0.51 = 100 bps; below 200 bps threshold → blocked
    expect(shouldReviewMarketAt("KX-A", 0.51, T0 + 1000)).toBe(false);
    // 0.5 → 0.52 = 200 bps → allowed
    expect(shouldReviewMarketAt("KX-A", 0.52, T0 + 1000)).toBe(true);
  });

  it("respects SIGNAL_REVIEW_STALE_TTL_MS env override", () => {
    process.env.SIGNAL_REVIEW_STALE_TTL_MS = "60000"; // 1 min TTL
    recordMarketReview("KX-A", 0.5, T0);
    expect(shouldReviewMarketAt("KX-A", 0.5, T0 + 59_000)).toBe(false);
    expect(shouldReviewMarketAt("KX-A", 0.5, T0 + 60_001)).toBe(true);
  });

  it("ignores invalid env values and falls back to defaults", () => {
    process.env.SIGNAL_REVIEW_PRICE_DELTA_BPS = "not-a-number";
    process.env.SIGNAL_REVIEW_STALE_TTL_MS = "0"; // below MIN_TTL_MS
    recordMarketReview("KX-A", 0.5, T0);
    // Default 50 bps applies → 30 bps move is blocked
    expect(shouldReviewMarketAt("KX-A", 0.503, T0 + 1000)).toBe(false);
    // Default 10-min TTL applies (not 0)
    expect(shouldReviewMarketAt("KX-A", 0.5, T0 + 1000)).toBe(false);
  });

  it("isolates state per marketId", () => {
    recordMarketReview("KX-A", 0.5, T0);
    recordMarketReview("KX-B", 0.6, T0);
    // KX-A unchanged → blocked
    expect(shouldReviewMarketAt("KX-A", 0.5, T0 + 1000)).toBe(false);
    // KX-B at 0.65 = 500 bps move → allowed
    expect(shouldReviewMarketAt("KX-B", 0.65, T0 + 1000)).toBe(true);
  });
});

describe("recordMarketReview", () => {
  it("ignores invalid prices (no entry created)", () => {
    recordMarketReview("KX-A", NaN, T0);
    recordMarketReview("KX-B", 0, T0);
    recordMarketReview("KX-C", 1.0, T0);
    // None of these should have created cache entries → all are 'never seen'
    expect(shouldReviewMarketAt("KX-A", 0.5, T0 + 1000)).toBe(true);
    expect(shouldReviewMarketAt("KX-B", 0.5, T0 + 1000)).toBe(true);
    expect(shouldReviewMarketAt("KX-C", 0.5, T0 + 1000)).toBe(true);
  });

  it("updates the cached price + timestamp on subsequent calls", () => {
    recordMarketReview("KX-A", 0.5, T0);
    // Second record at a new price/time becomes the new baseline
    recordMarketReview("KX-A", 0.6, T0 + 60_000);
    // Now the gate uses 0.6 as the baseline
    expect(shouldReviewMarketAt("KX-A", 0.6, T0 + 60_001)).toBe(false);
    // 0.6 → 0.61 = 100 bps move → allowed (above default 50 bps)
    expect(shouldReviewMarketAt("KX-A", 0.61, T0 + 60_001)).toBe(true);
  });
});

describe("per-category cadence", () => {
  // Crypto: 1 min TTL.  Sports: 2 min.  Weather: 15 min.
  it("uses 1-min stale TTL for crypto by default (env unset)", () => {
    recordMarketReview("CR-1", 0.5, T0);
    // 30s later, no price move → should NOT review yet (under 1 min ttl).
    expect(shouldReviewMarketAt("CR-1", 0.5, { category: "crypto" }, T0 + 30_000)).toBe(false);
    // 70s later → past 1 min ttl → re-review.
    expect(shouldReviewMarketAt("CR-1", 0.5, { category: "crypto" }, T0 + 70_000)).toBe(true);
  });

  it("uses 15-min stale TTL for weather by default (env unset)", () => {
    recordMarketReview("WX-1", 0.5, T0);
    // 5 min later, no price move → still under weather's 15-min TTL.
    expect(shouldReviewMarketAt("WX-1", 0.5, { category: "weather" }, T0 + 5 * 60_000)).toBe(false);
    // 16 min later → past 15-min TTL → re-review.
    expect(shouldReviewMarketAt("WX-1", 0.5, { category: "weather" }, T0 + 16 * 60_000)).toBe(true);
  });

  it("near-resolution multiplier tightens TTL aggressively (<1h to resolve)", () => {
    // Sports market: base 2-min TTL.  At <1h to resolution, multiplier
    // is 0.1 → 12s effective TTL (but floored at MIN_TTL_MS=60_000).
    // Floor applies, so TTL = 60_000.
    recordMarketReview("SP-1", 0.5, T0);
    // 30s later → still under 60s floor → no review.
    expect(
      shouldReviewMarketAt("SP-1", 0.5, { category: "sports", hoursToResolution: 0.5 }, T0 + 30_000),
    ).toBe(false);
    // 65s later → past floor → review.
    expect(
      shouldReviewMarketAt("SP-1", 0.5, { category: "sports", hoursToResolution: 0.5 }, T0 + 65_000),
    ).toBe(true);
  });

  it("env override wins over per-category default when SIGNAL_REVIEW_STALE_TTL_MS is set", () => {
    process.env.SIGNAL_REVIEW_STALE_TTL_MS = String(120_000); // 2 min
    recordMarketReview("CR-1", 0.5, T0);
    // 70s later → would be past crypto's 60s default but under env's 120s.
    expect(shouldReviewMarketAt("CR-1", 0.5, { category: "crypto" }, T0 + 70_000)).toBe(false);
    expect(shouldReviewMarketAt("CR-1", 0.5, { category: "crypto" }, T0 + 130_000)).toBe(true);
  });

  it("uses 30bps price-delta threshold for crypto (vs 100bps for weather)", () => {
    recordMarketReview("CR-1", 0.50, T0);
    recordMarketReview("WX-1", 0.50, T0);
    // 40bps move (0.50 → 0.504): triggers crypto, not weather.
    expect(shouldReviewMarketAt("CR-1", 0.504, { category: "crypto" }, T0 + 1_000)).toBe(true);
    expect(shouldReviewMarketAt("WX-1", 0.504, { category: "weather" }, T0 + 1_000)).toBe(false);
  });
});

describe("getAdaptiveCadenceTelemetry", () => {
  it("reports zero when the cache is empty", () => {
    const t = getAdaptiveCadenceTelemetry(T0);
    expect(t.cachedMarketCount).toBe(0);
    expect(t.medianAgeMs).toBe(0);
    expect(t.priceDeltaBps).toBe(50);
    expect(t.staleTtlMs).toBe(600_000);
  });

  it("reports the cached count and a median age across entries", () => {
    recordMarketReview("KX-A", 0.5, T0);
    recordMarketReview("KX-B", 0.5, T0 + 1000);
    recordMarketReview("KX-C", 0.5, T0 + 2000);
    const t = getAdaptiveCadenceTelemetry(T0 + 5000);
    expect(t.cachedMarketCount).toBe(3);
    // Ages: 5000, 4000, 3000 → median 4000
    expect(t.medianAgeMs).toBe(4000);
  });
});
