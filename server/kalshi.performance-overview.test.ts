import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getKalshiCapital: vi.fn(),
  getKalshiTradeHistory: vi.fn(),
  getRecentSignals: vi.fn(),
  getOpenKalshiPositions: vi.fn(),
}));

vi.mock("./db", () => ({
  getKalshiCapital: mocks.getKalshiCapital,
  getKalshiTradeHistory: mocks.getKalshiTradeHistory,
  getRecentSignals: mocks.getRecentSignals,
  getOpenKalshiPositions: mocks.getOpenKalshiPositions,
}));

import { getPerformanceOverview } from "./_core/kalshiLearning";

describe("getPerformanceOverview resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a degraded but usable overview when getRecentSignals throws (schema drift)", async () => {
    mocks.getKalshiCapital.mockResolvedValue({ startingBalance: 100, currentBalance: 73.42 });
    mocks.getKalshiTradeHistory.mockResolvedValue([]);
    mocks.getRecentSignals.mockRejectedValue(
      new Error('column "bayesianProbability" does not exist')
    );
    mocks.getOpenKalshiPositions.mockResolvedValue([]);

    const overview = await getPerformanceOverview(1);

    expect(overview.startingBalance).toBe(100);
    expect(overview.currentBalance).toBe(73.42);
    expect(overview.metrics.totalTrades).toBe(0);
    expect(overview.signalPerformance).toEqual([]);
  });

  it("returns a zeroed overview when every sub-query fails (defensive default)", async () => {
    mocks.getKalshiCapital.mockRejectedValue(new Error("db down"));
    mocks.getKalshiTradeHistory.mockRejectedValue(new Error("db down"));
    mocks.getRecentSignals.mockRejectedValue(new Error("db down"));
    mocks.getOpenKalshiPositions.mockRejectedValue(new Error("db down"));

    const overview = await getPerformanceOverview(1);

    expect(overview.startingBalance).toBe(0);
    expect(overview.currentBalance).toBe(0);
    expect(overview.metrics.totalTrades).toBe(0);
    expect(overview.metrics.profitFactor).toBe(0);
    expect(overview.signalPerformance).toEqual([]);
  });

  it("caps profitFactor at a finite sentinel when there are wins but no losses", async () => {
    mocks.getKalshiCapital.mockResolvedValue({ startingBalance: 100, currentBalance: 105 });
    mocks.getKalshiTradeHistory.mockResolvedValue([
      {
        marketId: "FED-1",
        entryPrice: 0.5,
        quantity: 10,
        realizedPnl: 5,
        positionStatus: "closed",
        closedAt: new Date(),
      },
    ]);
    mocks.getRecentSignals.mockResolvedValue([]);
    mocks.getOpenKalshiPositions.mockResolvedValue([]);

    const overview = await getPerformanceOverview(1);

    expect(Number.isFinite(overview.metrics.profitFactor)).toBe(true);
    expect(overview.metrics.profitFactor).toBeGreaterThan(0);
  });
});
