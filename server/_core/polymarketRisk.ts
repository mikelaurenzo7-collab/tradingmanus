/**
 * Polymarket Risk Management
 *
 * Risk sizing, position limits, and order validation for Polymarket CLOB trades.
 * Mirrors the patterns in kalshiRisk.ts but adapted to Polymarket's token-based
 * binary contracts where exposure = price × size (in USDC).
 */

export const MIN_POLYMARKET_LIMIT_PRICE = 0.01;
export const MAX_POLYMARKET_LIMIT_PRICE = 0.99;
/** Maximum single-order notional in USDC */
export const MAX_POLYMARKET_ORDER_USDC = 500;

export type PolymarketOrderRisk = {
  price: number;
  size: number;
  /** Total USDC committed (price × size) */
  orderExposure: number;
  /** Worst-case loss = full outlay if the outcome resolves against you */
  maxLossOnTrade: number;
  /** Maximum payout if the outcome resolves in your favour */
  maxPayout: number;
  /** Net profit on a winning trade */
  maxProfit: number;
};

export function normalizeLimitPrice(value: number, fieldName = "limitPrice") {
  const price = Number(value);
  if (
    !Number.isFinite(price) ||
    price < MIN_POLYMARKET_LIMIT_PRICE ||
    price > MAX_POLYMARKET_LIMIT_PRICE
  ) {
    throw new Error(
      `${fieldName} must be a finite price between ${MIN_POLYMARKET_LIMIT_PRICE.toFixed(2)} and ${MAX_POLYMARKET_LIMIT_PRICE.toFixed(2)}`,
    );
  }
  return price;
}

export function normalizeOrderSize(value: number, maxNotional = MAX_POLYMARKET_ORDER_USDC) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("size must be a positive number (USDC)");
  }
  if (size > maxNotional) {
    throw new Error(`size cannot exceed ${maxNotional} USDC per order`);
  }
  return size;
}

/**
 * Calculate risk metrics for a Polymarket buy order.
 *
 * Buying a YES token at price p for `size` USDC:
 *   - exposure = size  (USDC paid)
 *   - maxLoss  = size  (lose everything if wrong)
 *   - maxPayout = size / p  (receive $1 per token × qty)
 *   - maxProfit = maxPayout − size
 */
export function calculatePolymarketBuyOrderRisk(input: {
  price: number;
  size: number;
}): PolymarketOrderRisk {
  const price = normalizeLimitPrice(input.price);
  const size = normalizeOrderSize(input.size);

  const tokensAcquired = size / price;
  const maxPayout = tokensAcquired; // $1 per token on win

  return {
    price,
    size,
    orderExposure: size,
    maxLossOnTrade: size,
    maxPayout,
    maxProfit: maxPayout - size,
  };
}

/**
 * Kelly-fraction estimate for a binary bet.
 *
 * f* = (b·p − q) / b
 *   where b = net odds (payout per $1 wagered − 1),
 *         p = estimated true probability of winning,
 *         q = 1 − p.
 *
 * Returns a fraction of bankroll (0–1). Caller should apply a haircut
 * (e.g. half-Kelly) and cap at a portfolio-level maximum.
 */
export function kellyFraction(
  trueProb: number,
  marketPrice: number,
): number {
  if (
    !Number.isFinite(trueProb) ||
    !Number.isFinite(marketPrice) ||
    marketPrice <= 0 ||
    marketPrice >= 1
  ) {
    return 0;
  }

  const payoutPerDollar = (1 - marketPrice) / marketPrice; // net odds
  const q = 1 - trueProb;
  const f = (payoutPerDollar * trueProb - q) / payoutPerDollar;
  return Math.max(0, Math.min(1, f));
}

/**
 * Estimate order size in USDC using half-Kelly sizing with a hard cap.
 *
 * @param bankroll      Available capital in USDC
 * @param trueProb      Fair-value probability estimate (0–1)
 * @param marketPrice   Current limit price (0–1)
 * @param maxOrderUsdc  Hard per-order cap (default MAX_POLYMARKET_ORDER_USDC)
 * @param kellyHaircut  Fraction of full Kelly to use (default 0.5)
 */
export function estimateSizeForRiskBudget(
  bankroll: number,
  trueProb: number,
  marketPrice: number,
  maxOrderUsdc = MAX_POLYMARKET_ORDER_USDC,
  kellyHaircut = 0.5,
): number {
  const bank = Number(bankroll);
  if (!Number.isFinite(bank) || bank <= 0) return 0;

  const f = kellyFraction(trueProb, marketPrice) * kellyHaircut;
  const rawSize = bank * f;
  const clampedSize = Math.min(rawSize, maxOrderUsdc);
  return Math.max(0, Math.floor(clampedSize * 100) / 100); // round to 2dp
}

/**
 * Validate that a Polymarket order is within portfolio risk limits.
 */
export function validatePolymarketOrderRisk(
  order: { price: number; size: number },
  limits: {
    maxOrderUsdc: number;
    maxExposurePercent: number; // e.g. 0.05 = 5 % of bankroll
    bankroll: number;
  },
): { valid: boolean; reason?: string } {
  const { price, size } = order;
  const { maxOrderUsdc, maxExposurePercent, bankroll } = limits;

  if (!Number.isFinite(price) || price < MIN_POLYMARKET_LIMIT_PRICE || price > MAX_POLYMARKET_LIMIT_PRICE) {
    return { valid: false, reason: `limit price ${price} is outside the allowed range` };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { valid: false, reason: "order size must be positive" };
  }
  if (size > maxOrderUsdc) {
    return { valid: false, reason: `order size ${size.toFixed(2)} USDC exceeds per-order cap of ${maxOrderUsdc} USDC` };
  }

  const maxAllowed = bankroll * maxExposurePercent;
  if (size > maxAllowed) {
    return {
      valid: false,
      reason: `order size ${size.toFixed(2)} USDC exceeds ${(maxExposurePercent * 100).toFixed(0)}% of bankroll (${maxAllowed.toFixed(2)} USDC)`,
    };
  }

  return { valid: true };
}
