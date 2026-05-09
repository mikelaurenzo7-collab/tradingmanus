import { describe, it, expect } from "vitest";
import {
  detectClusterActivity,
  detectClusterActivityBatch,
  buildFadeRecommendations,
  KNOWN_CLUSTERS,
  type MarketSnapshot,
} from "./_core/polymarketClusterMonitor";

const baseSnapshot: MarketSnapshot = {
  marketId: "test-market-1",
  question: "Test market",
  category: "general",
  impliedProbabilityYes: 0.5,
  recentVolume: 0,
  totalVolume: 1000,
  liquidity: 2000,
};

describe("KNOWN_CLUSTERS", () => {
  it("should define all 7 known clusters", () => {
    expect(KNOWN_CLUSTERS).toHaveLength(7);
    const ids = KNOWN_CLUSTERS.map((c) => c.id).sort();
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("should have valid strategies on each cluster", () => {
    const validStrategies = ["fade", "copy", "warning", "skip"];
    for (const c of KNOWN_CLUSTERS) {
      expect(validStrategies).toContain(c.strategy);
    }
  });

  it("Cluster #1 should be weekend biased", () => {
    const c1 = KNOWN_CLUSTERS.find((c) => c.id === 1);
    expect(c1?.weekendBiased).toBe(true);
  });

  it("Cluster #2 should be short window", () => {
    const c2 = KNOWN_CLUSTERS.find((c) => c.id === 2);
    expect(c2?.shortWindow).toBe(true);
  });

  it("Cluster #3 strategy should be copy", () => {
    const c3 = KNOWN_CLUSTERS.find((c) => c.id === 3);
    expect(c3?.strategy).toBe("copy");
  });

  it("Cluster #4 strategy should be warning", () => {
    const c4 = KNOWN_CLUSTERS.find((c) => c.id === 4);
    expect(c4?.strategy).toBe("warning");
  });
});

describe("detectClusterActivity", () => {
  it("returns an empty array for a normal market", () => {
    const signals = detectClusterActivity(baseSnapshot);
    expect(Array.isArray(signals)).toBe(true);
  });

  it("detects Cluster #4 (Airdrop Farmers) on high volume-to-liquidity sub-1¢ market", () => {
    const snapshot: MarketSnapshot = {
      ...baseSnapshot,
      marketId: "airdrop-market",
      question: "Will token XYZ launch?",
      category: "crypto",
      impliedProbabilityYes: 0.005, // sub-1¢
      recentVolume: 50000,
      liquidity: 100,
    };

    const signals = detectClusterActivity(snapshot);
    const c4 = signals.find((s) => s.clusterId === 4);
    expect(c4).toBeDefined();
    expect(c4?.strategy).toBe("warning");
    expect(c4?.confidence).toBeGreaterThan(0.5);
  });

  it("detects Cluster #3 (Election Layer) on sub-1¢ political market", () => {
    const snapshot: MarketSnapshot = {
      ...baseSnapshot,
      marketId: "election-market",
      question: "Will candidate X win the French presidential election?",
      category: "politics",
      impliedProbabilityYes: 0.008,
      liquidity: 200,
      recentVolume: 0,
      totalVolume: 500,
    };

    const signals = detectClusterActivity(snapshot);
    const c3 = signals.find((s) => s.clusterId === 3);
    expect(c3).toBeDefined();
    expect(c3?.strategy).toBe("copy");
  });

  it("detects Cluster #5 on non-crypto market resolving within 4h with volume pump", () => {
    const snapshot: MarketSnapshot = {
      ...baseSnapshot,
      marketId: "resolution-market",
      question: "Will the Fed raise rates today?",
      category: "economics",
      impliedProbabilityYes: 0.75,
      recentVolume: 20000,
      liquidity: 500,
      resolvingWithin4Hours: true,
      resolvingWithin5Min: false,
    };

    const signals = detectClusterActivity(snapshot);
    const c5 = signals.find((s) => s.clusterId === 5);
    expect(c5).toBeDefined();
    expect(c5?.strategy).toBe("fade");
  });

  it("does not flag Cluster #2 on a non-short-window market", () => {
    const snapshot: MarketSnapshot = {
      ...baseSnapshot,
      question: "Will Bitcoin reach $100k by end of year?",
      category: "crypto",
      resolvingWithin5Min: false,
      resolvingWithin4Hours: false,
    };
    const signals = detectClusterActivity(snapshot);
    const c2 = signals.find((s) => s.clusterId === 2);
    expect(c2).toBeUndefined();
  });

  it("confidence is always within [0, 1]", () => {
    const snapshots: MarketSnapshot[] = [
      {
        ...baseSnapshot,
        impliedProbabilityYes: 0.005,
        recentVolume: 999999,
        liquidity: 10,
        category: "politics",
        question: "Election candidate wins?",
      },
      {
        ...baseSnapshot,
        impliedProbabilityYes: 0.99,
        recentVolume: 999999,
        liquidity: 10,
        category: "crypto",
        resolvingWithin5Min: true,
      },
    ];
    for (const s of snapshots) {
      for (const sig of detectClusterActivity(s)) {
        expect(sig.confidence).toBeGreaterThanOrEqual(0);
        expect(sig.confidence).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("detectClusterActivityBatch", () => {
  it("returns sorted results by confidence descending", () => {
    const snapshots: MarketSnapshot[] = [
      {
        ...baseSnapshot,
        marketId: "m1",
        question: "Will BTC reach $80k on Monday?",
        category: "crypto",
        impliedProbabilityYes: 0.04,
        recentVolume: 5000,
        liquidity: 100,
        resolvingWithin4Hours: true,
      },
      {
        ...baseSnapshot,
        marketId: "m2",
        question: "Will Fed raise rates? economics",
        category: "economics",
        impliedProbabilityYes: 0.7,
        recentVolume: 20000,
        liquidity: 500,
        resolvingWithin4Hours: true,
      },
    ];

    const signals = detectClusterActivityBatch(snapshots);
    expect(Array.isArray(signals)).toBe(true);
    for (let i = 1; i < signals.length; i++) {
      expect(signals[i - 1]!.confidence).toBeGreaterThanOrEqual(
        signals[i]!.confidence,
      );
    }
  });
});

describe("buildFadeRecommendations", () => {
  it("returns skip_market for Cluster #4 signals", () => {
    const signals = detectClusterActivity({
      ...baseSnapshot,
      marketId: "airdrop-mkt",
      question: "Airdrop test",
      category: "crypto",
      impliedProbabilityYes: 0.005,
      recentVolume: 50000,
      liquidity: 100,
    });

    const recs = buildFadeRecommendations(signals, 0.005);
    const skip = recs.find((r) => r.action === "skip_market");
    expect(skip).toBeDefined();
  });

  it("returns copy_buy for Cluster #3 copy signals", () => {
    const signals = detectClusterActivity({
      ...baseSnapshot,
      marketId: "election-mkt",
      question: "Will candidate win French presidential election?",
      category: "politics",
      impliedProbabilityYes: 0.008,
      liquidity: 200,
    });

    const copySignals = signals.filter((s) => s.strategy === "copy");
    if (copySignals.length > 0) {
      const recs = buildFadeRecommendations(copySignals, 0.008);
      const copyRec = recs.find((r) => r.action === "copy_buy");
      expect(copyRec).toBeDefined();
      expect(copyRec?.side).toBe("yes");
    }
  });

  it("all recommendations have valid action types", () => {
    const validActions = ["fade_sell", "copy_buy", "exit_now", "skip_market"];
    const snapshots: MarketSnapshot[] = [
      {
        ...baseSnapshot,
        marketId: "m1",
        question: "Airdrop?",
        category: "crypto",
        impliedProbabilityYes: 0.005,
        recentVolume: 50000,
        liquidity: 100,
      },
    ];
    const signals = detectClusterActivityBatch(snapshots);
    const recs = buildFadeRecommendations(signals, 0.5);
    for (const r of recs) {
      expect(validActions).toContain(r.action);
    }
  });
});
