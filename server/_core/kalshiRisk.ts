export const MIN_KALSHI_LIMIT_PRICE = 0.01;
export const MAX_KALSHI_LIMIT_PRICE = 0.99;
export const MAX_KALSHI_ORDER_CONTRACTS = 250;

export type KalshiOrderRisk = {
  quantity: number;
  limitPrice: number;
  orderExposure: number;
  maxLossOnTrade: number;
  maxPayout: number;
  maxProfit: number;
};

export function normalizeLimitPrice(value: number, fieldName = "limitPrice") {
  const price = Number(value);
  if (
    !Number.isFinite(price) ||
    price < MIN_KALSHI_LIMIT_PRICE ||
    price > MAX_KALSHI_LIMIT_PRICE
  ) {
    throw new Error(
      `${fieldName} must be a finite dollar price between ${MIN_KALSHI_LIMIT_PRICE.toFixed(2)} and ${MAX_KALSHI_LIMIT_PRICE.toFixed(2)}`
    );
  }

  return price;
}

export function normalizeOrderQuantity(
  value: number,
  maxContracts = MAX_KALSHI_ORDER_CONTRACTS,
) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw new Error("quantity must be at least 1 contract");
  }

  const rounded = Math.round(quantity);
  if (rounded > maxContracts) {
    throw new Error(`quantity cannot exceed ${maxContracts} contracts per order`);
  }

  return rounded;
}

/**
 * Kalshi buy orders risk only the selected side's limit price per contract.
 * A YES bought at $0.40 risks $0.40, not $0.60. A NO bought at $0.60 risks $0.60.
 */
export function calculateKalshiBuyOrderRisk(input: {
  quantity: number;
  limitPrice: number;
}): KalshiOrderRisk {
  const quantity = normalizeOrderQuantity(input.quantity);
  const limitPrice = normalizeLimitPrice(input.limitPrice);
  const orderExposure = quantity * limitPrice;

  return {
    quantity,
    limitPrice,
    orderExposure,
    maxLossOnTrade: orderExposure,
    maxPayout: quantity,
    maxProfit: quantity * (1 - limitPrice),
  };
}

export function estimateContractsForRiskBudget(
  maxBudget: number,
  limitPrice: number,
  maxContracts = MAX_KALSHI_ORDER_CONTRACTS,
) {
  const budget = Number(maxBudget);
  if (!Number.isFinite(budget) || budget <= 0) {
    return 0;
  }

  const price = normalizeLimitPrice(limitPrice);
  return Math.max(0, Math.min(maxContracts, Math.floor(budget / price)));
}
