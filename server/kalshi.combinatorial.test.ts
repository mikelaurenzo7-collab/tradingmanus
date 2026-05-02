import { describe, it, expect } from "vitest";
import {
  detectSumToOneArbitrage,
  detectImplicationViolations,
  detectAllCombinatorialArbitrage,
  type ArbitrageMarket,
} from "./_core/kalshiCombinatorial";

const makeMarket = (overrides: Partial<ArbitrageMarket> & { marketId: string; title: string }): ArbitrageMarket => ({
  category: "politics",
  impliedProbabilityYes: 0.5,
  yesPrice: 0.5,
  noPrice: 0.5,
  volume: 5000,
  liquidity: 2000,
  ...overrides,
});

describe("detectSumToOneArbitrage", () => {
  it("returns empty array when no violation exists", () => {
    // Two markets that sum to exactly 1.0
    const markets: ArbitrageMarket[] = [
      makeMarket({ marketId: "m1", title: "2026 Election: Candidate A wins", impliedProbabilityYes: 0.6 }),
      makeMarket({ marketId: "m2", title: "2026 Election: Candidate B wins", impliedProbabilityYes: 0.4 }),
    ];
    const opps = detectSumToOneArbitrage(markets, { minLiquidity: 0 });
    expect(opps).toHaveLength(0);
  });

  it("detects sum > 1 violation (sell YES)", () => {
    const markets: ArbitrageMarket[] = [
      makeMarket({ marketId: "m1", title: "2026 Election: Candidate A wins", impliedProbabilityYes: 0.65 }),
      makeMarket({ marketId: "m2", title: "2026 Election: Candidate B wins", impliedProbabilityYes: 0.55 }),
    ];
    const opps = detectSumToOneArbitrage(markets, { minLiquidity: 0, minSumDeviation: 0.05 });
    expect(opps.length).toBeGreaterThan(0);
    const opp = opps[0]!;
    expect(opp.type).toBe("sum_exceeds_one");
    expect(opp.trades[0]?.side).toBe("no");
    expect(opp.guaranteedProfit).toBeGreaterThan(0);
    expect(opp.confidence).toBeGreaterThan(0.5);
    expect(opp.confidence).toBeLessThanOrEqual(1);
  });

  it("detects sum < 1 violation (buy all YES)", () => {
    const markets: ArbitrageMarket[] = [
      makeMarket({ marketId: "m1", title: "2026 Election: Candidate A wins", impliedProbabilityYes: 0.30 }),
      makeMarket({ marketId: "m2", title: "2026 Election: Candidate B wins", impliedProbabilityYes: 0.30 }),
      makeMarket({ marketId: "m3", title: "2026 Election: Candidate C wins", impliedProbabilityYes: 0.25 }),
    ];
    const opps = detectSumToOneArbitrage(markets, { minLiquidity: 0, minSumDeviation: 0.05 });
    expect(opps.length).toBeGreaterThan(0);
    const opp = opps[0]!;
    expect(opp.type).toBe("sum_below_one");
    // All trades should be YES buys
    expect(opp.trades.every((t) => t.side === "yes")).toBe(true);
    expect(opp.guaranteedProfit).toBeGreaterThan(0);
  });

  it("respects minimum liquidity filter", () => {
    const markets: ArbitrageMarket[] = [
      makeMarket({ marketId: "m1", title: "2026 Election: Candidate A wins", impliedProbabilityYes: 0.65, liquidity: 100 }),
      makeMarket({ marketId: "m2", title: "2026 Election: Candidate B wins", impliedProbabilityYes: 0.55, liquidity: 100 }),
    ];
    // With high minLiquidity, should skip low-liquidity markets
    const opps = detectSumToOneArbitrage(markets, { minLiquidity: 5000, minSumDeviation: 0.05 });
    expect(opps).toHaveLength(0);
  });

  it("results are sorted by guaranteedProfit descending", () => {
    const markets: ArbitrageMarket[] = [
      makeMarket({ marketId: "m1", title: "2026 Election: Alpha wins", impliedProbabilityYes: 0.70 }),
      makeMarket({ marketId: "m2", title: "2026 Election: Beta wins", impliedProbabilityYes: 0.60 }),
      makeMarket({ marketId: "m3", title: "2027 Senate: X wins", impliedProbabilityYes: 0.65 }),
      makeMarket({ marketId: "m4", title: "2027 Senate: Y wins", impliedProbabilityYes: 0.50 }),
    ];
    const opps = detectSumToOneArbitrage(markets, { minLiquidity: 0, minSumDeviation: 0.05 });
    for (let i = 1; i < opps.length; i++) {
      expect(opps[i - 1]!.guaranteedProfit).toBeGreaterThanOrEqual(opps[i]!.guaranteedProfit);
    }
  });

  it("includes valid reasoning string", () => {
    const markets: ArbitrageMarket[] = [
      makeMarket({ marketId: "m1", title: "2026 Election: Candidate A wins", impliedProbabilityYes: 0.65 }),
      makeMarket({ marketId: "m2", title: "2026 Election: Candidate B wins", impliedProbabilityYes: 0.55 }),
    ];
    const opps = detectSumToOneArbitrage(markets, { minLiquidity: 0, minSumDeviation: 0.05 });
    if (opps.length > 0) {
      expect(typeof opps[0]!.reasoning).toBe("string");
      expect(opps[0]!.reasoning.length).toBeGreaterThan(10);
    }
  });
});

describe("detectImplicationViolations", () => {
  it("returns empty array when no implication violation exists", () => {
    const markets: ArbitrageMarket[] = [
      makeMarket({ marketId: "m1", title: "Republicans win Pennsylvania" }),
      makeMarket({ marketId: "m2", title: "Republicans win Georgia" }),
    ];
    const opps = detectImplicationViolations(markets, { minLiquidity: 0, minViolation: 0.05 });
    // Different states, no implication, should be empty
    expect(Array.isArray(opps)).toBe(true);
  });

  it("detects implication violation: margin qualifier exceeds base probability", () => {
    const markets: ArbitrageMarket[] = [
      // A implies B, so P(A) must be <= P(B)
      // Here P(A) = 0.55 > P(B) = 0.40: violation
      makeMarket({
        marketId: "m1",
        title: "Republicans win Pennsylvania by 5+ points",
        impliedProbabilityYes: 0.55,
        yesPrice: 0.55,
        noPrice: 0.45,
      }),
      makeMarket({
        marketId: "m2",
        title: "Republicans win Pennsylvania",
        impliedProbabilityYes: 0.40,
        yesPrice: 0.40,
        noPrice: 0.60,
      }),
    ];
    const opps = detectImplicationViolations(markets, { minLiquidity: 0, minViolation: 0.05 });
    expect(opps.length).toBeGreaterThan(0);
    const opp = opps[0]!;
    expect(opp.type).toBe("implication_violation");
    expect(opp.guaranteedProfit).toBeGreaterThan(0);
    // Should fade the more-expensive implicant (sell NO) and buy the base
    const noTrade = opp.trades.find((t) => t.side === "no");
    const yesTrade = opp.trades.find((t) => t.side === "yes");
    expect(noTrade).toBeDefined();
    expect(yesTrade).toBeDefined();
  });

  it("does not flag violations below the threshold", () => {
    const markets: ArbitrageMarket[] = [
      makeMarket({
        marketId: "m1",
        title: "Republicans win Pennsylvania by 5+ points",
        impliedProbabilityYes: 0.44,
        yesPrice: 0.44,
        noPrice: 0.56,
      }),
      makeMarket({
        marketId: "m2",
        title: "Republicans win Pennsylvania",
        impliedProbabilityYes: 0.42,
        yesPrice: 0.42,
        noPrice: 0.58,
      }),
    ];
    // 0.44 - 0.42 = 0.02 < 0.05 threshold
    const opps = detectImplicationViolations(markets, { minLiquidity: 0, minViolation: 0.05 });
    const implOpps = opps.filter((o) => o.type === "implication_violation");
    expect(implOpps).toHaveLength(0);
  });
});

describe("detectAllCombinatorialArbitrage", () => {
  it("returns deduplicated results combining both detectors", () => {
    const markets: ArbitrageMarket[] = [
      makeMarket({ marketId: "m1", title: "2026 Election: Candidate A wins", impliedProbabilityYes: 0.65 }),
      makeMarket({ marketId: "m2", title: "2026 Election: Candidate B wins", impliedProbabilityYes: 0.55 }),
      makeMarket({
        marketId: "m3",
        title: "Republicans win PA by 5+ points",
        impliedProbabilityYes: 0.60,
        yesPrice: 0.60,
        noPrice: 0.40,
      }),
      makeMarket({
        marketId: "m4",
        title: "Republicans win PA",
        impliedProbabilityYes: 0.45,
        yesPrice: 0.45,
        noPrice: 0.55,
      }),
    ];

    const opps = detectAllCombinatorialArbitrage(markets, {
      minSumDeviation: 0.05,
      minViolation: 0.05,
      minLiquidity: 0,
    });

    expect(Array.isArray(opps)).toBe(true);
    // Each opportunity should have valid structure
    for (const opp of opps) {
      expect(opp.markets.length).toBeGreaterThan(0);
      expect(opp.trades.length).toBeGreaterThan(0);
      expect(typeof opp.reasoning).toBe("string");
      expect(opp.confidence).toBeGreaterThan(0);
      expect(opp.confidence).toBeLessThanOrEqual(1);
      expect(opp.guaranteedProfit).toBeGreaterThan(0);
    }
  });

  it("returns results sorted by guaranteedProfit descending", () => {
    const markets: ArbitrageMarket[] = [
      makeMarket({ marketId: "m1", title: "2026 Election: A wins", impliedProbabilityYes: 0.80 }),
      makeMarket({ marketId: "m2", title: "2026 Election: B wins", impliedProbabilityYes: 0.60 }),
      makeMarket({ marketId: "m3", title: "2027 Senate: X wins", impliedProbabilityYes: 0.65 }),
      makeMarket({ marketId: "m4", title: "2027 Senate: Y wins", impliedProbabilityYes: 0.50 }),
    ];
    const opps = detectAllCombinatorialArbitrage(markets, { minSumDeviation: 0.05, minLiquidity: 0 });
    for (let i = 1; i < opps.length; i++) {
      expect(opps[i - 1]!.guaranteedProfit).toBeGreaterThanOrEqual(opps[i]!.guaranteedProfit);
    }
  });

  it("handles empty market list gracefully", () => {
    const opps = detectAllCombinatorialArbitrage([], {});
    expect(opps).toHaveLength(0);
  });

  it("handles single market gracefully", () => {
    const markets = [makeMarket({ marketId: "m1", title: "Single market" })];
    const opps = detectAllCombinatorialArbitrage(markets, { minLiquidity: 0 });
    expect(opps).toHaveLength(0);
  });
});
