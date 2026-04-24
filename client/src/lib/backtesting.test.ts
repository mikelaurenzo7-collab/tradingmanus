import { describe, expect, it } from "vitest";
import { buildScenarioTrades, chooseBacktestMode, mapClosedPositionsToBacktestTrades } from "./backtesting";

describe("backtesting helpers", () => {
  it("builds a bounded scenario trade sample from the selected range", () => {
    const trades = buildScenarioTrades("2024-01-01", "2024-12-31", 2500);

    expect(trades.length).toBeGreaterThanOrEqual(8);
    expect(trades.length).toBeLessThanOrEqual(18);
    expect(trades[0]?.marketId).toContain("_");
    expect(trades.every((trade) => trade.exitTime >= trade.entryTime)).toBe(true);
  });

  it("maps closed live positions into backtest-ready trades ordered by close time", () => {
    const trades = mapClosedPositionsToBacktestTrades([
      {
        marketId: "B",
        side: "no",
        quantity: 10,
        entryPrice: 0.55,
        realizedPnl: -1,
        openedAt: "2026-01-02T00:00:00.000Z",
        closedAt: "2026-01-03T00:00:00.000Z",
        positionStatus: "closed",
      },
      {
        marketId: "A",
        side: "yes",
        quantity: 20,
        entryPrice: 0.4,
        realizedPnl: 2,
        openedAt: "2026-01-01T00:00:00.000Z",
        closedAt: "2026-01-02T00:00:00.000Z",
        positionStatus: "closed",
      },
      {
        marketId: "IGNORED",
        side: "yes",
        quantity: 15,
        entryPrice: 0.5,
        realizedPnl: 1,
        positionStatus: "open",
      },
    ]);

    expect(trades).toHaveLength(2);
    expect(trades[0]?.marketId).toBe("A");
    expect(trades[0]?.exitPrice).toBeCloseTo(0.5, 6);
    expect(trades[1]?.marketId).toBe("B");
    expect(trades[1]?.pnlPercent).toBeCloseTo(-1 / 5.5, 6);
  });

  it("falls back to scenario mode when live mode is requested without closed trades", () => {
    expect(chooseBacktestMode(0, "live")).toBe("scenario");
    expect(chooseBacktestMode(4, "live")).toBe("live");
    expect(chooseBacktestMode(0, "scenario")).toBe("scenario");
  });
});
