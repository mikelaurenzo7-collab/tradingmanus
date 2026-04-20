import { describe, expect, it } from "vitest";
import {
  calculateImpliedProbability,
  fetchKalshiMarketDetails,
  getKalshiMarketDetails,
} from "./_core/kalshiMarketData";

describe("kalshi market data helpers", () => {
  it("calculates implied probability from yes/no prices", () => {
    expect(calculateImpliedProbability(60, 40)).toBeCloseTo(0.6, 5);
    expect(calculateImpliedProbability(0, 0)).toBe(0.5);
  });

  it("exports getKalshiMarketDetails as the dedicated details helper", () => {
    expect(getKalshiMarketDetails).toBe(fetchKalshiMarketDetails);
  });
});
