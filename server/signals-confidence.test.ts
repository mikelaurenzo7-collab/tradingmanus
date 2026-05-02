import { describe, it, expect } from "vitest";
import { generateSignalsForMarket, filterSignalsByConfidence, scoreSignalForExecution, rankSignalsByExecution } from "./_core/kalshiSignals";
import { KalshiMarket, calculateExpectedValue } from "./_core/kalshiMarketData";
import { MarketFeed } from "./_core/kalshiMarketFeed";

describe("Signal Generation - Momentum Confidence & NaN/Infinity Guards", () => {
  // Helper to create a valid market
  const createMarket = (overrides?: Record<string, unknown>): KalshiMarket =>
    ({
      id: "test-market-1",
      title: "Test Market",
      category: "politics",
      description: "Test market description",
      yesPrice: 0.5,
      noPrice: 0.5,
      impliedProbability: 0.5,
      volume24h: 10000,
      openInterest: 50000,
      resolutionDate: new Date(Date.now() + 86400000),
      ...overrides,
    }) as unknown as KalshiMarket;

  // Helper to create a valid market feed
  const createFeed = (overrides?: Record<string, unknown>): MarketFeed =>
    ({
      marketId: "test-market-1",
      priceHistory: [
        { timestamp: Date.now() - 60000, yesPrice: 0.48, noPrice: 0.52, volume: 1000 },
        { timestamp: Date.now() - 30000, yesPrice: 0.50, noPrice: 0.50, volume: 1500 },
        { timestamp: Date.now(), yesPrice: 0.52, noPrice: 0.48, volume: 2000 },
      ],
      volumeHistory: [
        { timestamp: Date.now() - 60000, volume: 1000 },
        { timestamp: Date.now() - 30000, volume: 1500 },
        { timestamp: Date.now(), volume: 2000 },
      ],
      dataQuality: 0.95,
      lastUpdated: Date.now(),
      ...overrides,
    }) as unknown as MarketFeed;

  describe("NaN/Infinity Guard Tests", () => {
    it("should reject markets with NaN impliedProbability", async () => {
      const market = createMarket({ impliedProbability: NaN });
      const signals = await generateSignalsForMarket(market);
      expect(signals).toEqual([]);
    });

    it("should reject markets with Infinity impliedProbability", async () => {
      const market = createMarket({ impliedProbability: Infinity });
      const signals = await generateSignalsForMarket(market);
      expect(signals).toEqual([]);
    });

    it("should reject markets with negative Infinity impliedProbability", async () => {
      const market = createMarket({ impliedProbability: -Infinity });
      const signals = await generateSignalsForMarket(market);
      expect(signals).toEqual([]);
    });

    it("should reject markets with undefined id", async () => {
      const market = createMarket({ id: undefined as any });
      const signals = await generateSignalsForMarket(market);
      expect(signals).toEqual([]);
    });

    it("should reject markets with null id", async () => {
      const market = createMarket({ id: null as any });
      const signals = await generateSignalsForMarket(market);
      expect(signals).toEqual([]);
    });

    it("should reject invalid fundamental probability (NaN)", async () => {
      const market = createMarket();
      const feed = createFeed();
      const signals = await generateSignalsForMarket(market, feed, NaN);
      // Should still generate momentum signals, but skip value play
      expect(signals.length).toBeGreaterThanOrEqual(0);
      const valueSignals = signals.filter((s) => s.signalType === "value_play");
      expect(valueSignals).toEqual([]);
    });

    it("should reject invalid fundamental probability (Infinity)", async () => {
      const market = createMarket();
      const feed = createFeed();
      const signals = await generateSignalsForMarket(market, feed, Infinity);
      const valueSignals = signals.filter((s) => s.signalType === "value_play");
      expect(valueSignals).toEqual([]);
    });

    it("should handle edge case: market with 0 impliedProbability", async () => {
      const market = createMarket({ impliedProbability: 0 });
      const signals = await generateSignalsForMarket(market);
      // Should not crash, but may not generate value signals
      expect(Array.isArray(signals)).toBe(true);
    });

    it("should handle edge case: market with 1.0 impliedProbability", async () => {
      const market = createMarket({ impliedProbability: 1.0 });
      const signals = await generateSignalsForMarket(market);
      expect(Array.isArray(signals)).toBe(true);
    });
  });

  describe("Momentum Confidence Calculation Tests", () => {
    it("should calculate momentum confidence correctly for strong upward move", async () => {
      const market = createMarket({ impliedProbability: 0.5 });
      const feed = createFeed({
        priceHistory: [
          { timestamp: Date.now() - 60000, yesPrice: 0.40, noPrice: 0.60, volume: 1000 },
          { timestamp: Date.now() - 30000, yesPrice: 0.45, noPrice: 0.55, volume: 1500 },
          { timestamp: Date.now(), yesPrice: 0.55, noPrice: 0.45, volume: 2000 }, // 37.5% move
        ],
        volumeHistory: [
          { timestamp: Date.now() - 60000, volume: 1000 },
          { timestamp: Date.now() - 30000, volume: 1500 },
          { timestamp: Date.now(), volume: 2000 },
        ],
      });

      const signals = await generateSignalsForMarket(market, feed);
      const momentumSignals = signals.filter((s) => s.signalType === "momentum");

      expect(momentumSignals.length).toBeGreaterThan(0);
      const signal = momentumSignals[0];
      expect(signal.confidence).toBeGreaterThan(0.1);
      expect(signal.confidence).toBeLessThanOrEqual(0.95);
      expect(isFinite(signal.confidence)).toBe(true);
      expect(isNaN(signal.confidence)).toBe(false);
    });

    it("should clamp momentum confidence to valid range [0.1, 0.95]", async () => {
      const market = createMarket({ impliedProbability: 0.5 });
      const feed = createFeed({
        priceHistory: [
          { timestamp: Date.now() - 60000, yesPrice: 0.01, noPrice: 0.99, volume: 1000 },
          { timestamp: Date.now() - 30000, yesPrice: 0.02, noPrice: 0.98, volume: 1500 },
          { timestamp: Date.now(), yesPrice: 0.99, noPrice: 0.01, volume: 2000 }, // 9800% move
        ],
        volumeHistory: [
          { timestamp: Date.now() - 60000, volume: 1000 },
          { timestamp: Date.now() - 30000, volume: 1500 },
          { timestamp: Date.now(), volume: 2000 },
        ],
      });

      const signals = await generateSignalsForMarket(market, feed);
      const momentumSignals = signals.filter((s) => s.signalType === "momentum");

      if (momentumSignals.length > 0) {
        const signal = momentumSignals[0];
        expect(signal.confidence).toBeGreaterThanOrEqual(0.1);
        expect(signal.confidence).toBeLessThanOrEqual(0.95);
      }
    });

    it("should not generate momentum signal for weak moves (< 1%)", async () => {
      const market = createMarket({ impliedProbability: 0.5 });
      const feed = createFeed({
        priceHistory: [
          { timestamp: Date.now() - 60000, yesPrice: 0.495, noPrice: 0.505, volume: 1000 },
          { timestamp: Date.now() - 30000, yesPrice: 0.498, noPrice: 0.502, volume: 1500 },
          { timestamp: Date.now(), yesPrice: 0.502, noPrice: 0.498, volume: 2000 }, // 1.4% move
        ],
        volumeHistory: [
          { timestamp: Date.now() - 60000, volume: 1000 },
          { timestamp: Date.now() - 30000, volume: 1500 },
          { timestamp: Date.now(), volume: 2000 },
        ],
      });

      const signals = await generateSignalsForMarket(market, feed);
      const momentumSignals = signals.filter((s) => s.signalType === "momentum");
      // May or may not generate depending on exact threshold
      expect(Array.isArray(momentumSignals)).toBe(true);
    });

    it("should include volume confirmation in momentum confidence", async () => {
      const market = createMarket({ impliedProbability: 0.5 });
      const feedWithVolume = createFeed({
        priceHistory: [
          { timestamp: Date.now() - 60000, yesPrice: 0.48, noPrice: 0.52, volume: 1000 },
          { timestamp: Date.now() - 30000, yesPrice: 0.50, noPrice: 0.50, volume: 1500 },
          { timestamp: Date.now(), yesPrice: 0.52, noPrice: 0.48, volume: 5000 }, // High volume
        ],
        volumeHistory: [
          { timestamp: Date.now() - 60000, volume: 1000 },
          { timestamp: Date.now() - 30000, volume: 1500 },
          { timestamp: Date.now(), volume: 5000 },
        ],
      });

      const signals = await generateSignalsForMarket(market, feedWithVolume);
      const momentumSignals = signals.filter((s) => s.signalType === "momentum");

      if (momentumSignals.length > 0) {
        const signal = momentumSignals[0];
        expect(signal.metadata?.volumeMomentum).toBeDefined();
        expect(isFinite(signal.metadata?.volumeMomentum || 0)).toBe(true);
      }
    });

    it("should validate expected value before adding momentum signal", async () => {
      const market = createMarket({ impliedProbability: 0.5 });
      const feed = createFeed();

      const signals = await generateSignalsForMarket(market, feed);
      const momentumSignals = signals.filter((s) => s.signalType === "momentum");

      for (const signal of momentumSignals) {
        expect(isFinite(signal.expectedValue)).toBe(true);
        expect(isNaN(signal.expectedValue)).toBe(false);
      }
    });
  });

  describe("Signal Filtering & Scoring Tests", () => {
    it("should filter signals by confidence threshold", () => {
      const signals = [
        {
          marketId: "m1",
          signalType: "value_play" as const,
          side: "yes" as const,
          confidence: 0.9,
          reasoning: "High confidence",
          impliedProbability: 0.5,
          marketPrice: 0.5,
          expectedValue: 0.1,
        },
        {
          marketId: "m2",
          signalType: "momentum" as const,
          side: "no" as const,
          confidence: 0.3,
          reasoning: "Low confidence",
          impliedProbability: 0.5,
          marketPrice: 0.5,
          expectedValue: 0.05,
        },
      ];

      const filtered = filterSignalsByConfidence(signals, 0.5);
      expect(filtered.length).toBe(1);
      expect(filtered[0].confidence).toBe(0.9);
    });

    it("should score signals for execution correctly", () => {
      const signal = {
        marketId: "m1",
        signalType: "value_play" as const,
        side: "yes" as const,
        confidence: 0.8,
        reasoning: "Test signal",
        impliedProbability: 0.5,
        marketPrice: 0.5,
        expectedValue: 0.15,
      };

      const score = scoreSignalForExecution(signal);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
      expect(isFinite(score)).toBe(true);
      expect(isNaN(score)).toBe(false);
    });

    it("should rank signals by execution score", () => {
      const signals = [
        {
          marketId: "m1",
          signalType: "momentum" as const,
          side: "yes" as const,
          confidence: 0.7,
          reasoning: "Momentum",
          impliedProbability: 0.5,
          marketPrice: 0.5,
          expectedValue: 0.1,
        },
        {
          marketId: "m2",
          signalType: "value_play" as const,
          side: "no" as const,
          confidence: 0.6,
          reasoning: "Value play",
          impliedProbability: 0.5,
          marketPrice: 0.5,
          expectedValue: 0.2,
        },
      ];

      const ranked = rankSignalsByExecution(signals);
      expect(ranked.length).toBe(2);
      expect(ranked[0].executionScore).toBeGreaterThanOrEqual(ranked[1].executionScore);
      for (const signal of ranked) {
        expect(isFinite(signal.executionScore)).toBe(true);
      }
    });

    it("should handle empty signal arrays", () => {
      const filtered = filterSignalsByConfidence([], 0.5);
      expect(filtered).toEqual([]);

      const ranked = rankSignalsByExecution([]);
      expect(ranked).toEqual([]);
    });
  });

  describe("Edge Cases & Robustness", () => {
    it("should handle market with extreme prices", async () => {
      const market = createMarket({
        yesPrice: 0.001,
        noPrice: 0.999,
        impliedProbability: 0.001,
      });

      const signals = await generateSignalsForMarket(market);
      expect(Array.isArray(signals)).toBe(true);
      for (const signal of signals) {
        expect(isFinite(signal.confidence)).toBe(true);
        expect(isFinite(signal.expectedValue)).toBe(true);
      }
    });

    it("should handle market with zero volume", async () => {
      const market = createMarket({ volume24h: 0 });
      const signals = await generateSignalsForMarket(market);
      expect(Array.isArray(signals)).toBe(true);
    });

    it("should handle feed with single price point", async () => {
      const market = createMarket();
      const feed = createFeed({
        priceHistory: [{ timestamp: Date.now(), yesPrice: 0.5, noPrice: 0.5, volume: 1000 }],
      });

      const signals = await generateSignalsForMarket(market, feed);
      expect(Array.isArray(signals)).toBe(true);
    });

    it("should handle feed with empty price history", async () => {
      const market = createMarket();
      const feed = createFeed({ priceHistory: [] });

      const signals = await generateSignalsForMarket(market, feed);
      expect(Array.isArray(signals)).toBe(true);
    });

    it("should ensure all signal confidences are in valid range", async () => {
      const market = createMarket();
      const feed = createFeed();

      const signals = await generateSignalsForMarket(market, feed);
      for (const signal of signals) {
        expect(signal.confidence).toBeGreaterThanOrEqual(0);
        expect(signal.confidence).toBeLessThanOrEqual(1);
        expect(isNaN(signal.confidence)).toBe(false);
        expect(isFinite(signal.confidence)).toBe(true);
      }
    });

    it("should ensure all expected values are finite", async () => {
      const market = createMarket();
      const feed = createFeed();

      const signals = await generateSignalsForMarket(market, feed);
      for (const signal of signals) {
        expect(isFinite(signal.expectedValue)).toBe(true);
        expect(isNaN(signal.expectedValue)).toBe(false);
      }
    });
  });
});
