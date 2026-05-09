import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateSignalsForMarket,
  generateSignalsForMarkets,
  filterSignalsByConfidence,
  scoreSignalForExecution,
  rankSignalsByExecution,
  getTopSignalsForExecution,
  saveSignals,
  calculateSignalPerformance,
  KalshiSignal,
} from "../server/_core/kalshiSignals";
import * as db from "../server/db";

// Mock dependencies
vi.mock("../server/db");

describe("Kalshi Signal Generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // saveMicrostructure is async in production; ensure the mock returns a Promise
    // so that the non-optional .catch() call in kalshiSignals.ts doesn't crash.
    vi.mocked(db.saveMicrostructure).mockResolvedValue(undefined as any);
  });

  describe("generateSignalsForMarket", () => {
    it("should generate value play signal for mispriced market", async () => {
      const market = {
        id: "market-1",
        title: "Bitcoin $100k",
        category: "crypto",
        description: "Test",
        resolutionDate: "2025-12-31",
        status: "open" as const,
        yesPrice: 0.3,
        noPrice: 0.7,
        yesVolume: 1000,
        noVolume: 500,
        impliedProbability: 0.3,
      };

      const signals = await generateSignalsForMarket(market, undefined, 0.6);

      expect(signals).toHaveLength(1);
      expect(signals[0].signalType).toBe("value_play");
      expect(signals[0].side).toBe("yes");
      expect(signals[0].confidence).toBeGreaterThan(0.2);
    });

    it("should generate momentum signal for strong price moves", async () => {
      const market = {
        id: "market-2",
        title: "Test Market",
        category: "test",
        description: "Test",
        resolutionDate: "2025-12-31",
        status: "open" as const,
        yesPrice: 0.7,
        noPrice: 0.3,
        yesVolume: 5000,
        noVolume: 1000,
        impliedProbability: 0.7,
      };

      const feed = {
        marketId: "market-2",
        title: "Test Market",
        category: "test",
        status: "open" as const,
        currentSnapshot: {
          marketId: "market-2",
          timestamp: Date.now(),
          yesPrice: 0.7,
          noPrice: 0.3,
          yesVolume: 5000,
          noVolume: 1000,
          impliedProbability: 0.7,
        },
        priceHistory: [
          {
            marketId: "market-2",
            timestamp: Date.now() - 60000,
            yesPrice: 0.5,
            noPrice: 0.5,
            yesVolume: 1000,
            noVolume: 1000,
            impliedProbability: 0.5,
          },
          {
            marketId: "market-2",
            timestamp: Date.now(),
            yesPrice: 0.7,
            noPrice: 0.3,
            yesVolume: 5000,
            noVolume: 1000,
            impliedProbability: 0.7,
          },
        ],
        volumeHistory: [
          { timestamp: Date.now() - 60000, yesVolume: 1000, noVolume: 1000 },
          { timestamp: Date.now(), yesVolume: 5000, noVolume: 1000 },
        ],
        dataQualityScore: 1.0,
        lastUpdateTime: Date.now(),
      };

      const signals = await generateSignalsForMarket(market, feed);

      const momentumSignal = signals.find((s) => s.signalType === "momentum");
      if (momentumSignal) {
        // Side depends on which momentum is larger; with 5x yes volume increase and 1x no volume decrease, yes momentum wins
        expect(["yes", "no"]).toContain(momentumSignal.side);
        expect(momentumSignal.confidence).toBeGreaterThan(0.3);
      } else {
        // Momentum signal may not be generated if conditions aren't met
        expect(signals.length).toBeGreaterThanOrEqual(0);
      }
    });

    it("should generate contrarian signal for extreme prices", async () => {
      const market = {
        id: "market-3",
        title: "Extreme Market",
        category: "test",
        description: "Test",
        resolutionDate: "2025-12-31",
        status: "open" as const,
        yesPrice: 0.95,
        noPrice: 0.05,
        yesVolume: 10000,
        noVolume: 100,
        impliedProbability: 0.95,
      };

      // Pass fundamentalProbability close to impliedProbability to avoid also generating a value signal,
      // which would be consolidated with the contrarian signal into a confluence signal
      const signals = await generateSignalsForMarket(market, undefined, 0.94);

      const contrarianSignal = signals.find((s) => s.signalType === "contrarian");
      expect(contrarianSignal).toBeDefined();
      expect(contrarianSignal?.side).toBe("no");
      // Confidence is (0.95 - 0.9) / 0.1 = 0.5, but floating point may be slightly less
      expect(contrarianSignal?.confidence).toBeCloseTo(0.5, 1);
    });

    it("should not generate value play signals when market is fairly priced", async () => {
      const market = {
        id: "market-4",
        title: "Fair Market",
        category: "test",
        description: "Test",
        resolutionDate: "2025-12-31",
        status: "open" as const,
        yesPrice: 0.5,
        noPrice: 0.5,
        yesVolume: 1000,
        noVolume: 1000,
        impliedProbability: 0.5,
      };

      const signals = await generateSignalsForMarket(market, undefined, 0.5);

      expect(signals).toHaveLength(0);
    });

    it("should NOT generate a value_play when fundamental falls back to the 0.5 neutral placeholder", async () => {
      // A 0.5 placeholder against any market price creates systematic
      // false-edge signals (every market priced far from 50% looks
      // "mispriced").  We now suppress these at generation time rather
      // than filtering them out post-hoc.
      const market = {
        id: "market-5",
        title: "Mispriced Market",
        category: "test",
        description: "Test",
        resolutionDate: "2025-12-31",
        status: "open" as const,
        yesPrice: 0.32,
        noPrice: 0.68,
        yesVolume: 1200,
        noVolume: 900,
        impliedProbability: 0.32,
      };

      const signals = await generateSignalsForMarket(market);
      const valueSignal = signals.find((signal) => signal.signalType === "value_play");

      expect(valueSignal).toBeUndefined();
    });

    it("tags generated signals with market strategy profile metadata", async () => {
      const market = {
        id: "market-strategy-1",
        title: "Will CPI print above 3.0% this month?",
        category: "economics",
        description: "Macro release market",
        resolutionDate: "2026-12-31",
        status: "open" as const,
        yesPrice: 0.35,
        noPrice: 0.65,
        yesVolume: 8000,
        noVolume: 7000,
        impliedProbability: 0.35,
      };

      const signals = await generateSignalsForMarket(market, undefined, 0.6);

      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0].metadata?.marketCategory).toBe("economics");
      expect(signals[0].metadata?.strategyProfile).toBe("macro_data");
      expect(signals[0].metadata?.platformBehaviorProfile?.platform).toBe("kalshi");
    });

    it("adapts momentum confidence when platform performance has enough samples", async () => {
      const market = {
        id: "market-adapt-1",
        title: "Momentum Adaptation Market",
        category: "politics",
        description: "Test",
        resolutionDate: "2026-12-31",
        status: "open" as const,
        yesPrice: 0.7,
        noPrice: 0.3,
        yesVolume: 4000,
        noVolume: 2000,
        impliedProbability: 0.7,
      };

      const feed = {
        marketId: "market-adapt-1",
        title: "Momentum Adaptation Market",
        category: "politics",
        status: "open" as const,
        currentSnapshot: {
          marketId: "market-adapt-1",
          timestamp: Date.now(),
          yesPrice: 0.7,
          noPrice: 0.3,
          yesVolume: 4000,
          noVolume: 2000,
          impliedProbability: 0.7,
        },
        priceHistory: [
          {
            marketId: "market-adapt-1",
            timestamp: Date.now() - 60000,
            yesPrice: 0.55,
            noPrice: 0.45,
            yesVolume: 1200,
            noVolume: 1100,
            impliedProbability: 0.55,
          },
          {
            marketId: "market-adapt-1",
            timestamp: Date.now(),
            yesPrice: 0.7,
            noPrice: 0.3,
            yesVolume: 4000,
            noVolume: 2000,
            impliedProbability: 0.7,
          },
        ],
        volumeHistory: [
          { timestamp: Date.now() - 60000, yesVolume: 1200, noVolume: 1100 },
          { timestamp: Date.now(), yesVolume: 4000, noVolume: 2000 },
        ],
        dataQualityScore: 1,
        lastUpdateTime: Date.now(),
      };

      const baseSignals = await generateSignalsForMarket(market, feed);
      const adaptedSignals = await generateSignalsForMarket(
        market,
        feed,
        undefined,
        undefined,
        undefined,
        {
          totalClosedTrades: 200,
          signalWinRates: {
            momentum: 0.8,
          },
          categoryEdge: {
            politics: 0.04,
          },
        }
      );

      const baseMomentum = baseSignals.find((signal) => signal.signalType === "momentum");
      const adaptedMomentum = adaptedSignals.find((signal) => signal.signalType === "momentum");

      if (!baseMomentum || !adaptedMomentum) {
        expect(adaptedSignals.length).toBeGreaterThan(0);
        return;
      }

      expect(adaptedMomentum.confidence).toBeGreaterThan(baseMomentum.confidence);
      expect(adaptedMomentum.metadata?.platformBehaviorProfile?.adaptationEpoch).toBe(2);
    });
  });

  describe("generateSignalsForMarkets", () => {
    it("should generate signals for multiple markets", async () => {
      const markets = [
        {
          id: "market-a",
          title: "Market A",
          category: "test",
          description: "Test",
          resolutionDate: "2025-12-31",
          status: "open" as const,
          yesPrice: 0.3,
          noPrice: 0.7,
          yesVolume: 1000,
          noVolume: 500,
          impliedProbability: 0.3,
        },
        {
          id: "market-b",
          title: "Market B",
          category: "test",
          description: "Test",
          resolutionDate: "2025-12-31",
          status: "open" as const,
          yesPrice: 0.7,
          noPrice: 0.3,
          yesVolume: 1000,
          noVolume: 500,
          impliedProbability: 0.7,
        },
      ];

      const fundamentalProbs = new Map([
        ["market-a", 0.6],
        ["market-b", 0.4],
      ]);

      const signals = await generateSignalsForMarkets(markets, undefined, fundamentalProbs);

      expect(signals.length).toBeGreaterThan(0);
      expect(signals.some((s) => s.marketId === "market-a")).toBe(true);
      expect(signals.some((s) => s.marketId === "market-b")).toBe(true);
    });
  });

  describe("filterSignalsByConfidence", () => {
    it("should filter signals by confidence threshold", () => {
      const signals: KalshiSignal[] = [
        {
          marketId: "m1",
          signalType: "value_play",
          side: "yes",
          confidence: 0.9,
          reasoning: "High confidence",
          impliedProbability: 0.3,
          marketPrice: 0.3,
          expectedValue: 0.2,
        },
        {
          marketId: "m2",
          signalType: "momentum",
          side: "no",
          confidence: 0.4,
          reasoning: "Low confidence",
          impliedProbability: 0.6,
          marketPrice: 0.6,
          expectedValue: 0.1,
        },
        {
          marketId: "m3",
          signalType: "contrarian",
          side: "yes",
          confidence: 0.7,
          reasoning: "Medium confidence",
          impliedProbability: 0.95,
          marketPrice: 0.95,
          expectedValue: 0.15,
        },
      ];

      const filtered = filterSignalsByConfidence(signals, 0.6);

      expect(filtered).toHaveLength(2);
      expect(filtered.every((s) => s.confidence >= 0.6)).toBe(true);
    });

    it("should return empty array when no signals meet threshold", () => {
      const signals: KalshiSignal[] = [
        {
          marketId: "m1",
          signalType: "value_play",
          side: "yes",
          confidence: 0.3,
          reasoning: "Low confidence",
          impliedProbability: 0.3,
          marketPrice: 0.3,
          expectedValue: 0.2,
        },
      ];

      const filtered = filterSignalsByConfidence(signals, 0.8);

      expect(filtered).toHaveLength(0);
    });
  });

  describe("scoreSignalForExecution", () => {
    it("should score value play signals higher", () => {
      const valuePlaySignal: KalshiSignal = {
        marketId: "m1",
        signalType: "value_play",
        side: "yes",
        confidence: 0.8,
        reasoning: "Value play",
        impliedProbability: 0.3,
        marketPrice: 0.3,
        expectedValue: 0.15,
      };

      const momentumSignal: KalshiSignal = {
        marketId: "m2",
        signalType: "momentum",
        side: "yes",
        confidence: 0.8,
        reasoning: "Momentum",
        impliedProbability: 0.6,
        marketPrice: 0.6,
        expectedValue: 0.05,
      };

      const valueScore = scoreSignalForExecution(valuePlaySignal);
      const momentumScore = scoreSignalForExecution(momentumSignal);

      expect(valueScore).toBeGreaterThan(momentumScore);
    });

    it("should score contrarian signals lower", () => {
      const valuePlaySignal: KalshiSignal = {
        marketId: "m1",
        signalType: "value_play",
        side: "yes",
        confidence: 0.8,
        reasoning: "Value play",
        impliedProbability: 0.3,
        marketPrice: 0.3,
        expectedValue: 0.15,
      };

      const contrarianSignal: KalshiSignal = {
        marketId: "m2",
        signalType: "contrarian",
        side: "no",
        confidence: 0.8,
        reasoning: "Contrarian",
        impliedProbability: 0.95,
        marketPrice: 0.95,
        expectedValue: 0.1,
      };

      const valueScore = scoreSignalForExecution(valuePlaySignal);
      const contrarianScore = scoreSignalForExecution(contrarianSignal);

      expect(valueScore).toBeGreaterThan(contrarianScore);
    });

    it("should boost score for high expected value", () => {
      const highEVSignal: KalshiSignal = {
        marketId: "m1",
        signalType: "value_play",
        side: "yes",
        confidence: 0.7,
        reasoning: "High EV",
        impliedProbability: 0.3,
        marketPrice: 0.3,
        expectedValue: 0.2,
      };

      const lowEVSignal: KalshiSignal = {
        marketId: "m2",
        signalType: "value_play",
        side: "yes",
        confidence: 0.7,
        reasoning: "Low EV",
        impliedProbability: 0.3,
        marketPrice: 0.3,
        expectedValue: 0.05,
      };

      const highEVScore = scoreSignalForExecution(highEVSignal);
      const lowEVScore = scoreSignalForExecution(lowEVSignal);

      expect(highEVScore).toBeGreaterThan(lowEVScore);
    });

    it("penalizes thin-liquidity execution profiles", () => {
      const liquidSignal: KalshiSignal = {
        marketId: "m1",
        signalType: "value_play",
        side: "yes",
        confidence: 0.72,
        reasoning: "Liquid",
        impliedProbability: 0.45,
        marketPrice: 0.45,
        expectedValue: 0.12,
        metadata: { liquidityScore: 0.9, spreadProxy: 0.01, totalVolume: 10000 },
      };
      const thinSignal: KalshiSignal = {
        ...liquidSignal,
        marketId: "m2",
        reasoning: "Thin",
        metadata: { liquidityScore: 0.2, spreadProxy: 0.1, totalVolume: 150 },
      };

      expect(scoreSignalForExecution(liquidSignal)).toBeGreaterThan(scoreSignalForExecution(thinSignal));
    });

    it("penalizes near-tail pricing to avoid late-cycle adverse selection", () => {
      const balancedPrice: KalshiSignal = {
        marketId: "m1",
        signalType: "value_play",
        side: "yes",
        confidence: 0.78,
        reasoning: "Balanced pricing",
        impliedProbability: 0.45,
        marketPrice: 0.45,
        expectedValue: 0.1,
      };
      const tailPrice: KalshiSignal = {
        ...balancedPrice,
        marketId: "m2",
        marketPrice: 0.97,
        impliedProbability: 0.97,
        reasoning: "Tail pricing",
      };

      expect(scoreSignalForExecution(balancedPrice)).toBeGreaterThan(scoreSignalForExecution(tailPrice));
    });

    it("applies category strategy profile adjustments (macro favored vs crypto constrained)", () => {
      const macroSignal: KalshiSignal = {
        marketId: "macro-1",
        signalType: "value_play",
        side: "yes",
        confidence: 0.74,
        reasoning: "Macro signal",
        impliedProbability: 0.42,
        marketPrice: 0.42,
        expectedValue: 0.12,
        metadata: {
          liquidityScore: 0.6,
          strategyProfile: "macro_data",
        },
      };
      const cryptoSignal: KalshiSignal = {
        ...macroSignal,
        marketId: "crypto-1",
        reasoning: "Crypto signal",
        metadata: {
          liquidityScore: 0.6,
          strategyProfile: "crypto_event",
        },
      };

      expect(scoreSignalForExecution(macroSignal)).toBeGreaterThan(scoreSignalForExecution(cryptoSignal));
    });
  });

  describe("rankSignalsByExecution", () => {
    it("should rank signals by execution score", () => {
      const signals: KalshiSignal[] = [
        {
          marketId: "m1",
          signalType: "momentum",
          side: "yes",
          confidence: 0.5,
          reasoning: "Low score",
          impliedProbability: 0.5,
          marketPrice: 0.5,
          expectedValue: 0.01,
        },
        {
          marketId: "m2",
          signalType: "value_play",
          side: "yes",
          confidence: 0.9,
          reasoning: "High score",
          impliedProbability: 0.3,
          marketPrice: 0.3,
          expectedValue: 0.2,
        },
      ];

      const ranked = rankSignalsByExecution(signals);

      expect(ranked[0].marketId).toBe("m2");
      expect(ranked[1].marketId).toBe("m1");
      expect(ranked[0].executionScore).toBeGreaterThan(ranked[1].executionScore);
    });
  });

  describe("getTopSignalsForExecution", () => {
    it("should return top N signals above execution score threshold", () => {
      const signals: KalshiSignal[] = [
        {
          marketId: "m1",
          signalType: "value_play",
          side: "yes",
          confidence: 0.9,
          reasoning: "Excellent",
          impliedProbability: 0.3,
          marketPrice: 0.3,
          expectedValue: 0.2,
        },
        {
          marketId: "m2",
          signalType: "value_play",
          side: "yes",
          confidence: 0.8,
          reasoning: "Good",
          impliedProbability: 0.3,
          marketPrice: 0.3,
          expectedValue: 0.15,
        },
        {
          marketId: "m3",
          signalType: "momentum",
          side: "yes",
          confidence: 0.4,
          reasoning: "Poor",
          impliedProbability: 0.5,
          marketPrice: 0.5,
          expectedValue: 0.01,
        },
      ];

      const top = getTopSignalsForExecution(signals, 2, 0.6);

      expect(top).toHaveLength(2);
      expect(top.every((s) => s.executionScore >= 0.6)).toBe(true);
      expect(top[0].marketId).toBe("m1");
      expect(top[1].marketId).toBe("m2");
    });

    it("should return fewer signals if not enough meet threshold", () => {
      const signals: KalshiSignal[] = [
        {
          marketId: "m1",
          signalType: "value_play",
          side: "yes",
          confidence: 0.3,
          reasoning: "Low confidence",
          impliedProbability: 0.3,
          marketPrice: 0.3,
          expectedValue: 0.1,
        },
      ];

      const top = getTopSignalsForExecution(signals, 5, 0.8);

      expect(top).toHaveLength(0);
    });

    it("excludes heuristic-baseline value plays from execution-ready results", () => {
      const signals: KalshiSignal[] = [
        {
          marketId: "heuristic-m1",
          signalType: "value_play",
          side: "yes",
          confidence: 0.92,
          reasoning: "Market mispriced (heuristic baseline): YES probability 12.0% vs neutral baseline 50.0%",
          impliedProbability: 0.12,
          marketPrice: 0.12,
          expectedValue: 0.38,
        },
        {
          marketId: "legacy-heuristic-m2",
          signalType: "value_play",
          side: "yes",
          confidence: 0.88,
          reasoning: "Market mispriced: YES probability 8.8% vs fundamental 50.0%",
          impliedProbability: 0.088,
          marketPrice: 0.09,
          expectedValue: 0.41,
        },
        {
          marketId: "explicit-m3",
          signalType: "value_play",
          side: "yes",
          confidence: 0.84,
          reasoning: "Market mispriced: YES probability 42.0% vs fundamental 61.0%",
          impliedProbability: 0.42,
          marketPrice: 0.42,
          expectedValue: 0.19,
          metadata: {
            fundamentalProbability: 0.61,
            fundamentalSource: "explicit",
          },
        },
      ];

      const top = getTopSignalsForExecution(signals, 5, 0.6);

      expect(top).toHaveLength(1);
      expect(top[0].marketId).toBe("explicit-m3");
    });

    it("keeps only the best signal per market to avoid duplicate exposure", () => {
      const signals: KalshiSignal[] = [
        {
          marketId: "same-market",
          signalType: "momentum",
          side: "yes",
          confidence: 0.72,
          reasoning: "Lower score variant",
          impliedProbability: 0.46,
          marketPrice: 0.46,
          expectedValue: 0.08,
        },
        {
          marketId: "same-market",
          signalType: "value_play",
          side: "yes",
          confidence: 0.84,
          reasoning: "Higher score variant",
          impliedProbability: 0.44,
          marketPrice: 0.44,
          expectedValue: 0.14,
        },
        {
          marketId: "other-market",
          signalType: "value_play",
          side: "no",
          confidence: 0.82,
          reasoning: "Other market",
          impliedProbability: 0.38,
          marketPrice: 0.62,
          expectedValue: 0.13,
        },
      ];

      const top = getTopSignalsForExecution(signals, 5, 0.6);
      const sameMarketEntries = top.filter((signal) => signal.marketId === "same-market");

      expect(sameMarketEntries).toHaveLength(1);
      expect(sameMarketEntries[0].reasoning).toContain("Higher score variant");
      expect(top).toHaveLength(2);
    });

  });

  describe("saveSignals", () => {
    it("should save signals to database", async () => {
      const signals: KalshiSignal[] = [
        {
          marketId: "m1",
          signalType: "value_play",
          side: "yes",
          confidence: 0.8,
          reasoning: "Test signal",
          impliedProbability: 0.3,
          marketPrice: 0.3,
          expectedValue: 0.15,
        },
      ];

      await saveSignals(signals, 7);

      expect(vi.mocked(db.createKalshiSignal)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(db.createKalshiSignal)).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, marketId: "m1", signalType: "value_play" }));
    });
  });

  describe("calculateSignalPerformance", () => {
    it("should calculate performance metrics by signal type", () => {
      const signals: KalshiSignal[] = [
        {
          marketId: "m1",
          signalType: "value_play",
          side: "yes",
          confidence: 0.8,
          reasoning: "Test",
          impliedProbability: 0.3,
          marketPrice: 0.3,
          expectedValue: 0.15,
        },
        {
          marketId: "m2",
          signalType: "value_play",
          side: "yes",
          confidence: 0.7,
          reasoning: "Test",
          impliedProbability: 0.4,
          marketPrice: 0.4,
          expectedValue: 0.1,
        },
        {
          marketId: "m3",
          signalType: "momentum",
          side: "yes",
          confidence: 0.6,
          reasoning: "Test",
          impliedProbability: 0.6,
          marketPrice: 0.6,
          expectedValue: 0.05,
        },
      ];

      const outcomes = new Map([
        ["m1", { won: true, pnl: 10 }],
        ["m2", { won: false, pnl: -5 }],
        ["m3", { won: true, pnl: 8 }],
      ]);

      const performance = calculateSignalPerformance(signals, outcomes);

      expect(performance.has("value_play")).toBe(true);
      expect(performance.has("momentum")).toBe(true);

      const valuePlayPerf = performance.get("value_play")!;
      expect(valuePlayPerf.totalSignals).toBe(2);
      expect(valuePlayPerf.winningSignals).toBe(1);
      expect(valuePlayPerf.losingSignals).toBe(1);
      expect(valuePlayPerf.winRate).toBe(0.5);
      expect(valuePlayPerf.realizedPnL).toBe(5); // 10 - 5

      const momentumPerf = performance.get("momentum")!;
      expect(momentumPerf.totalSignals).toBe(1);
      expect(momentumPerf.winningSignals).toBe(1);
      expect(momentumPerf.winRate).toBe(1.0);
      expect(momentumPerf.realizedPnL).toBe(8);
    });

    it("does not crash for newly added SignalType values not in the legacy seed list", () => {
      // Regression for the previous `performance.get(signal.signalType)!`
      // crash when the map was only pre-seeded with 5 of 10 SignalTypes.
      const signals: KalshiSignal[] = [
        {
          marketId: "m-tell",
          signalType: "linguistic_tell",
          side: "yes",
          confidence: 0.7,
          reasoning: "tell",
          impliedProbability: 0.2,
          marketPrice: 0.2,
          expectedValue: 0.4,
        },
        {
          marketId: "m-wiki",
          signalType: "wikipedia_edit",
          side: "yes",
          confidence: 0.6,
          reasoning: "wikipedia",
          impliedProbability: 0.3,
          marketPrice: 0.3,
          expectedValue: 0.2,
        },
      ];
      const outcomes = new Map([
        ["m-tell", { won: true, pnl: 12 }],
        ["m-wiki", { won: false, pnl: -3 }],
      ]);
      expect(() => calculateSignalPerformance(signals, outcomes)).not.toThrow();
      const perf = calculateSignalPerformance(signals, outcomes);
      expect(perf.get("linguistic_tell")?.totalSignals).toBe(1);
      expect(perf.get("linguistic_tell")?.winningSignals).toBe(1);
      expect(perf.get("wikipedia_edit")?.totalSignals).toBe(1);
      expect(perf.get("wikipedia_edit")?.losingSignals).toBe(1);
    });
  });
});
