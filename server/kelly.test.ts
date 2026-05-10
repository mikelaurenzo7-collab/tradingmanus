import { describe, it, expect } from "vitest";
import {
  calculateKelly,
  applyKellyToPositionSize,
  type KellyInput,
} from "./_core/kellyCriterion";

describe("calculateKelly", () => {
  it("returns correct fractions for a positive-EV signal", () => {
    // p=0.6, market price=0.4 → netOdds = (1 - 0.4) / 0.4 = 1.5
    // fullKelly = (0.6*1.5 - 0.4) / 1.5 = (0.9 - 0.4) / 1.5 = 0.5/1.5 ≈ 0.3333
    // fractionalKelly = 0.3333 * 0.5 ≈ 0.1667 (env-default half-Kelly)
    // kellySuggestedSize = 0.1667 * 1000 ≈ 166.67
    const result = calculateKelly({
      winProbability: 0.6,
      netOdds: 1.5,
      totalCapital: 1000,
    });

    expect(result.isPositiveEV).toBe(true);
    expect(result.fullKellyFraction).toBeCloseTo(1 / 3, 4);
    expect(result.fractionalKellyFraction).toBeCloseTo((1 / 3) * 0.5, 4);
    expect(result.kellySuggestedSize).toBeCloseTo((1 / 3) * 0.5 * 1000, 2);
  });

  it("returns zero for negative-EV signal", () => {
    // p=0.4, EV=0.5: fullKelly = (0.4*0.5 - 0.6)/0.5 = (0.2-0.6)/0.5 = -0.8 → clamped to 0
    const result = calculateKelly({
      winProbability: 0.4,
      netOdds: 0.5,
      totalCapital: 1000,
    });

    expect(result.isPositiveEV).toBe(false);
    expect(result.fractionalKellyFraction).toBe(0);
    expect(result.kellySuggestedSize).toBe(0);
  });

  it("returns zero when EV is zero", () => {
    const result = calculateKelly({
      winProbability: 0.5,
      netOdds: 0,
      totalCapital: 1000,
    });

    expect(result.fractionalKellyFraction).toBe(0);
    expect(result.kellySuggestedSize).toBe(0);
    expect(result.isPositiveEV).toBe(false);
  });

  it("returns zero when EV is negative", () => {
    const result = calculateKelly({
      winProbability: 0.5,
      netOdds: -1,
      totalCapital: 1000,
    });

    expect(result.fractionalKellyFraction).toBe(0);
    expect(result.kellySuggestedSize).toBe(0);
  });

  it("returns zero when winProbability is zero", () => {
    // p=0: fullKelly = (0 - 1)/EV = negative → clamped to 0
    const result = calculateKelly({
      winProbability: 0,
      netOdds: 1.5,
      totalCapital: 1000,
    });

    expect(result.fractionalKellyFraction).toBe(0);
    expect(result.kellySuggestedSize).toBe(0);
    expect(result.isPositiveEV).toBe(false);
  });

  it("caps at MAX_KELLY_FRACTION when winProbability is 1 (guaranteed win)", () => {
    const result = calculateKelly({
      winProbability: 1,
      netOdds: 1.5,
      totalCapital: 1000,
    });

    expect(result.isPositiveEV).toBe(true);
    expect(result.fractionalKellyFraction).toBe(0.25);
    expect(result.kellySuggestedSize).toBe(250);
  });

  it("caps fractional Kelly at MAX_KELLY_FRACTION (0.25) even for very high fullKelly", () => {
    // p=0.99, EV=5 → very high fullKelly; after 0.25x fractional it could exceed 0.25
    const result = calculateKelly({
      winProbability: 0.99,
      netOdds: 5,
      totalCapital: 1000,
    });

    expect(result.fractionalKellyFraction).toBeLessThanOrEqual(0.25);
    expect(result.kellySuggestedSize).toBeLessThanOrEqual(250);
  });

  it("returns zero kellySuggestedSize when totalCapital is zero", () => {
    const result = calculateKelly({
      winProbability: 0.6,
      netOdds: 1.5,
      totalCapital: 0,
    });

    expect(result.kellySuggestedSize).toBe(0);
    // fractions should still be computed correctly
    expect(result.isPositiveEV).toBe(true);
    expect(result.fractionalKellyFraction).toBeGreaterThan(0);
  });

  it("handles non-finite inputs gracefully", () => {
    const inputs: KellyInput[] = [
      { winProbability: NaN, netOdds: 1.5, totalCapital: 1000 },
      { winProbability: 0.6, netOdds: Infinity, totalCapital: 1000 },
      { winProbability: 0.6, netOdds: 1.5, totalCapital: NaN },
    ];

    for (const input of inputs) {
      const result = calculateKelly(input);
      expect(result.fractionalKellyFraction).toBe(0);
      expect(result.kellySuggestedSize).toBe(0);
      expect(result.isPositiveEV).toBe(false);
    }
  });
});

describe("applyKellyToPositionSize", () => {
  it("returns Kelly size when Kelly suggests less than current size", () => {
    const kelly = calculateKelly({
      winProbability: 0.6,
      netOdds: 1.5,
      totalCapital: 1000,
    });
    const result = applyKellyToPositionSize(500, kelly);
    // Kelly size ≈ 83.33, which is less than 500
    expect(result).toBeCloseTo(kelly.kellySuggestedSize, 4);
    expect(result).toBeLessThan(500);
  });

  it("returns original size when Kelly suggests more than current size (conservative)", () => {
    const kelly = calculateKelly({
      winProbability: 0.6,
      netOdds: 1.5,
      totalCapital: 1000,
    });
    // Current size is 10, Kelly suggests ~83 → return 10
    const result = applyKellyToPositionSize(10, kelly);
    expect(result).toBe(10);
  });

  it("returns zero when Kelly suggested size is zero (negative EV)", () => {
    const kelly = calculateKelly({
      winProbability: 0.3,
      netOdds: 0.5,
      totalCapital: 1000,
    });
    expect(kelly.kellySuggestedSize).toBe(0);
    const result = applyKellyToPositionSize(100, kelly);
    expect(result).toBe(0);
  });
});
