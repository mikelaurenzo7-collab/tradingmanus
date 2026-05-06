import { describe, expect, it } from "vitest";
import {
  analyzeSignalPerformanceFromData,
  buildKalshiPlatformBehaviorSnapshot,
  calculatePerformanceMetricsFromTrades,
} from "./_core/kalshiLearning";

describe("kalshi learning helpers", () => {
  it("derives truthful performance metrics from closed and open positions", () => {
    const metrics = calculatePerformanceMetricsFromTrades(
      [
        {
          marketId: "FED-1",
          entryPrice: 0.5,
          quantity: 10,
          realizedPnl: 2,
          positionStatus: "closed",
          closedAt: new Date("2026-04-24T12:00:00Z"),
        },
        {
          marketId: "CPI-1",
          entryPrice: 0.4,
          quantity: 10,
          realizedPnL: -1,
          positionStatus: "closed",
          closedAt: new Date("2026-04-23T12:00:00Z"),
        },
      ],
      {
        startingBalance: 100,
        now: new Date("2026-04-24T14:00:00Z"),
        openPositions: [{ unrealizedPnl: 1.5 }],
      }
    );

    expect(metrics.totalTrades).toBe(2);
    expect(metrics.winningTrades).toBe(1);
    expect(metrics.losingTrades).toBe(1);
    expect(metrics.winRate).toBe(0.5);
    expect(metrics.realizedPnL).toBe(1);
    expect(metrics.unrealizedPnL).toBe(1.5);
    expect(metrics.totalPnL).toBe(2.5);
    expect(metrics.dailyPnL).toBe(2);
    expect(metrics.activePositions).toBe(1);
    expect(metrics.maxDrawdown).toBeGreaterThan(0);
  });

  it("groups signal performance by signal type using latest market outcomes", () => {
    const performance = analyzeSignalPerformanceFromData(
      [
        { marketId: "FED-1", signalType: "momentum", confidence: 0.8 },
        { marketId: "FED-1", signalType: "momentum", confidence: 0.6 },
        { marketId: "CPI-1", signalType: "contrarian", confidence: 0.4 },
      ],
      [
        {
          marketId: "FED-1",
          realizedPnl: 3,
          positionStatus: "closed",
          closedAt: new Date("2026-04-24T12:00:00Z"),
        },
        {
          marketId: "CPI-1",
          realizedPnL: -2,
          positionStatus: "closed",
          closedAt: new Date("2026-04-24T11:00:00Z"),
        },
      ]
    );

    expect(performance).toHaveLength(2);
    expect(performance[0]).toMatchObject({
      signalType: "momentum",
      totalSignals: 2,
      successfulSignals: 2,
      successRate: 1,
      totalPnL: 6,
      recommendation: "buy",
    });
    expect(performance[1]).toMatchObject({
      signalType: "contrarian",
      totalSignals: 1,
      successfulSignals: 0,
      successRate: 0,
      totalPnL: -2,
      recommendation: "strong_sell",
    });
  });

  it("builds platform behavior snapshot with 100-trade adaptation epochs", () => {
    const metrics = calculatePerformanceMetricsFromTrades(
      Array.from({ length: 205 }, (_, index) => ({
        marketId: `M-${index}`,
        entryPrice: 0.5,
        quantity: 10,
        realizedPnL: index % 2 === 0 ? 1 : -0.2,
        positionStatus: "closed",
        closedAt: new Date(`2026-04-24T12:${String(index % 60).padStart(2, "0")}:00Z`),
      }))
    );

    const signalPerformance = analyzeSignalPerformanceFromData(
      [
        { marketId: "M-1", signalType: "momentum", confidence: 0.7 },
        { marketId: "M-2", signalType: "momentum", confidence: 0.8 },
        { marketId: "M-3", signalType: "sentiment", confidence: 0.6 },
      ],
      [
        { marketId: "M-1", realizedPnL: 1, positionStatus: "closed", closedAt: new Date("2026-04-24T12:00:00Z") },
        { marketId: "M-2", realizedPnL: 1, positionStatus: "closed", closedAt: new Date("2026-04-24T12:01:00Z") },
        { marketId: "M-3", realizedPnL: -1, positionStatus: "closed", closedAt: new Date("2026-04-24T12:02:00Z") },
      ]
    );

    const snapshot = buildKalshiPlatformBehaviorSnapshot(metrics, signalPerformance);

    expect(snapshot.totalClosedTrades).toBe(205);
    expect(snapshot.adaptationEpoch).toBe(2);
    expect(snapshot.hasSufficientData).toBe(true);
    expect(snapshot.signalWinRates.momentum).toBeGreaterThan(snapshot.signalWinRates.sentiment);
  });
});
