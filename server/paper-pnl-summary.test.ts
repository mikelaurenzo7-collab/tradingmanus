import { describe, expect, it } from "vitest";
import { summarisePnls, combineBreakdowns } from "./_core/paperPnlSummary";

describe("summarisePnls", () => {
  it("returns empty breakdown for empty input", () => {
    const r = summarisePnls([]);
    expect(r.closedTrades).toBe(0);
    expect(r.totalPnlUsd).toBe(0);
    expect(r.winRate).toBe(0);
  });

  it("computes win/loss counts and totals correctly", () => {
    const r = summarisePnls([10, -5, 7, -3, 0, 12]);
    expect(r.closedTrades).toBe(6);
    expect(r.winningTrades).toBe(3);
    expect(r.losingTrades).toBe(2); // 0 doesn't count as win or loss
    expect(r.totalPnlUsd).toBe(21);
    expect(r.averagePnlUsd).toBeCloseTo(21 / 6);
    expect(r.winRate).toBeCloseTo(3 / 5); // 3 wins / 5 decisive
    expect(r.largestWinUsd).toBe(12);
    expect(r.largestLossUsd).toBe(-5);
  });

  it("ignores non-finite pnl values", () => {
    const r = summarisePnls([10, NaN, -5, Infinity]);
    expect(r.closedTrades).toBe(4); // count includes invalids
    expect(r.totalPnlUsd).toBe(5); // 10 + -5 (invalids skipped in totals)
  });

  it("handles all-winning input (winRate = 1)", () => {
    const r = summarisePnls([1, 2, 3, 4]);
    expect(r.winRate).toBe(1);
    expect(r.losingTrades).toBe(0);
  });

  it("handles all-losing input (winRate = 0)", () => {
    const r = summarisePnls([-1, -2, -3]);
    expect(r.winRate).toBe(0);
    expect(r.winningTrades).toBe(0);
    expect(r.totalPnlUsd).toBe(-6);
  });
});

describe("combineBreakdowns", () => {
  it("sums counts + totals across two breakdowns", () => {
    const a = summarisePnls([10, -5, 7]); // 2 wins, 1 loss, total 12
    const b = summarisePnls([3, -8]);     // 1 win, 1 loss, total -5
    const c = combineBreakdowns(a, b);
    expect(c.closedTrades).toBe(5);
    expect(c.winningTrades).toBe(3);
    expect(c.losingTrades).toBe(2);
    expect(c.totalPnlUsd).toBe(7);
    expect(c.winRate).toBeCloseTo(3 / 5);
    expect(c.largestWinUsd).toBe(10);
    expect(c.largestLossUsd).toBe(-8);
  });

  it("handles combining with an empty breakdown", () => {
    const empty = summarisePnls([]);
    const populated = summarisePnls([5, -3, 10]);
    const c = combineBreakdowns(empty, populated);
    expect(c).toEqual(populated);
  });
});
