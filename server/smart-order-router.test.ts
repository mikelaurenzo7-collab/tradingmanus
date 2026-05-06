import { describe, it, expect } from "vitest";
import {
  selectOrderStrategy,
  createLimitOrder,
  createTwapSchedule,
  createIcebergOrder,
  routeOrder,
  calculateSlippage,
  aggregateSlippageStats,
  MARKET_ORDER_THRESHOLD,
  LIMIT_ORDER_THRESHOLD,
  TWAP_MIN_SLICES,
  TWAP_MAX_SLICES,
  TWAP_WINDOW_MINUTES,
  LIMIT_PRICE_IMPROVEMENT,
  ICEBERG_VISIBLE_PCT,
  LIMIT_ORDER_TIMEOUT_MINUTES,
  type OrderRoutingInput,
  type SlippageRecord,
} from "./_core/smartOrderRouter";

// ── Shared fixture factories ───────────────────────────────────────────────────

function makeInput(overrides: Partial<OrderRoutingInput> = {}): OrderRoutingInput {
  return {
    targetQuantityContracts: 10,
    targetBudgetUsd: 200,
    currentMarketPrice: 0.50,
    side: "yes",
    urgency: "low",
    ...overrides,
  };
}

// ── selectOrderStrategy ───────────────────────────────────────────────────────

describe("selectOrderStrategy", () => {
  it("returns 'market' when budget is below $100 threshold", () => {
    expect(
      selectOrderStrategy(makeInput({ targetBudgetUsd: MARKET_ORDER_THRESHOLD - 1 })),
    ).toBe("market");
  });

  it("returns 'market' when budget equals $0", () => {
    expect(selectOrderStrategy(makeInput({ targetBudgetUsd: 0 }))).toBe("market");
  });

  it("returns 'limit' when budget is $200, urgency=low", () => {
    expect(
      selectOrderStrategy(makeInput({ targetBudgetUsd: 200, urgency: "low" })),
    ).toBe("limit");
  });

  it("returns 'limit' when budget is $200, urgency=medium", () => {
    expect(
      selectOrderStrategy(makeInput({ targetBudgetUsd: 200, urgency: "medium" })),
    ).toBe("limit");
  });

  it("returns 'twap' when budget exceeds $500 (non-urgent)", () => {
    expect(
      selectOrderStrategy(makeInput({ targetBudgetUsd: LIMIT_ORDER_THRESHOLD + 1, urgency: "low" })),
    ).toBe("twap");
  });

  it("returns 'twap' for large budgets with medium urgency", () => {
    expect(
      selectOrderStrategy(makeInput({ targetBudgetUsd: 1000, urgency: "medium" })),
    ).toBe("twap");
  });

  it("returns 'market' when urgency=high regardless of large budget", () => {
    expect(
      selectOrderStrategy(makeInput({ targetBudgetUsd: 1000, urgency: "high" })),
    ).toBe("market");
  });

  it("returns 'market' when urgency=high with medium budget", () => {
    expect(
      selectOrderStrategy(makeInput({ targetBudgetUsd: 200, urgency: "high" })),
    ).toBe("market");
  });
});

// ── createLimitOrder ──────────────────────────────────────────────────────────

describe("createLimitOrder", () => {
  it("returns strategy='limit'", () => {
    expect(createLimitOrder(makeInput()).strategy).toBe("limit");
  });

  it("places limit price BELOW market for 'yes' side", () => {
    const decision = createLimitOrder(makeInput({ currentMarketPrice: 0.50, side: "yes" }));
    expect(decision.limitPrice).toBeLessThan(0.50);
    expect(decision.limitPrice).toBeCloseTo(0.50 - LIMIT_PRICE_IMPROVEMENT);
  });

  it("places limit price ABOVE market for 'no' side", () => {
    const decision = createLimitOrder(makeInput({ currentMarketPrice: 0.50, side: "no" }));
    expect(decision.limitPrice).toBeGreaterThan(0.50);
    expect(decision.limitPrice).toBeCloseTo(0.50 + LIMIT_PRICE_IMPROVEMENT);
  });

  it("clamps limit price to minimum 0.01 for 'yes' side near zero", () => {
    const decision = createLimitOrder(makeInput({ currentMarketPrice: 0.005, side: "yes" }));
    expect(decision.limitPrice).toBe(0.01);
  });

  it("clamps limit price to maximum 0.99 for 'no' side near one", () => {
    const decision = createLimitOrder(makeInput({ currentMarketPrice: 0.995, side: "no" }));
    expect(decision.limitPrice).toBe(0.99);
  });

  it("sets expectedFillPrice equal to limitPrice", () => {
    const decision = createLimitOrder(makeInput({ currentMarketPrice: 0.60, side: "yes" }));
    expect(decision.expectedFillPrice).toBe(decision.limitPrice);
  });

  it("sets slippageTolerance to 2%", () => {
    expect(createLimitOrder(makeInput()).slippageTolerance).toBeCloseTo(0.02);
  });

  it("sets timeoutMs to LIMIT_ORDER_TIMEOUT_MINUTES converted to ms", () => {
    const expected = LIMIT_ORDER_TIMEOUT_MINUTES * 60 * 1000;
    expect(createLimitOrder(makeInput()).timeoutMs).toBe(expected);
  });
});

// ── createTwapSchedule ────────────────────────────────────────────────────────

describe("createTwapSchedule", () => {
  it("returns strategy='twap'", () => {
    expect(createTwapSchedule(makeInput({ targetQuantityContracts: 300 })).strategy).toBe("twap");
  });

  it("generates between 5 and 10 slices", () => {
    const { twapSlices } = createTwapSchedule(makeInput({ targetQuantityContracts: 300 }));
    expect(twapSlices).toBeDefined();
    expect(twapSlices!.length).toBeGreaterThanOrEqual(TWAP_MIN_SLICES);
    expect(twapSlices!.length).toBeLessThanOrEqual(TWAP_MAX_SLICES);
  });

  it("generates exactly TWAP_MIN_SLICES slices for tiny order", () => {
    const { twapSlices } = createTwapSchedule(makeInput({ targetQuantityContracts: 1 }));
    expect(twapSlices!.length).toBe(TWAP_MIN_SLICES);
  });

  it("generates exactly TWAP_MAX_SLICES slices for very large order", () => {
    const { twapSlices } = createTwapSchedule(makeInput({ targetQuantityContracts: 10_000 }));
    expect(twapSlices!.length).toBe(TWAP_MAX_SLICES);
  });

  it("total contracts across all slices equals targetQuantityContracts", () => {
    const targetQuantityContracts = 237;
    const { twapSlices } = createTwapSchedule(makeInput({ targetQuantityContracts }));
    const total = twapSlices!.reduce((sum, s) => sum + s.contracts, 0);
    expect(total).toBe(targetQuantityContracts);
  });

  it("first slice has delayMs=0", () => {
    const { twapSlices } = createTwapSchedule(makeInput({ targetQuantityContracts: 300 }));
    expect(twapSlices![0].delayMs).toBe(0);
  });

  it("delays are evenly spaced", () => {
    const { twapSlices } = createTwapSchedule(makeInput({ targetQuantityContracts: 300 }));
    const slices = twapSlices!;
    if (slices.length < 2) return; // guard
    const expectedInterval = (TWAP_WINDOW_MINUTES * 60 * 1000) / (slices.length - 1);
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i].delayMs - slices[i - 1].delayMs).toBeCloseTo(expectedInterval);
    }
  });

  it("sets expectedFillPrice to currentMarketPrice", () => {
    const price = 0.72;
    const { expectedFillPrice } = createTwapSchedule(makeInput({ currentMarketPrice: price, targetQuantityContracts: 300 }));
    expect(expectedFillPrice).toBe(price);
  });
});

// ── createIcebergOrder ────────────────────────────────────────────────────────

describe("createIcebergOrder", () => {
  it("returns strategy='iceberg'", () => {
    expect(createIcebergOrder(makeInput({ targetQuantityContracts: 100 })).strategy).toBe("iceberg");
  });

  it("visible quantity is approximately 20% of total", () => {
    const total = 100;
    const { visibleQuantity } = createIcebergOrder(makeInput({ targetQuantityContracts: total }));
    expect(visibleQuantity).toBe(Math.floor(total * ICEBERG_VISIBLE_PCT));
  });

  it("visible + hidden quantities equal total contracts", () => {
    const total = 87;
    const { visibleQuantity, hiddenQuantity } = createIcebergOrder(makeInput({ targetQuantityContracts: total }));
    expect(visibleQuantity! + hiddenQuantity!).toBe(total);
  });

  it("visible quantity is at least 1 for single contract", () => {
    const { visibleQuantity } = createIcebergOrder(makeInput({ targetQuantityContracts: 1 }));
    expect(visibleQuantity).toBe(1);
  });

  it("sets limit price below market for 'yes' side", () => {
    const { limitPrice } = createIcebergOrder(makeInput({ currentMarketPrice: 0.50, side: "yes", targetQuantityContracts: 50 }));
    expect(limitPrice).toBeLessThan(0.50);
  });

  it("sets limit price above market for 'no' side", () => {
    const { limitPrice } = createIcebergOrder(makeInput({ currentMarketPrice: 0.50, side: "no", targetQuantityContracts: 50 }));
    expect(limitPrice).toBeGreaterThan(0.50);
  });
});

// ── routeOrder ────────────────────────────────────────────────────────────────

describe("routeOrder", () => {
  it("routes small budget to market strategy", () => {
    expect(routeOrder(makeInput({ targetBudgetUsd: 50 })).strategy).toBe("market");
  });

  it("routes medium budget (low urgency) to limit strategy", () => {
    expect(routeOrder(makeInput({ targetBudgetUsd: 200, urgency: "low" })).strategy).toBe("limit");
  });

  it("routes large budget (low urgency) to twap strategy", () => {
    expect(routeOrder(makeInput({ targetBudgetUsd: 800, urgency: "low", targetQuantityContracts: 500 })).strategy).toBe("twap");
  });

  it("routes high urgency large budget to market strategy", () => {
    expect(routeOrder(makeInput({ targetBudgetUsd: 800, urgency: "high" })).strategy).toBe("market");
  });

  it("market route has no twapSlices", () => {
    const decision = routeOrder(makeInput({ targetBudgetUsd: 50 }));
    expect(decision.twapSlices).toBeUndefined();
  });

  it("twap route has twapSlices defined", () => {
    const decision = routeOrder(makeInput({ targetBudgetUsd: 800, urgency: "low", targetQuantityContracts: 200 }));
    expect(decision.twapSlices).toBeDefined();
  });
});

// ── calculateSlippage ─────────────────────────────────────────────────────────

describe("calculateSlippage", () => {
  it("returns positive slippage when actual > expected (paid more)", () => {
    expect(calculateSlippage(0.50, 0.51)).toBeCloseTo(0.02);
  });

  it("returns negative slippage when actual < expected (paid less)", () => {
    expect(calculateSlippage(0.50, 0.49)).toBeCloseTo(-0.02);
  });

  it("returns zero slippage when actual === expected", () => {
    expect(calculateSlippage(0.50, 0.50)).toBe(0);
  });

  it("returns zero slippage when expected is zero to avoid division by zero", () => {
    expect(calculateSlippage(0, 0.50)).toBe(0);
  });

  it("correctly computes formula: (actual - expected) / expected", () => {
    const expected = 0.40;
    const actual = 0.44;
    expect(calculateSlippage(expected, actual)).toBeCloseTo((actual - expected) / expected);
  });
});

// ── aggregateSlippageStats ────────────────────────────────────────────────────

describe("aggregateSlippageStats", () => {
  function makeRecord(slippagePct: number): SlippageRecord {
    return {
      expectedPrice: 0.50,
      actualPrice: 0.50 * (1 + slippagePct),
      slippagePct,
      orderId: `order-${Math.random()}`,
      executedAt: new Date(),
    };
  }

  it("returns zeros and fillRate=1 for empty records", () => {
    const stats = aggregateSlippageStats([]);
    expect(stats.avgSlippage).toBe(0);
    expect(stats.maxSlippage).toBe(0);
    expect(stats.fillRate).toBe(1);
  });

  it("computes correct average slippage", () => {
    const records = [makeRecord(0.01), makeRecord(0.03)];
    expect(aggregateSlippageStats(records).avgSlippage).toBeCloseTo(0.02);
  });

  it("computes correct max slippage", () => {
    const records = [makeRecord(0.01), makeRecord(0.05), makeRecord(0.02)];
    expect(aggregateSlippageStats(records).maxSlippage).toBeCloseTo(0.05);
  });

  it("fillRate is always 1.0 for completed fills", () => {
    const records = [makeRecord(0.01), makeRecord(-0.01)];
    expect(aggregateSlippageStats(records).fillRate).toBe(1);
  });

  it("handles single record correctly", () => {
    const records = [makeRecord(0.025)];
    const stats = aggregateSlippageStats(records);
    expect(stats.avgSlippage).toBeCloseTo(0.025);
    expect(stats.maxSlippage).toBeCloseTo(0.025);
  });
});
