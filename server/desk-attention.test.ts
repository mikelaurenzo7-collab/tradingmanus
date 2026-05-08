import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __TEST_ONLY__, getCategoryWeight, weightForRow } from "./_core/deskAttention";

beforeEach(() => {
  __TEST_ONLY__.reset();
});

afterEach(() => {
  __TEST_ONLY__.reset();
});

describe("weightForRow", () => {
  it("returns neutral 1.0 for cold desks (under threshold)", () => {
    expect(weightForRow({ tradeCount: 0, winCount: 0, lossCount: 0 })).toBe(1.0);
    expect(weightForRow({ tradeCount: 5, winCount: 5, lossCount: 0 })).toBe(1.0);
    expect(weightForRow({ tradeCount: 9, winCount: 9, lossCount: 0 })).toBe(1.0);
  });

  it("returns 0.5 for hot desks (>=65% win rate, >=10 trades)", () => {
    expect(weightForRow({ tradeCount: 20, winCount: 13, lossCount: 7 })).toBe(0.5);
    expect(weightForRow({ tradeCount: 100, winCount: 70, lossCount: 30 })).toBe(0.5);
  });

  it("returns 0.75 for warm desks (55-65% win rate)", () => {
    expect(weightForRow({ tradeCount: 20, winCount: 12, lossCount: 8 })).toBe(0.75); // 60%
  });

  it("returns 1.0 for neutral desks (45-55% win rate)", () => {
    expect(weightForRow({ tradeCount: 20, winCount: 10, lossCount: 10 })).toBe(1.0); // 50%
  });

  it("returns 1.5 for cool desks (35-45% win rate)", () => {
    expect(weightForRow({ tradeCount: 20, winCount: 8, lossCount: 12 })).toBe(1.5); // 40%
  });

  it("returns 2.0 for cold-losing desks (<35% win rate)", () => {
    expect(weightForRow({ tradeCount: 20, winCount: 5, lossCount: 15 })).toBe(2.0); // 25%
    expect(weightForRow({ tradeCount: 100, winCount: 30, lossCount: 70 })).toBe(2.0);
  });
});

describe("getCategoryWeight", () => {
  it("returns 1.0 (neutral) for desks not in the table", () => {
    const table = new Map<string, number>();
    expect(getCategoryWeight(table, "kalshi.crypto")).toBe(1.0);
  });

  it("looks up by deskId", () => {
    const table = new Map<string, number>([
      ["kalshi.crypto", 0.5],
      ["kalshi.weather", 2.0],
    ]);
    expect(getCategoryWeight(table, "kalshi.crypto")).toBe(0.5);
    expect(getCategoryWeight(table, "kalshi.weather")).toBe(2.0);
    expect(getCategoryWeight(table, "kalshi.unknown")).toBe(1.0);
  });
});

describe("buildWeightTable (helper)", () => {
  it("maps each desk row to its computed weight", () => {
    const table = __TEST_ONLY__.buildWeightTable([
      { deskId: "kalshi.crypto", tradeCount: 20, winCount: 13, lossCount: 7 }, // 65% → 0.5
      { deskId: "kalshi.weather", tradeCount: 20, winCount: 5, lossCount: 15 }, // 25% → 2.0
      { deskId: "kalshi.cold", tradeCount: 3, winCount: 2, lossCount: 1 }, // cold → 1.0
    ]);
    expect(table.get("kalshi.crypto")).toBe(0.5);
    expect(table.get("kalshi.weather")).toBe(2.0);
    expect(table.get("kalshi.cold")).toBe(1.0);
  });
});
