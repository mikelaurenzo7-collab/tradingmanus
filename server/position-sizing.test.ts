import { describe, expect, it } from "vitest";
import { computeKellyBet, beliefFromSignal } from "./_core/positionSizing";

describe("computeKellyBet", () => {
  it("vetoes when belief equals market (no edge)", () => {
    const result = computeKellyBet({
      side: "yes",
      marketYesPrice: 0.5,
      beliefYesProbability: 0.5,
      equity: 1000,
    });
    expect(result.betDollars).toBe(0);
    expect(result.reason).toBe("no_edge");
  });

  it("vetoes when belief is unfavorable", () => {
    // Buy YES but believe YES wins less often than the market does.
    const result = computeKellyBet({
      side: "yes",
      marketYesPrice: 0.6,
      beliefYesProbability: 0.4,
      equity: 1000,
    });
    expect(result.betDollars).toBe(0);
    expect(result.reason).toBe("no_edge");
  });

  it("sizes correctly at the textbook example (40% market, 60% belief, full Kelly)", () => {
    // Full Kelly on (price 0.4, belief 0.6) → (0.6 - 0.4) / (1 - 0.4) = 0.333…
    const result = computeKellyBet({
      side: "yes",
      marketYesPrice: 0.4,
      beliefYesProbability: 0.6,
      equity: 1000,
      kellyFraction: 1,
      maxFractionOfEquity: 1,
    });
    expect(result.fullKellyFraction).toBeCloseTo(0.3333, 3);
    expect(result.effectiveFraction).toBeCloseTo(0.3333, 3);
    expect(result.betDollars).toBeCloseTo(333.33, 0);
    expect(result.reason).toBe("kelly_sized");
  });

  it("scales by fractional Kelly multiplier", () => {
    const full = computeKellyBet({
      side: "yes",
      marketYesPrice: 0.4,
      beliefYesProbability: 0.6,
      equity: 1000,
      kellyFraction: 1,
      maxFractionOfEquity: 1,
    });
    const quarter = computeKellyBet({
      side: "yes",
      marketYesPrice: 0.4,
      beliefYesProbability: 0.6,
      equity: 1000,
      kellyFraction: 0.25,
      maxFractionOfEquity: 1,
    });
    expect(quarter.betDollars).toBeCloseTo(full.betDollars * 0.25, 1);
    expect(quarter.reason).toBe("kelly_sized");
  });

  it("honors the max fraction-of-equity hard cap", () => {
    // Full Kelly would exceed 5% of equity → cap kicks in.
    const result = computeKellyBet({
      side: "yes",
      marketYesPrice: 0.2,
      beliefYesProbability: 0.6,
      equity: 1000,
      kellyFraction: 1,
      maxFractionOfEquity: 0.05,
    });
    expect(result.betDollars).toBe(50);
    expect(result.reason).toBe("kelly_capped");
  });

  it("drops bets below minBetDollars", () => {
    // Tiny edge × small equity → < $1 bet, dropped.
    const result = computeKellyBet({
      side: "yes",
      marketYesPrice: 0.5,
      beliefYesProbability: 0.51,
      equity: 50,
      kellyFraction: 0.25,
      maxFractionOfEquity: 0.05,
      minBetDollars: 1,
    });
    expect(result.betDollars).toBe(0);
    expect(result.reason).toBe("below_min");
  });

  it("handles NO bets symmetrically", () => {
    // Buying NO at YES price 0.7 with belief P(YES)=0.5 → P(NO)=0.5,
    // NO market price = 0.3, edge = (0.5 - 0.3) / 0.7 = 0.286.
    const result = computeKellyBet({
      side: "no",
      marketYesPrice: 0.7,
      beliefYesProbability: 0.5,
      equity: 1000,
      kellyFraction: 1,
      maxFractionOfEquity: 1,
    });
    expect(result.fullKellyFraction).toBeCloseTo(0.286, 2);
    expect(result.betDollars).toBeCloseTo(286, 0);
  });

  it("returns invalid for malformed inputs", () => {
    const r1 = computeKellyBet({
      side: "yes",
      marketYesPrice: 0,
      beliefYesProbability: 0.5,
      equity: 1000,
    });
    expect(r1.reason).toBe("invalid");
    const r2 = computeKellyBet({
      side: "yes",
      marketYesPrice: 0.5,
      beliefYesProbability: 1.5,
      equity: 1000,
    });
    expect(r2.reason).toBe("invalid");
    const r3 = computeKellyBet({
      side: "yes",
      marketYesPrice: 0.5,
      beliefYesProbability: 0.5,
      equity: -100,
    });
    expect(r3.reason).toBe("invalid");
  });
});

describe("beliefFromSignal", () => {
  it("maps YES side directly to confidence", () => {
    expect(beliefFromSignal("yes", 0.7)).toBeCloseTo(0.7, 6);
  });

  it("inverts confidence for NO side", () => {
    expect(beliefFromSignal("no", 0.7)).toBeCloseTo(0.3, 6);
  });

  it("clamps to (0.01, 0.99)", () => {
    expect(beliefFromSignal("yes", 1)).toBeCloseTo(0.99, 6);
    expect(beliefFromSignal("yes", 0)).toBeCloseTo(0.01, 6);
  });

  it("supports a calibration function", () => {
    const cal = (raw: number) => raw * 0.8;
    expect(beliefFromSignal("yes", 0.7, { calibration: cal })).toBeCloseTo(0.56, 6);
  });
});
