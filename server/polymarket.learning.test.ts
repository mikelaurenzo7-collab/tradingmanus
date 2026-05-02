import { describe, it, expect } from "vitest";
import {
  calculatePerformanceMetricsFromTrades,
  analyzeSignalPerformanceFromData,
  type PolymarketPerformanceMetrics,
  type PolymarketSignalPerformance,
} from "./_core/polymarketLearning";

describe("calculatePerformanceMetricsFromTrades", () => {
  it("should return zeros for empty trade history", () => {
    const metrics = calculatePerformanceMetricsFromTrades([]);

    expect(metrics.totalTrades).toBe(0);
    expect(metrics.winningTrades).toBe(0);
    expect(metrics.losingTrades).toBe(0);
    expect(metrics.winRate).toBe(0);
    expect(metrics.profitFactor).toBe(0);
  });

  it("should calculate win rate correctly", () => {
    const trades = [
      {
        marketId: "m1",
        entryPrice: 0.5,
        sizeUsdc: 10,
        realizedPnL: 5,
        closedAt: new Date(),
        positionStatus: "closed",
      },
      {
        marketId: "m2",
        entryPrice: 0.6,
        sizeUsdc: 10,
        realizedPnL: -3,
        closedAt: new Date(),
        positionStatus: "closed",
      },
      {
        marketId: "m3",
        entryPrice: 0.4,
        sizeUsdc: 10,
        realizedPnL: 4,
        closedAt: new Date(),
        positionStatus: "closed",
      },
    ];

    const metrics = calculatePerformanceMetricsFromTrades(trades);

    expect(metrics.totalTrades).toBe(3);
    expect(metrics.winningTrades).toBe(2);
    expect(metrics.losingTrades).toBe(1);
    expect(metrics.winRate).toBeCloseTo(2 / 3, 2);
    expect(metrics.realizedPnL).toBe(6);
  });

  it("should calculate profit factor correctly", () => {
    const trades = [
      {
        marketId: "m1",
        entryPrice: 0.5,
        sizeUsdc: 10,
        realizedPnL: 10,
        closedAt: new Date(),
        positionStatus: "closed",
      },
      {
        marketId: "m2",
        entryPrice: 0.6,
        sizeUsdc: 10,
        realizedPnL: -5,
        closedAt: new Date(),
        positionStatus: "closed",
      },
    ];

    const metrics = calculatePerformanceMetricsFromTrades(trades);

    expect(metrics.profitFactor).toBeCloseTo(10 / 5, 2);
  });

  it("should handle infinite profit factor when no losses", () => {
    const trades = [
      {
        marketId: "m1",
        entryPrice: 0.5,
        sizeUsdc: 10,
        realizedPnL: 10,
        closedAt: new Date(),
        positionStatus: "closed",
      },
      {
        marketId: "m2",
        entryPrice: 0.6,
        sizeUsdc: 10,
        realizedPnL: 5,
        closedAt: new Date(),
        positionStatus: "closed",
      },
    ];

    const metrics = calculatePerformanceMetricsFromTrades(trades);

    expect(metrics.profitFactor).toBe(Number.POSITIVE_INFINITY);
  });

  it("should calculate max drawdown correctly", () => {
    const trades = [
      {
        marketId: "m1",
        entryPrice: 0.5,
        sizeUsdc: 10,
        realizedPnL: 10,
        closedAt: new Date(),
        positionStatus: "closed",
      },
      {
        marketId: "m2",
        entryPrice: 0.6,
        sizeUsdc: 10,
        realizedPnL: -15,
        closedAt: new Date(),
        positionStatus: "closed",
      },
      {
        marketId: "m3",
        entryPrice: 0.4,
        sizeUsdc: 10,
        realizedPnL: 5,
        closedAt: new Date(),
        positionStatus: "closed",
      },
    ];

    const metrics = calculatePerformanceMetricsFromTrades(trades, {
      startingBalance: 100,
    });

    // Starting: 100, After trade 1: 110, After trade 2: 95, After trade 3: 100
    // Peak: 110, Max drawdown: (110 - 95) / 110 = 13.64%
    expect(metrics.maxDrawdown).toBeGreaterThan(0.13);
    expect(metrics.maxDrawdown).toBeLessThan(0.14);
  });

  it("should include unrealized PnL in total", () => {
    const trades = [
      {
        marketId: "m1",
        entryPrice: 0.5,
        sizeUsdc: 10,
        realizedPnL: 5,
        closedAt: new Date(),
        positionStatus: "closed",
      },
    ];

    const openPositions = [
      {
        unrealizedPnL: 3,
      },
      {
        unrealizedPnL: -1,
      },
    ];

    const metrics = calculatePerformanceMetricsFromTrades(trades, {
      openPositions,
    });

    expect(metrics.realizedPnL).toBe(5);
    expect(metrics.unrealizedPnL).toBe(2);
    expect(metrics.totalPnL).toBe(7);
  });

  it("should calculate daily PnL for same-day trades", () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const trades = [
      {
        marketId: "m1",
        entryPrice: 0.5,
        sizeUsdc: 10,
        realizedPnL: 5,
        closedAt: now,
        positionStatus: "closed",
      },
      {
        marketId: "m2",
        entryPrice: 0.6,
        sizeUsdc: 10,
        realizedPnL: 3,
        closedAt: yesterday,
        positionStatus: "closed",
      },
    ];

    const metrics = calculatePerformanceMetricsFromTrades(trades, { now });

    expect(metrics.dailyPnL).toBe(5);
  });
});

describe("analyzeSignalPerformanceFromData", () => {
  it("should return empty array for no signals", () => {
    const performance = analyzeSignalPerformanceFromData([], []);
    expect(performance).toEqual([]);
  });

  it("should calculate success rate correctly", () => {
    const signals = [
      {
        marketId: "m1",
        signalType: "momentum",
        confidence: 0.7,
        expectedValue: 0.1,
      },
      {
        marketId: "m2",
        signalType: "momentum",
        confidence: 0.8,
        expectedValue: 0.15,
      },
      {
        marketId: "m3",
        signalType: "momentum",
        confidence: 0.65,
        expectedValue: 0.12,
      },
    ];

    const trades = [
      {
        marketId: "m1",
        entryPrice: 0.5,
        sizeUsdc: 10,
        realizedPnL: 5,
        closedAt: new Date(),
        positionStatus: "closed",
      },
      {
        marketId: "m2",
        entryPrice: 0.6,
        sizeUsdc: 10,
        realizedPnL: -3,
        closedAt: new Date(),
        positionStatus: "closed",
      },
      {
        marketId: "m3",
        entryPrice: 0.4,
        sizeUsdc: 10,
        realizedPnL: 4,
        closedAt: new Date(),
        positionStatus: "closed",
      },
    ];

    const performance = analyzeSignalPerformanceFromData(signals, trades);

    expect(performance).toHaveLength(1);
    expect(performance[0].signalType).toBe("momentum");
    expect(performance[0].totalSignals).toBe(3);
    expect(performance[0].successfulSignals).toBe(2);
    expect(performance[0].successRate).toBeCloseTo(2 / 3, 2);
  });

  it("should aggregate by signal type", () => {
    const signals = [
      {
        marketId: "m1",
        signalType: "momentum",
        confidence: 0.7,
        expectedValue: 0.1,
      },
      {
        marketId: "m2",
        signalType: "value_play",
        confidence: 0.8,
        expectedValue: 0.15,
      },
      {
        marketId: "m3",
        signalType: "momentum",
        confidence: 0.65,
        expectedValue: 0.12,
      },
    ];

    const trades = [
      {
        marketId: "m1",
        entryPrice: 0.5,
        sizeUsdc: 10,
        realizedPnL: 5,
        closedAt: new Date(),
        positionStatus: "closed",
      },
      {
        marketId: "m2",
        entryPrice: 0.6,
        sizeUsdc: 10,
        realizedPnL: 8,
        closedAt: new Date(),
        positionStatus: "closed",
      },
      {
        marketId: "m3",
        entryPrice: 0.4,
        sizeUsdc: 10,
        realizedPnL: 4,
        closedAt: new Date(),
        positionStatus: "closed",
      },
    ];

    const performance = analyzeSignalPerformanceFromData(signals, trades);

    expect(performance).toHaveLength(2);
    const momentumPerf = performance.find((p) => p.signalType === "momentum");
    const valuePerf = performance.find((p) => p.signalType === "value_play");

    expect(momentumPerf?.totalSignals).toBe(2);
    expect(valuePerf?.totalSignals).toBe(1);
  });

  it("should calculate average confidence", () => {
    const signals = [
      {
        marketId: "m1",
        signalType: "momentum",
        confidence: 0.6,
        expectedValue: 0.1,
      },
      {
        marketId: "m2",
        signalType: "momentum",
        confidence: 0.8,
        expectedValue: 0.15,
      },
    ];

    const trades = [
      {
        marketId: "m1",
        entryPrice: 0.5,
        sizeUsdc: 10,
        realizedPnL: 5,
        closedAt: new Date(),
        positionStatus: "closed",
      },
      {
        marketId: "m2",
        entryPrice: 0.6,
        sizeUsdc: 10,
        realizedPnL: 3,
        closedAt: new Date(),
        positionStatus: "closed",
      },
    ];

    const performance = analyzeSignalPerformanceFromData(signals, trades);

    expect(performance[0].avgConfidence).toBeCloseTo(0.7, 2);
  });

  it("should generate strong_buy recommendation for high win rate and confidence", () => {
    const signals = [
      {
        marketId: "m1",
        signalType: "momentum",
        confidence: 0.85,
        expectedValue: 0.1,
      },
      {
        marketId: "m2",
        signalType: "momentum",
        confidence: 0.9,
        expectedValue: 0.15,
      },
    ];

    const trades = [
      {
        marketId: "m1",
        entryPrice: 0.5,
        sizeUsdc: 10,
        realizedPnL: 5,
        closedAt: new Date(),
        positionStatus: "closed",
      },
      {
        marketId: "m2",
        entryPrice: 0.6,
        sizeUsdc: 10,
        realizedPnL: 3,
        closedAt: new Date(),
        positionStatus: "closed",
      },
    ];

    const performance = analyzeSignalPerformanceFromData(signals, trades);

    expect(performance[0].recommendation).toBe("strong_buy");
  });

  it("should generate strong_sell recommendation for low win rate and confidence", () => {
    const signals = [
      {
        marketId: "m1",
        signalType: "contrarian",
        confidence: 0.45,
        expectedValue: 0.1,
      },
      {
        marketId: "m2",
        signalType: "contrarian",
        confidence: 0.5,
        expectedValue: 0.15,
      },
      {
        marketId: "m3",
        signalType: "contrarian",
        confidence: 0.48,
        expectedValue: 0.12,
      },
    ];

    const trades = [
      {
        marketId: "m1",
        entryPrice: 0.5,
        sizeUsdc: 10,
        realizedPnL: -5,
        closedAt: new Date(),
        positionStatus: "closed",
      },
      {
        marketId: "m2",
        entryPrice: 0.6,
        sizeUsdc: 10,
        realizedPnL: -3,
        closedAt: new Date(),
        positionStatus: "closed",
      },
      {
        marketId: "m3",
        entryPrice: 0.4,
        sizeUsdc: 10,
        realizedPnL: 1,
        closedAt: new Date(),
        positionStatus: "closed",
      },
    ];

    const performance = analyzeSignalPerformanceFromData(signals, trades);

    expect(performance[0].recommendation).toBe("strong_sell");
  });

  it("should use latest outcome when multiple trades exist for same market", () => {
    const signals = [
      {
        marketId: "m1",
        signalType: "momentum",
        confidence: 0.7,
        expectedValue: 0.1,
      },
    ];

    const earlierDate = new Date("2024-01-01");
    const laterDate = new Date("2024-01-02");

    const trades = [
      {
        marketId: "m1",
        entryPrice: 0.5,
        sizeUsdc: 10,
        realizedPnL: -5,
        closedAt: earlierDate,
        positionStatus: "closed",
      },
      {
        marketId: "m1",
        entryPrice: 0.6,
        sizeUsdc: 10,
        realizedPnL: 10,
        closedAt: laterDate,
        positionStatus: "closed",
      },
    ];

    const performance = analyzeSignalPerformanceFromData(signals, trades);

    // Should count as a win (latest outcome is positive)
    expect(performance[0].successfulSignals).toBe(1);
    expect(performance[0].totalPnL).toBe(10);
  });
});
