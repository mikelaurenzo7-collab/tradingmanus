/**
 * Polymarket Risk Validation Tests
 *
 * Covers the price-bounds invariant (Option B security fix):
 *   validatePolymarketOrderRisk must reject prices outside [MIN, MAX].
 *
 * Polymarket prices are USDC-denominated decimals in [0, 1].
 * Never apply centsToDollars conversion here.
 */
import { describe, it, expect } from "vitest";
import {
  validatePolymarketOrderRisk,
  normalizeLimitPrice,
  normalizeOrderSize,
  calculatePolymarketBuyOrderRisk,
  kellyFraction,
  estimateSizeForRiskBudget,
  MIN_POLYMARKET_LIMIT_PRICE,
  MAX_POLYMARKET_LIMIT_PRICE,
  MAX_POLYMARKET_ORDER_USDC,
} from "./_core/polymarketRisk";

const VALID_LIMITS = {
  maxOrderUsdc: MAX_POLYMARKET_ORDER_USDC,
  maxExposurePercent: 0.05,
  bankroll: 1000,
};

describe("Polymarket Risk — normalizeLimitPrice", () => {
  it("accepts valid prices at boundaries", () => {
    expect(normalizeLimitPrice(MIN_POLYMARKET_LIMIT_PRICE)).toBe(MIN_POLYMARKET_LIMIT_PRICE);
    expect(normalizeLimitPrice(MAX_POLYMARKET_LIMIT_PRICE)).toBe(MAX_POLYMARKET_LIMIT_PRICE);
    expect(normalizeLimitPrice(0.5)).toBe(0.5);
  });

  it("rejects price below MIN", () => {
    expect(() => normalizeLimitPrice(0)).toThrow(/between/);
    expect(() => normalizeLimitPrice(0.005)).toThrow(/between/);
    expect(() => normalizeLimitPrice(-1)).toThrow(/between/);
  });

  it("rejects price above MAX", () => {
    expect(() => normalizeLimitPrice(1)).toThrow(/between/);
    expect(() => normalizeLimitPrice(0.995)).toThrow(/between/);
    expect(() => normalizeLimitPrice(1.5)).toThrow(/between/);
  });

  it("rejects non-finite values", () => {
    expect(() => normalizeLimitPrice(NaN)).toThrow(/between/);
    expect(() => normalizeLimitPrice(Infinity)).toThrow(/between/);
    expect(() => normalizeLimitPrice(-Infinity)).toThrow(/between/);
  });
});

describe("Polymarket Risk — normalizeOrderSize", () => {
  it("accepts valid sizes", () => {
    expect(normalizeOrderSize(1)).toBe(1);
    expect(normalizeOrderSize(MAX_POLYMARKET_ORDER_USDC)).toBe(MAX_POLYMARKET_ORDER_USDC);
  });

  it("rejects zero or negative size", () => {
    expect(() => normalizeOrderSize(0)).toThrow(/positive/);
    expect(() => normalizeOrderSize(-10)).toThrow(/positive/);
  });

  it("rejects size exceeding per-order cap", () => {
    expect(() => normalizeOrderSize(MAX_POLYMARKET_ORDER_USDC + 1)).toThrow(/cannot exceed/);
  });

  it("rejects non-finite size", () => {
    expect(() => normalizeOrderSize(NaN)).toThrow(/positive/);
    // Infinity is non-finite, so it hits the isFinite guard before the cap guard
    expect(() => normalizeOrderSize(Infinity)).toThrow(/positive/);
  });
});

describe("Polymarket Risk — validatePolymarketOrderRisk price bounds (security fix)", () => {
  it("accepts price at lower boundary", () => {
    const result = validatePolymarketOrderRisk(
      { price: MIN_POLYMARKET_LIMIT_PRICE, size: 10 },
      VALID_LIMITS,
    );
    expect(result.valid).toBe(true);
  });

  it("accepts price at upper boundary", () => {
    const result = validatePolymarketOrderRisk(
      { price: MAX_POLYMARKET_LIMIT_PRICE, size: 10 },
      VALID_LIMITS,
    );
    expect(result.valid).toBe(true);
  });

  it("rejects price below MIN_POLYMARKET_LIMIT_PRICE", () => {
    const result = validatePolymarketOrderRisk(
      { price: 0, size: 10 },
      VALID_LIMITS,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/outside the allowed range/);
  });

  it("rejects price above MAX_POLYMARKET_LIMIT_PRICE", () => {
    const result = validatePolymarketOrderRisk(
      { price: 1.0, size: 10 },
      VALID_LIMITS,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/outside the allowed range/);
  });

  it("rejects price of 1.5 (Kalshi cent-scale confusion guard)", () => {
    // Kalshi raw yes_price=150 would become 1.5 via centsToDollars.
    // For Polymarket, any price >0.99 must be blocked outright.
    const result = validatePolymarketOrderRisk(
      { price: 1.5, size: 10 },
      VALID_LIMITS,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/outside the allowed range/);
  });

  it("rejects NaN price", () => {
    const result = validatePolymarketOrderRisk(
      { price: NaN, size: 10 },
      VALID_LIMITS,
    );
    expect(result.valid).toBe(false);
  });

  it("rejects zero or negative size", () => {
    const result = validatePolymarketOrderRisk(
      { price: 0.5, size: 0 },
      VALID_LIMITS,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/positive/);
  });

  it("rejects size exceeding per-order cap", () => {
    const result = validatePolymarketOrderRisk(
      { price: 0.5, size: 1000 },
      { ...VALID_LIMITS, maxOrderUsdc: 500 },
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/cap/);
  });

  it("rejects size exceeding exposure percent of bankroll", () => {
    // 5% of 1000 = 50 USDC max; 100 USDC exceeds it
    const result = validatePolymarketOrderRisk(
      { price: 0.5, size: 100 },
      { maxOrderUsdc: 500, maxExposurePercent: 0.05, bankroll: 1000 },
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/bankroll/);
  });

  it("accepts a valid mid-range order", () => {
    const result = validatePolymarketOrderRisk(
      { price: 0.55, size: 30 },
      { maxOrderUsdc: 500, maxExposurePercent: 0.05, bankroll: 1000 },
    );
    expect(result.valid).toBe(true);
  });
});

describe("Polymarket Risk — calculatePolymarketBuyOrderRisk", () => {
  it("computes correct exposure and payout for a mid-price buy", () => {
    const risk = calculatePolymarketBuyOrderRisk({ price: 0.5, size: 100 });
    expect(risk.orderExposure).toBe(100);
    expect(risk.maxLossOnTrade).toBe(100);
    expect(risk.maxPayout).toBeCloseTo(200, 5);
    expect(risk.maxProfit).toBeCloseTo(100, 5);
  });

  it("rejects an invalid price", () => {
    expect(() => calculatePolymarketBuyOrderRisk({ price: 0, size: 50 })).toThrow();
    expect(() => calculatePolymarketBuyOrderRisk({ price: 1.0, size: 50 })).toThrow();
  });
});

describe("Polymarket Risk — kellyFraction", () => {
  it("returns 0 for edge-case market prices", () => {
    expect(kellyFraction(0.6, 0)).toBe(0);
    expect(kellyFraction(0.6, 1)).toBe(0);
    expect(kellyFraction(NaN, 0.5)).toBe(0);
    expect(kellyFraction(0.6, NaN)).toBe(0);
  });

  it("returns a positive fraction for a positive-EV bet", () => {
    // trueProb=0.6, marketPrice=0.5 → positive edge
    const f = kellyFraction(0.6, 0.5);
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThanOrEqual(1);
  });

  it("returns 0 for a negative-EV bet", () => {
    // trueProb=0.4, marketPrice=0.6 → negative edge
    const f = kellyFraction(0.4, 0.6);
    expect(f).toBe(0);
  });
});

describe("Polymarket Risk — estimateSizeForRiskBudget", () => {
  it("returns 0 for zero or negative bankroll", () => {
    expect(estimateSizeForRiskBudget(0, 0.6, 0.5)).toBe(0);
    expect(estimateSizeForRiskBudget(-100, 0.6, 0.5)).toBe(0);
  });

  it("returns 0 for negative-EV bet", () => {
    expect(estimateSizeForRiskBudget(1000, 0.4, 0.6)).toBe(0);
  });

  it("caps result at maxOrderUsdc", () => {
    // Very large bankroll should still be capped
    const size = estimateSizeForRiskBudget(100_000, 0.9, 0.1, 500);
    expect(size).toBeLessThanOrEqual(500);
  });

  it("applies the Kelly haircut", () => {
    const halfKelly = estimateSizeForRiskBudget(1000, 0.6, 0.5, 500, 0.5);
    const fullKelly = estimateSizeForRiskBudget(1000, 0.6, 0.5, 500, 1.0);
    expect(halfKelly).toBeLessThan(fullKelly);
  });
});
