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
