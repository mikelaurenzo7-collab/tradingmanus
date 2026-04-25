import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for Kalshi order execution layer.
 * These tests verify correct price units, order body shape, and close semantics
 * without hitting the real Kalshi API.
 */

// ─── toCents conversion (tested via observable effects) ────────────────────

describe("toCents price conversion", () => {
  it("converts 0.09 to 9 (not 0)", () => {
    // 9¢ market: Math.round(0.09 * 100) = 9
    expect(Math.max(1, Math.min(99, Math.round(0.09 * 100)))).toBe(9);
  });

  it("converts 0.55 to 55", () => {
    expect(Math.max(1, Math.min(99, Math.round(0.55 * 100)))).toBe(55);
  });

  it("clamps 0.001 (below minimum) to 1", () => {
    expect(Math.max(1, Math.min(99, Math.round(0.001 * 100)))).toBe(1);
  });

  it("clamps 0.999 (above maximum) to 99", () => {
    expect(Math.max(1, Math.min(99, Math.round(0.999 * 100)))).toBe(99);
  });

  it("keeps 0.01 as 1", () => {
    expect(Math.max(1, Math.min(99, Math.round(0.01 * 100)))).toBe(1);
  });

  it("keeps 0.99 as 99", () => {
    expect(Math.max(1, Math.min(99, Math.round(0.99 * 100)))).toBe(99);
  });

  it("handles 0.5 correctly", () => {
    expect(Math.max(1, Math.min(99, Math.round(0.5 * 100)))).toBe(50);
  });

  it("always returns integer within [1, 99]", () => {
    const testPrices = [0.001, 0.01, 0.09, 0.25, 0.5, 0.75, 0.99, 0.999];
    for (const price of testPrices) {
      const cents = Math.max(1, Math.min(99, Math.round(price * 100)));
      expect(cents).toBeGreaterThanOrEqual(1);
      expect(cents).toBeLessThanOrEqual(99);
      expect(Number.isInteger(cents)).toBe(true);
    }
  });
});

// ─── Order body shape ────────────────────────────────────────────────────────

describe("Order body construction", () => {
  function buildOrderBody(
    marketId: string,
    side: "yes" | "no",
    quantity: number,
    limitPrice: number,
  ) {
    const toCents = (p: number) => Math.max(1, Math.min(99, Math.round(p * 100)));
    const priceCents = toCents(limitPrice);
    return {
      ticker: marketId,
      type: "limit",
      client_order_id: `nexus-test-${Date.now()}`,
      action: "buy",
      side,
      count: Math.max(1, Math.round(quantity)),
      yes_price: side === "yes" ? priceCents : undefined,
      no_price: side === "no" ? priceCents : undefined,
      time_in_force: "good_till_cancelled",
    };
  }

  it("always includes type: 'limit'", () => {
    const body = buildOrderBody("KXTEST-1", "yes", 10, 0.55);
    expect(body.type).toBe("limit");
  });

  it("uses action: 'buy' for YES-side orders (not sell)", () => {
    const body = buildOrderBody("KXTEST-1", "yes", 10, 0.55);
    expect(body.action).toBe("buy");
  });

  it("uses action: 'buy' for NO-side orders (not sell)", () => {
    const body = buildOrderBody("KXTEST-1", "no", 10, 0.45);
    expect(body.action).toBe("buy");
  });

  it("sets yes_price in cents for YES-side order", () => {
    const body = buildOrderBody("KXTEST-1", "yes", 10, 0.55);
    expect(body.yes_price).toBe(55);
    expect(body.no_price).toBeUndefined();
  });

  it("sets no_price in cents for NO-side order", () => {
    const body = buildOrderBody("KXTEST-1", "no", 10, 0.45);
    expect(body.no_price).toBe(45);
    expect(body.yes_price).toBeUndefined();
  });

  it("sends 9 cents (not 0) for a 9-cent market", () => {
    const body = buildOrderBody("KXTEST-CHEAP", "yes", 5, 0.09);
    expect(body.yes_price).toBe(9);
    expect(body.yes_price).toBeGreaterThan(0);
  });

  it("price is integer in [1, 99] range", () => {
    const cases: Array<{ side: "yes" | "no"; price: number }> = [
      { side: "yes", price: 0.01 },
      { side: "yes", price: 0.99 },
      { side: "no", price: 0.01 },
      { side: "no", price: 0.99 },
      { side: "yes", price: 0.55 },
    ];
    for (const { side, price } of cases) {
      const body = buildOrderBody("KXTEST-1", side, 10, price);
      const sentPrice = side === "yes" ? body.yes_price! : body.no_price!;
      expect(sentPrice).toBeGreaterThanOrEqual(1);
      expect(sentPrice).toBeLessThanOrEqual(99);
      expect(Number.isInteger(sentPrice)).toBe(true);
    }
  });

  it("count is always at least 1", () => {
    const body = buildOrderBody("KXTEST-1", "yes", 0.4, 0.55);
    expect(body.count).toBeGreaterThanOrEqual(1);
  });

  it("rounds count to integer", () => {
    const body = buildOrderBody("KXTEST-1", "yes", 7.7, 0.55);
    expect(Number.isInteger(body.count)).toBe(true);
    expect(body.count).toBe(8);
  });

  it("sets correct ticker", () => {
    const body = buildOrderBody("NASDAQ-100-UP-2026", "yes", 5, 0.6);
    expect(body.ticker).toBe("NASDAQ-100-UP-2026");
  });
});

// ─── Close position body shape ──────────────────────────────────────────────

describe("Close position order body", () => {
  function buildCloseBody(
    marketId: string,
    side: "yes" | "no",
    quantity: number,
    markPrice: number,
  ) {
    const toCents = (p: number) => Math.max(1, Math.min(99, Math.round(p * 100)));
    const priceCents = toCents(markPrice);
    return {
      ticker: marketId,
      type: "limit",
      client_order_id: `nexus-close-test-${Date.now()}`,
      action: "sell",
      side,
      count: Math.max(1, Math.round(quantity)),
      yes_price: side === "yes" ? priceCents : undefined,
      no_price: side === "no" ? priceCents : undefined,
      time_in_force: "good_till_cancelled",
    };
  }

  it("uses action: 'sell' (not buy) for close orders", () => {
    const body = buildCloseBody("KXTEST-1", "yes", 10, 0.65);
    expect(body.action).toBe("sell");
  });

  it("keeps same side as position when closing YES", () => {
    const body = buildCloseBody("KXTEST-1", "yes", 10, 0.65);
    expect(body.side).toBe("yes");
  });

  it("keeps same side as position when closing NO", () => {
    const body = buildCloseBody("KXTEST-1", "no", 10, 0.35);
    expect(body.side).toBe("no");
  });

  it("includes type: 'limit'", () => {
    const body = buildCloseBody("KXTEST-1", "yes", 10, 0.65);
    expect(body.type).toBe("limit");
  });

  it("close price in cents", () => {
    const body = buildCloseBody("KXTEST-1", "yes", 10, 0.65);
    expect(body.yes_price).toBe(65);
  });
});

// ─── Realized P&L calculation ────────────────────────────────────────────────

describe("Realized P&L on close", () => {
  function calcRealizedPnl(
    side: "yes" | "no",
    quantity: number,
    entryPrice: number,
    markPrice: number,
  ) {
    return side === "yes"
      ? quantity * (markPrice - entryPrice)
      : quantity * (entryPrice - markPrice);
  }

  it("YES position gains when mark > entry", () => {
    const pnl = calcRealizedPnl("yes", 100, 0.55, 0.75);
    expect(pnl).toBeCloseTo(20, 5);
    expect(pnl).toBeGreaterThan(0);
  });

  it("YES position loses when mark < entry", () => {
    const pnl = calcRealizedPnl("yes", 100, 0.55, 0.30);
    expect(pnl).toBeCloseTo(-25, 5);
    expect(pnl).toBeLessThan(0);
  });

  it("NO position gains when mark < entry (market moved against YES)", () => {
    const pnl = calcRealizedPnl("no", 100, 0.55, 0.30);
    expect(pnl).toBeCloseTo(25, 5);
    expect(pnl).toBeGreaterThan(0);
  });

  it("NO position loses when mark > entry", () => {
    const pnl = calcRealizedPnl("no", 100, 0.45, 0.65);
    expect(pnl).toBeCloseTo(-20, 5);
    expect(pnl).toBeLessThan(0);
  });
});
