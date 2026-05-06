import { describe, it, expect } from "vitest";
import {
  estimateMarketImpact,
  simulateOrderBookFill,
  calculateImpactAdjustedSize,
  type MarketImpactResult,
} from "./_core/marketImpactModel.js";

describe("estimateMarketImpact", () => {
  it("small order produces near-zero impact", () => {
    const result = estimateMarketImpact({
      orderSizeUsd: 10,
      dailyVolumeUsd: 100_000,
      dailyVolatility: 0.10,
      currentPrice: 0.5,
      side: "yes",
    });
    expect(result.totalImpact).toBeGreaterThanOrEqual(0);
    expect(result.totalImpact).toBeLessThan(0.002);
    expect(result.shouldReduceSize).toBe(false);
    expect(result.shouldBlockOrder).toBe(false);
  });

  it("large order (50% of daily volume) produces significant impact", () => {
    const result = estimateMarketImpact({
      orderSizeUsd: 50_000,
      dailyVolumeUsd: 100_000,
      dailyVolatility: 0.10,
      currentPrice: 0.5,
      side: "yes",
    });
    // sqrt(0.5) * 0.10 * 1.5 ≈ 0.1061, well above thresholds
    expect(result.totalImpact).toBeGreaterThan(0.03);
    expect(result.shouldReduceSize).toBe(true);
  });

  it("uses square-root model correctly for known inputs", () => {
    // orderFraction = 100/10000 = 0.01; tempImpact = 0.10 * sqrt(0.01) = 0.01
    // permImpact = 0.01 * 0.5 = 0.005; total = 0.015
    const result = estimateMarketImpact({
      orderSizeUsd: 100,
      dailyVolumeUsd: 10_000,
      dailyVolatility: 0.10,
      currentPrice: 0.5,
      side: "yes",
    });
    expect(result.temporaryImpact).toBeCloseTo(0.01, 6);
    expect(result.permanentImpact).toBeCloseTo(0.005, 6);
    expect(result.totalImpact).toBeCloseTo(0.015, 6);
  });

  it("permanent impact is 50% of temporary impact", () => {
    const result = estimateMarketImpact({
      orderSizeUsd: 500,
      dailyVolumeUsd: 10_000,
      dailyVolatility: 0.10,
      currentPrice: 0.5,
      side: "yes",
    });
    expect(result.permanentImpact).toBeCloseTo(result.temporaryImpact * 0.5, 10);
  });

  it("dailyVolume=0 returns zero impact", () => {
    const result = estimateMarketImpact({
      orderSizeUsd: 1000,
      dailyVolumeUsd: 0,
      dailyVolatility: 0.10,
      currentPrice: 0.5,
      side: "yes",
    });
    expect(result.temporaryImpact).toBe(0);
    expect(result.permanentImpact).toBe(0);
    expect(result.totalImpact).toBe(0);
    expect(result.impactBps).toBe(0);
    expect(result.expectedSlippage).toBe(0);
    expect(result.shouldReduceSize).toBe(false);
    expect(result.shouldBlockOrder).toBe(false);
    expect(result.recommendedSize).toBe(1000);
  });

  it("shouldReduceSize=true when totalImpact >3%", () => {
    // Need totalImpact > 0.03: sigma*sqrt(f)*1.5 > 0.03
    // With sigma=0.10: sqrt(f) > 0.2 → f > 0.04 → order > 4% of volume
    const result = estimateMarketImpact({
      orderSizeUsd: 500,
      dailyVolumeUsd: 10_000,
      dailyVolatility: 0.10,
      currentPrice: 0.5,
      side: "yes",
    });
    // f=0.05; temp=0.10*sqrt(0.05)≈0.02236; total≈0.03354 > 0.03
    expect(result.shouldReduceSize).toBe(true);
    expect(result.shouldBlockOrder).toBe(false);
  });

  it("shouldBlockOrder=true when totalImpact >10%", () => {
    // Need total > 0.10: sigma*sqrt(f)*1.5 > 0.10 → sqrt(f) > 0.667 → f > 0.44
    const result = estimateMarketImpact({
      orderSizeUsd: 5000,
      dailyVolumeUsd: 10_000,
      dailyVolatility: 0.10,
      currentPrice: 0.5,
      side: "yes",
    });
    // f=0.5; temp=0.10*sqrt(0.5)≈0.07071; total≈0.10607 > 0.10
    expect(result.shouldBlockOrder).toBe(true);
    expect(result.recommendedSize).toBe(0);
  });

  it("impactBps equals totalImpact * 10000", () => {
    const result = estimateMarketImpact({
      orderSizeUsd: 100,
      dailyVolumeUsd: 10_000,
      dailyVolatility: 0.10,
      currentPrice: 0.5,
      side: "yes",
    });
    expect(result.impactBps).toBeCloseTo(result.totalImpact * 10000, 6);
  });

  it("expectedSlippage equals orderSizeUsd * totalImpact", () => {
    const orderSizeUsd = 200;
    const result = estimateMarketImpact({
      orderSizeUsd,
      dailyVolumeUsd: 10_000,
      dailyVolatility: 0.10,
      currentPrice: 0.5,
      side: "yes",
    });
    expect(result.expectedSlippage).toBeCloseTo(orderSizeUsd * result.totalImpact, 10);
  });
});

describe("simulateOrderBookFill", () => {
  it("small order fills entirely at level 0 (best price)", () => {
    const dailyVolume = 10_000;
    const currentPrice = 0.50;
    // Level 0 has dailyVolume * 0.10 = 1000 contracts
    const result = simulateOrderBookFill(100, currentPrice, "yes", dailyVolume);
    expect(result.totalContracts).toBe(100);
    expect(result.filledFraction).toBe(1.0);
    expect(result.avgFillPrice).toBeCloseTo(currentPrice, 10);
    expect(result.slippage).toBeCloseTo(0, 10);
  });

  it("large order walks through multiple levels", () => {
    const dailyVolume = 1000;
    const currentPrice = 0.50;
    // Level 0: 100 contracts; Level 1: 80; Level 2: 60; Level 3: 40; Level 4: 20 = 300 total
    const result = simulateOrderBookFill(250, currentPrice, "yes", dailyVolume);
    expect(result.totalContracts).toBe(250);
    expect(result.filledFraction).toBe(1.0);
    // avg fill price should be above currentPrice (walking up the book)
    expect(result.avgFillPrice).toBeGreaterThan(currentPrice);
    expect(result.slippage).toBeGreaterThan(0);
  });

  it("filledFraction <= 1.0 always", () => {
    const scenarios = [
      { target: 1, volume: 10_000 },
      { target: 100_000, volume: 1 },
      { target: 0, volume: 5_000 },
    ];
    for (const s of scenarios) {
      const result = simulateOrderBookFill(s.target, 0.5, "yes", s.volume);
      expect(result.filledFraction).toBeLessThanOrEqual(1.0);
      expect(result.filledFraction).toBeGreaterThanOrEqual(0);
    }
  });

  it("thin book results in partial fill when order exceeds available depth", () => {
    const dailyVolume = 100; // very thin book
    const currentPrice = 0.60;
    // Total depth: 10+8+6+4+2 = 30 contracts
    const result = simulateOrderBookFill(1000, currentPrice, "yes", dailyVolume);
    expect(result.totalContracts).toBe(30);
    expect(result.filledFraction).toBeCloseTo(0.03, 5);
  });

  it("no side: price levels go below current price", () => {
    const dailyVolume = 1_000;
    const currentPrice = 0.50;
    const result = simulateOrderBookFill(50, currentPrice, "no", dailyVolume);
    expect(result.totalContracts).toBe(50);
    expect(result.filledFraction).toBe(1.0);
    // For "no" side, buying no = selling yes; first level is at currentPrice
    expect(result.avgFillPrice).toBeLessThanOrEqual(currentPrice);
  });
});

describe("calculateImpactAdjustedSize", () => {
  const makeImpact = (overrides: Partial<MarketImpactResult>): MarketImpactResult => ({
    temporaryImpact: 0,
    permanentImpact: 0,
    totalImpact: 0,
    impactBps: 0,
    expectedSlippage: 0,
    shouldReduceSize: false,
    shouldBlockOrder: false,
    recommendedSize: 1000,
    ...overrides,
  });

  it("blocked order returns 0", () => {
    const impact = makeImpact({ shouldBlockOrder: true, recommendedSize: 0 });
    expect(calculateImpactAdjustedSize(1000, impact)).toBe(0);
  });

  it("reducible order returns halved size", () => {
    const impact = makeImpact({ shouldReduceSize: true, recommendedSize: 500 });
    expect(calculateImpactAdjustedSize(1000, impact)).toBe(500);
  });

  it("acceptable impact returns original size unchanged", () => {
    const impact = makeImpact({ shouldReduceSize: false, shouldBlockOrder: false, recommendedSize: 1000 });
    expect(calculateImpactAdjustedSize(1000, impact)).toBe(1000);
  });
});
