/**
 * Smart Order Router
 * Determines execution strategy for orders based on size and urgency.
 * Pure computation module — no HTTP calls or DB access.
 */

// ── Named constants ───────────────────────────────────────────────────────────

export const MARKET_ORDER_THRESHOLD = 100;       // <$100: use market order
export const LIMIT_ORDER_THRESHOLD = 500;        // $100–500: use limit order
export const TWAP_STRATEGY_THRESHOLD = 500;      // >$500: use TWAP
export const LIMIT_PRICE_IMPROVEMENT = 0.01;     // 1% better than market for limits
export const TWAP_MIN_SLICES = 5;                // minimum slices for TWAP
export const TWAP_MAX_SLICES = 10;               // maximum slices for TWAP
export const TWAP_WINDOW_MINUTES = 15;           // TWAP execution window (minutes)
export const LIMIT_ORDER_TIMEOUT_MINUTES = 5;    // cancel limit after this many minutes
export const ICEBERG_VISIBLE_PCT = 0.20;         // show 20% of order size
export const IMPACT_THRESHOLD_PCT = 0.03;        // impact >3% → reduce order

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrderStrategy = "market" | "limit" | "twap" | "iceberg";

export interface OrderRoutingInput {
  /** Number of contracts to buy. */
  targetQuantityContracts: number;
  /** Maximum budget in USD. */
  targetBudgetUsd: number;
  /** Current best price (0–1). */
  currentMarketPrice: number;
  side: "yes" | "no";
  /** Affects strategy selection. */
  urgency: "high" | "medium" | "low";
}

export interface TwapSlice {
  /** 0-based index of this slice. */
  sliceIndex: number;
  /** Number of contracts for this slice. */
  contracts: number;
  /** Delay from order-creation time in milliseconds. */
  delayMs: number;
  /** Optional limit price for this slice. */
  limitPrice?: number;
}

export interface OrderRoutingDecision {
  strategy: OrderStrategy;
  /** For limit/iceberg orders: the limit price. */
  limitPrice?: number;
  /** For iceberg orders: visible contracts shown. */
  visibleQuantity?: number;
  /** For iceberg orders: hidden reserve contracts. */
  hiddenQuantity?: number;
  /** For TWAP: the slice schedule. */
  twapSlices?: TwapSlice[];
  /** Maximum acceptable slippage (0–1, e.g. 0.02 = 2%). */
  slippageTolerance: number;
  /** Estimated fill price. */
  expectedFillPrice: number;
  /** For limit orders: cancel and re-place after this many ms. */
  timeoutMs?: number;
}

export interface SlippageRecord {
  expectedPrice: number;
  actualPrice: number;
  /** Signed slippage: positive = paid more than expected. */
  slippagePct: number;
  orderId: string;
  executedAt: Date;
}

// ── Strategy selection ────────────────────────────────────────────────────────

/**
 * Choose an order execution strategy based on budget and urgency.
 *
 * Rules (in priority order):
 *  1. urgency === "high"  OR budget < $100  → market
 *  2. budget > $500  AND urgency !== "high" → twap
 *  3. budget >= $100                         → limit
 *  4. Default                                → market
 */
export function selectOrderStrategy(input: OrderRoutingInput): OrderStrategy {
  const { targetBudgetUsd, urgency } = input;

  if (urgency === "high" || targetBudgetUsd < MARKET_ORDER_THRESHOLD) {
    return "market";
  }

  if (targetBudgetUsd > LIMIT_ORDER_THRESHOLD) {
    return "twap";
  }

  if (targetBudgetUsd >= MARKET_ORDER_THRESHOLD) {
    return "limit";
  }

  return "market";
}

// ── Limit order ───────────────────────────────────────────────────────────────

/**
 * Create a limit order decision for medium-sized orders.
 * Places the limit 1% better than the current market price.
 */
export function createLimitOrder(input: OrderRoutingInput): OrderRoutingDecision {
  const { currentMarketPrice, side } = input;

  const rawLimit =
    side === "yes"
      ? currentMarketPrice - LIMIT_PRICE_IMPROVEMENT
      : currentMarketPrice + LIMIT_PRICE_IMPROVEMENT;

  // Clamp to valid price range.
  const limitPrice = Math.max(0.01, Math.min(0.99, rawLimit));

  return {
    strategy: "limit",
    limitPrice,
    slippageTolerance: 0.02,
    expectedFillPrice: limitPrice,
    timeoutMs: LIMIT_ORDER_TIMEOUT_MINUTES * 60 * 1000,
  };
}

// ── TWAP ──────────────────────────────────────────────────────────────────────

/**
 * Build a TWAP execution schedule for large orders.
 * Splits contracts into 5–10 evenly-spaced slices over TWAP_WINDOW_MINUTES.
 */
export function createTwapSchedule(input: OrderRoutingInput): OrderRoutingDecision {
  const { targetQuantityContracts, currentMarketPrice } = input;

  const CONTRACTS_PER_SLICE_TARGET = 50;
  const rawSlices = Math.round(targetQuantityContracts / CONTRACTS_PER_SLICE_TARGET);
  const nSlices = Math.max(TWAP_MIN_SLICES, Math.min(TWAP_MAX_SLICES, rawSlices));

  const baseContracts = Math.floor(targetQuantityContracts / nSlices);
  const remainder = targetQuantityContracts - baseContracts * nSlices;

  // Evenly distribute: last slice absorbs remainder.
  // Guard: if nSlices === 1 the interval is 0; keep as 0 (degenerate but safe).
  const intervalMs =
    nSlices > 1
      ? (TWAP_WINDOW_MINUTES * 60 * 1000) / (nSlices - 1)
      : 0;

  const twapSlices: TwapSlice[] = Array.from({ length: nSlices }, (_, i) => ({
    sliceIndex: i,
    contracts: i === nSlices - 1 ? baseContracts + remainder : baseContracts,
    delayMs: i * intervalMs,
  }));

  return {
    strategy: "twap",
    twapSlices,
    slippageTolerance: 0.03,
    expectedFillPrice: currentMarketPrice,
  };
}

// ── Iceberg order ─────────────────────────────────────────────────────────────

/**
 * Create an iceberg order decision.
 * Shows only ICEBERG_VISIBLE_PCT (20%) of total size to the market.
 */
export function createIcebergOrder(input: OrderRoutingInput): OrderRoutingDecision {
  const { targetQuantityContracts, currentMarketPrice, side } = input;

  const visibleQuantity = Math.max(1, Math.floor(targetQuantityContracts * ICEBERG_VISIBLE_PCT));
  const hiddenQuantity = targetQuantityContracts - visibleQuantity;

  const rawLimit =
    side === "yes"
      ? currentMarketPrice - LIMIT_PRICE_IMPROVEMENT
      : currentMarketPrice + LIMIT_PRICE_IMPROVEMENT;

  const limitPrice = Math.max(0.01, Math.min(0.99, rawLimit));

  return {
    strategy: "iceberg",
    limitPrice,
    visibleQuantity,
    hiddenQuantity,
    slippageTolerance: 0.02,
    expectedFillPrice: limitPrice,
    timeoutMs: LIMIT_ORDER_TIMEOUT_MINUTES * 60 * 1000,
  };
}

// ── Unified router ────────────────────────────────────────────────────────────

/**
 * Route an order to the appropriate execution strategy.
 */
export function routeOrder(input: OrderRoutingInput): OrderRoutingDecision {
  const strategy = selectOrderStrategy(input);

  switch (strategy) {
    case "limit":
      return createLimitOrder(input);
    case "twap":
      return createTwapSchedule(input);
    case "iceberg":
      return createIcebergOrder(input);
    case "market":
    default:
      return {
        strategy: "market",
        slippageTolerance: 0.05,
        expectedFillPrice: input.currentMarketPrice,
      };
  }
}

// ── Slippage helpers ──────────────────────────────────────────────────────────

/**
 * Calculate signed slippage percentage.
 * Positive value means the actual fill was worse (more expensive) than expected.
 */
export function calculateSlippage(expected: number, actual: number): number {
  if (expected === 0) {
    return 0;
  }
  return (actual - expected) / expected;
}

/**
 * Aggregate a set of slippage records into summary statistics.
 */
export function aggregateSlippageStats(records: SlippageRecord[]): {
  avgSlippage: number;
  maxSlippage: number;
  fillRate: number;
} {
  if (records.length === 0) {
    return { avgSlippage: 0, maxSlippage: 0, fillRate: 1 };
  }

  const slippages = records.map((r) => r.slippagePct);
  const avgSlippage = slippages.reduce((sum, s) => sum + s, 0) / slippages.length;
  const maxSlippage = Math.max(...slippages);

  // fillRate is always 1.0 since we only track completed fills.
  return { avgSlippage, maxSlippage, fillRate: 1 };
}
