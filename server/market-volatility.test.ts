import { describe, expect, it } from "vitest";
import { computeVolatilityFromPrices, MARKET_VOLATILITY_DEFAULT } from "./_core/marketVolatility";

describe("computeVolatilityFromPrices", () => {
  it("returns the default when fewer than 5 valid prices", () => {
    expect(computeVolatilityFromPrices([])).toBe(MARKET_VOLATILITY_DEFAULT);
    expect(computeVolatilityFromPrices([0.5, 0.5])).toBe(MARKET_VOLATILITY_DEFAULT);
  });

  it("returns the default when all prices are invalid", () => {
    expect(computeVolatilityFromPrices([0, 0, 0, 0, 0, 0])).toBe(MARKET_VOLATILITY_DEFAULT);
    expect(computeVolatilityFromPrices([1.1, 1.2, 1.3, 1.4, 1.5, 1.6])).toBe(MARKET_VOLATILITY_DEFAULT);
  });

  it("returns a low volatility for a near-flat price series", () => {
    // 0.4995 → 0.5005 oscillation: log returns ~ ±0.001, std-dev tiny
    const prices = [0.5, 0.5005, 0.4995, 0.5, 0.5005, 0.4995, 0.5];
    const vol = computeVolatilityFromPrices(prices);
    expect(vol).toBeGreaterThanOrEqual(0.02); // floor
    expect(vol).toBeLessThan(0.05); // small but above floor
  });

  it("returns a higher volatility for an oscillating series with bigger swings", () => {
    // 0.3 ↔ 0.7: large log returns, std-dev should be substantial
    const prices = [0.5, 0.65, 0.4, 0.6, 0.45, 0.55, 0.4, 0.7, 0.5];
    const vol = computeVolatilityFromPrices(prices);
    expect(vol).toBeGreaterThan(0.1);
    expect(vol).toBeLessThanOrEqual(0.4); // ceiling
  });

  it("clamps extreme outliers at MAX_VOLATILITY (0.40)", () => {
    // Wild oscillations between 0.05 and 0.95 every step
    const prices = [0.05, 0.95, 0.05, 0.95, 0.05, 0.95, 0.05, 0.95];
    expect(computeVolatilityFromPrices(prices)).toBeLessThanOrEqual(0.4);
  });

  it("ignores invalid intermediate prices but still computes from the rest", () => {
    const prices = [0.5, 0, 0.55, NaN, 0.6, 0.58, 0.62, 0.59];
    const vol = computeVolatilityFromPrices(prices);
    expect(vol).toBeGreaterThanOrEqual(0.02);
    expect(vol).toBeLessThanOrEqual(0.4);
    expect(Number.isFinite(vol)).toBe(true);
  });
});
