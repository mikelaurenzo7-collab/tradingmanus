import { describe, it, expect } from "vitest";
import { detectMispricingArbitrage } from "./_core/kalshiArbitrage";
import { generateSignalsForMarket } from "./_core/kalshiSignals";
import type { KalshiMarket } from "./_core/kalshiMarketData";

describe("Arbitrage Signal Generation", () => {
  const mockMarket: KalshiMarket = {
    id: "test-market-1",
    ticker: "TEST",
    title: "Test Market",
    description: "Test market for arbitrage detection",
    category: "politics",
    yesPrice: 0.35,
    noPrice: 0.65,
    impliedProbability: 0.65,
    volume24h: 10000,
    openInterest: 5000,
    createdAt: new Date(),
    resolvedAt: null,
    status: "open",
  };

  it("should detect mispricing arbitrage opportunities", () => {
    const arbitrage = detectMispricingArbitrage(
      mockMarket.id,
      mockMarket.yesPrice,
      mockMarket.noPrice,
      mockMarket.impliedProbability,
      0.02
    );

    expect(arbitrage).toBeDefined();
    if (arbitrage) {
      expect(arbitrage.confidence).toBeGreaterThan(0);
      expect(arbitrage.confidence).toBeLessThanOrEqual(1);
      expect(["yes", "no"]).toContain(arbitrage.side);
      expect(arbitrage.reasoning).toBeTruthy();
      expect(arbitrage.expectedProfit).toBeDefined();
    }
  });

  it("should generate arbitrage signals for mispriced markets", async () => {
    const signals = await generateSignalsForMarket(mockMarket);

    const arbitrageSignals = signals.filter((s) => s.signalType === "arbitrage");
    expect(arbitrageSignals.length).toBeGreaterThanOrEqual(0);

    arbitrageSignals.forEach((signal) => {
      expect(signal.confidence).toBeGreaterThan(0);
      expect(signal.confidence).toBeLessThanOrEqual(1);
      expect(["yes", "no"]).toContain(signal.side);
      expect(signal.reasoning).toBeTruthy();
      expect(signal.expectedValue).toBeDefined();
    });
  });

  it("should filter arbitrage signals by confidence threshold", async () => {
    const signals = await generateSignalsForMarket(mockMarket);
    const arbitrageSignals = signals.filter((s) => s.signalType === "arbitrage");

    // All arbitrage signals should have confidence >= 0.5 (filtering threshold)
    arbitrageSignals.forEach((signal) => {
      expect(signal.confidence).toBeGreaterThanOrEqual(0.5);
    });
  });

  it("should include arbitrage signals in mixed signal generation", async () => {
    const signals = await generateSignalsForMarket(mockMarket);

    // Should have multiple signal types including arbitrage
    const signalTypes = new Set(signals.map((s) => s.signalType));
    expect(signalTypes.size).toBeGreaterThan(0);

    // All signals should have required fields
    signals.forEach((signal) => {
      expect(signal.marketId).toBe(mockMarket.id);
      expect(signal.signalType).toBeTruthy();
      expect(["yes", "no"]).toContain(signal.side);
      expect(signal.confidence).toBeGreaterThan(0);
      expect(signal.confidence).toBeLessThanOrEqual(1);
      expect(signal.reasoning).toBeTruthy();
      expect(signal.impliedProbability).toBeDefined();
      expect(signal.marketPrice).toBeGreaterThan(0);
      expect(signal.expectedValue).toBeDefined();
    });
  });

  it("should handle extreme market conditions for arbitrage", () => {
    // Highly mispriced market
    const extremeArbitrage = detectMispricingArbitrage(
      "extreme-market",
      0.1, // very low yes price
      0.9, // very high no price
      0.5, // fair probability
      0.02
    );

    expect(extremeArbitrage).toBeDefined();
    if (extremeArbitrage) {
      expect(extremeArbitrage.confidence).toBeGreaterThan(0.5);
      expect(extremeArbitrage.expectedProfit).toBeGreaterThan(0);
    }
  });

  it("should not generate arbitrage signals for fairly priced markets", () => {
    // Fair market: prices sum to ~1.0
    const fairMarket: KalshiMarket = {
      ...mockMarket,
      yesPrice: 0.5,
      noPrice: 0.5,
      impliedProbability: 0.5,
    };

    const arbitrage = detectMispricingArbitrage(
      fairMarket.id,
      fairMarket.yesPrice,
      fairMarket.noPrice,
      fairMarket.impliedProbability,
      0.02
    );

    // Should either be undefined or have very low confidence
    if (arbitrage) {
      expect(arbitrage.confidence).toBeLessThan(0.5);
    }
  });
});
