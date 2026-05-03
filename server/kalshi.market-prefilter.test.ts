/**
 * Tests for the market pre-filtering functions added to kalshiAutonomy.
 *
 * extractActionableMarkets:
 *   - excludes thin markets (total volume < MIN_SCHEDULED_MARKET_VOLUME)
 *   - excludes markets resolving within MIN_RESOLUTION_HOURS_AHEAD hours
 *   - excludes markets already past their resolution date
 *   - passes through well-formed, liquid, non-expiring markets
 *
 * selectDiverseMarkets:
 *   - enforces per-category caps
 *   - within each category, picks the highest-volume markets first
 */

import { describe, expect, it } from "vitest";
import { extractActionableMarkets, selectDiverseMarkets } from "./_core/kalshiAutonomy";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Build a minimal valid KalshiMarket object; callers can override any field.
function makeMarket(overrides: {
  id?: string;
  category?: string;
  yesPrice?: number;
  noPrice?: number;
  yesVolume?: number;
  noVolume?: number;
  impliedProbability?: number;
  resolutionDate?: string;
}) {
  const yesPrice = overrides.yesPrice ?? 0.45;
  const noPrice = overrides.noPrice ?? 0.55;
  return {
    id: overrides.id ?? "test-market",
    title: "Test Market",
    category: overrides.category ?? "general",
    description: "",
    resolutionDate: overrides.resolutionDate ?? new Date(Date.now() + SEVEN_DAYS_MS).toISOString(),
    status: "open" as const,
    yesPrice,
    noPrice,
    yesVolume: overrides.yesVolume ?? 1500,
    noVolume: overrides.noVolume ?? 1500,
    impliedProbability: overrides.impliedProbability ?? yesPrice / (yesPrice + noPrice),
  };
}

describe("extractActionableMarkets — volume filter", () => {
  it("passes markets with total volume at or above the minimum threshold", () => {
    const market = makeMarket({ yesVolume: 300, noVolume: 200 }); // 500 total
    const result = extractActionableMarkets([market]);
    expect(result).toHaveLength(1);
  });

  it("rejects markets whose total volume falls below the minimum threshold", () => {
    const market = makeMarket({ yesVolume: 100, noVolume: 300 }); // 400 total — below 500
    const result = extractActionableMarkets([market]);
    expect(result).toHaveLength(0);
  });

  it("rejects markets with zero volume", () => {
    const market = makeMarket({ yesVolume: 0, noVolume: 0 });
    const result = extractActionableMarkets([market]);
    expect(result).toHaveLength(0);
  });
});

describe("extractActionableMarkets — resolution date filter", () => {
  it("passes markets resolving well beyond the minimum horizon", () => {
    const market = makeMarket({
      resolutionDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const result = extractActionableMarkets([market]);
    expect(result).toHaveLength(1);
  });

  it("rejects markets resolving within 2 hours", () => {
    const market = makeMarket({
      resolutionDate: new Date(Date.now() + 90 * 60 * 1000).toISOString(), // 90 minutes
    });
    const result = extractActionableMarkets([market]);
    expect(result).toHaveLength(0);
  });

  it("rejects markets that have already resolved (past resolution date)", () => {
    const market = makeMarket({
      resolutionDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
    });
    const result = extractActionableMarkets([market]);
    expect(result).toHaveLength(0);
  });

  it("passes markets with no resolutionDate (unknown expiry treated as far-future)", () => {
    // When the raw API omits the field, normalizeKalshiMarket falls back to
    // new Date().toISOString() — which would be immediate.  When the field is
    // genuinely empty string or undefined in code, we should not filter it out.
    const market = { ...makeMarket({}), resolutionDate: "" };
    // An empty string produces NaN from Date parse, so isFinite check skips it.
    const result = extractActionableMarkets([market as never]);
    expect(result).toHaveLength(1);
  });
});

describe("extractActionableMarkets — price bounds filter", () => {
  it("rejects markets where yesPrice is outside (0.01, 0.99)", () => {
    const tooHigh = makeMarket({ yesPrice: 0.995, noPrice: 0.005, impliedProbability: 0.995 });
    const tooLow = makeMarket({ yesPrice: 0.005, noPrice: 0.995, impliedProbability: 0.005 });
    expect(extractActionableMarkets([tooHigh])).toHaveLength(0);
    expect(extractActionableMarkets([tooLow])).toHaveLength(0);
  });
});

describe("selectDiverseMarkets — volume-sorted bucket selection", () => {
  it("picks the highest-volume markets first when the per-category cap applies", () => {
    const markets = [
      makeMarket({ id: "sports-low",  category: "sports", yesVolume: 200,  noVolume: 200  }),
      makeMarket({ id: "sports-high", category: "sports", yesVolume: 5000, noVolume: 5000 }),
      makeMarket({ id: "sports-mid",  category: "sports", yesVolume: 1000, noVolume: 1000 }),
    ];

    // maxTotal=1, perCategory=1 — only the highest-volume sports market should be selected.
    const selected = selectDiverseMarkets(markets, 1, 1);

    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe("sports-high");
  });

  it("respects the maxTotal cap across all categories", () => {
    const markets = [
      makeMarket({ id: "a1", category: "sports",   yesVolume: 1000, noVolume: 1000 }),
      makeMarket({ id: "a2", category: "sports",   yesVolume: 800,  noVolume: 800  }),
      makeMarket({ id: "b1", category: "politics", yesVolume: 1200, noVolume: 1200 }),
      makeMarket({ id: "b2", category: "politics", yesVolume: 600,  noVolume: 600  }),
    ];

    const selected = selectDiverseMarkets(markets, 2, 4); // max 2 total
    expect(selected).toHaveLength(2);
  });

  it("includes markets from all available categories before hitting the per-category cap", () => {
    const markets = [
      makeMarket({ id: "s1", category: "sports",   yesVolume: 1000, noVolume: 1000 }),
      makeMarket({ id: "p1", category: "politics", yesVolume: 900,  noVolume: 900  }),
      makeMarket({ id: "c1", category: "crypto",   yesVolume: 800,  noVolume: 800  }),
    ];

    const selected = selectDiverseMarkets(markets, 10, 3);
    const ids = selected.map((m) => m.id).sort();
    expect(ids).toEqual(["c1", "p1", "s1"]);
  });

  it("fills remaining slots with overflow markets when a single category exceeds the per-category cap", () => {
    // sports has 3 markets but perCategory=2, so s3 overflows.
    // politics has exactly 2, no overflow.
    // maxTotal=5 means the one overflow slot must be filled from sports.
    const markets = [
      makeMarket({ id: "s1", category: "sports",   yesVolume: 5000, noVolume: 5000 }),
      makeMarket({ id: "s2", category: "sports",   yesVolume: 3000, noVolume: 3000 }),
      makeMarket({ id: "s3", category: "sports",   yesVolume: 1000, noVolume: 1000 }),
      makeMarket({ id: "p1", category: "politics", yesVolume: 4000, noVolume: 4000 }),
      makeMarket({ id: "p2", category: "politics", yesVolume: 2000, noVolume: 2000 }),
    ];

    const selected = selectDiverseMarkets(markets, 5, 2);
    const ids = selected.map((m) => m.id).sort();

    expect(ids).toEqual(["p1", "p2", "s1", "s2", "s3"]);
  });

  it("interleaves overflow markets round-robin across multiple overflow queues", () => {
    // perCategory=1, so both sports (s2) and politics (p2) overflow.
    // maxTotal=4 → first pass picks [s1, p1]; second pass round-robins [s2, p2].
    const markets = [
      makeMarket({ id: "s1", category: "sports",   yesVolume: 5000, noVolume: 5000 }),
      makeMarket({ id: "s2", category: "sports",   yesVolume: 2000, noVolume: 2000 }),
      makeMarket({ id: "p1", category: "politics", yesVolume: 4000, noVolume: 4000 }),
      makeMarket({ id: "p2", category: "politics", yesVolume: 1000, noVolume: 1000 }),
    ];

    const selected = selectDiverseMarkets(markets, 4, 1);
    const ids = selected.map((m) => m.id).sort();

    // All four markets should be included; round-robin prevents either category
    // from monopolising the overflow slots.
    expect(ids).toEqual(["p1", "p2", "s1", "s2"]);
  });
});
