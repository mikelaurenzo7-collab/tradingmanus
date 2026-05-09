import { describe, expect, it } from "vitest";
import {
  assessPartialLegRisk,
  calculateDynamicHedgeRatio,
  detectCrossPlatformArbitrage,
  estimateLatencyRisk,
} from "./_core/crossPlatformArbitrage";

describe("cross-platform arbitrage real-time model", () => {
  it("requires >5% net edge after fees and execution risk", () => {
    const kalshiMarkets = [
      {
        marketId: "K1",
        title: "Will inflation be above 3% by year end",
        category: "macro",
        yesPrice: 0.35,
        noPrice: 0.65,
        liquidity: 10_000,
      },
    ];
    const polymarketMarkets = [
      {
        marketId: "P1",
        question: "Will inflation be above 3% by year end",
        category: "macro",
        yesPrice: 0.55,
        noPrice: 0.45,
        liquidity: 9_000,
      },
    ];

    const opps = detectCrossPlatformArbitrage(kalshiMarkets, polymarketMarkets, {
      minSimilarity: 0.2,
      minSpread: 0.03,
      minLiquidity: 100,
      minNetEdge: 0.05,
    });

    expect(opps).toHaveLength(1);
    expect(opps[0].netEdge).toBeGreaterThan(0.05);
    expect(opps[0].feeBurden).toBeCloseTo(0.05, 6);
    expect(opps[0].executionRisk).toBeGreaterThan(0);
    expect(opps[0].hedgeRatio).toBeLessThanOrEqual(1);
    expect(opps[0].hedgeRatio).toBeGreaterThanOrEqual(0.5);
  });

  it("filters opportunities that fail the 5% post-cost threshold", () => {
    const kalshiMarkets = [
      {
        marketId: "K2",
        title: "Will GDP grow above 2%",
        category: "macro",
        yesPrice: 0.46,
        noPrice: 0.54,
        liquidity: 2_000,
      },
    ];
    const polymarketMarkets = [
      {
        marketId: "P2",
        question: "Will GDP grow above 2%",
        category: "macro",
        yesPrice: 0.54,
        noPrice: 0.46,
        liquidity: 1_500,
      },
    ];

    const opps = detectCrossPlatformArbitrage(kalshiMarkets, polymarketMarkets, {
      minSimilarity: 0.2,
      minSpread: 0.03,
      minLiquidity: 100,
      minNetEdge: 0.05,
    });

    expect(opps).toHaveLength(0);
  });

  it("reduces hedge ratio as latency/slippage risk rises", () => {
    const lowRiskRatio = calculateDynamicHedgeRatio({
      latencyRisk: 0.002,
      slippageRisk: 0.001,
    });
    const highRiskRatio = calculateDynamicHedgeRatio({
      latencyRisk: 0.08,
      slippageRisk: 0.04,
    });

    expect(lowRiskRatio).toBeGreaterThan(highRiskRatio);
    expect(highRiskRatio).toBeGreaterThanOrEqual(0.5);
  });

  it("flags large partial-fill gaps for hedge/exit actions", () => {
    const hedge = assessPartialLegRisk({ firstLegFilled: 100, secondLegFilled: 80, hedgeRatio: 1 });
    const exit = assessPartialLegRisk({ firstLegFilled: 100, secondLegFilled: 20, hedgeRatio: 1 });

    expect(hedge.action).toBe("hedge");
    expect(exit.action).toBe("exit");
  });

  it("models higher latency risk for slower execution venues", () => {
    const fast = estimateLatencyRisk(0.1, 500);
    const slow = estimateLatencyRisk(0.1, 3000);

    expect(slow).toBeGreaterThan(fast);
  });
});
