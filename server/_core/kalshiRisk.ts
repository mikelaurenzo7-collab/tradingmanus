import {
  EV_IMPACT_THRESHOLD,
  SQRT_MODEL_SIGMA_DEFAULT,
  calculateImpactAdjustedSize,
  estimateMarketImpact,
} from "./marketImpactModel";

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

export type MarketImpactGuardrailResult = {
  estimatedMarketImpact: number;
  impactBps: number;
  expectedSlippageUsd: number;
  shouldReduceSize: boolean;
  shouldBlockOrder: boolean;
  recommendedQuantity: number;
  recommendedExposureUsd: number;
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

export function applyMarketImpactGuardrails(input: {
  quantity: number;
  limitPrice: number;
  side: "yes" | "no";
  dailyVolumeUsd: number;
  expectedValue: number;
  dailyVolatility?: number;
}): MarketImpactGuardrailResult {
  const quantity = normalizeOrderQuantity(input.quantity);
  const limitPrice = normalizeLimitPrice(input.limitPrice);
  const orderSizeUsd = quantity * limitPrice;
  const dailyVolatility =
    Number.isFinite(input.dailyVolatility) && (input.dailyVolatility ?? 0) > 0
      ? Number(input.dailyVolatility)
      : SQRT_MODEL_SIGMA_DEFAULT;

  const impact = estimateMarketImpact({
    orderSizeUsd,
    dailyVolumeUsd: Math.max(0, Number(input.dailyVolumeUsd) || 0),
    dailyVolatility,
    currentPrice: limitPrice,
    side: input.side,
  });

  const impactAdjustedSizeUsd = calculateImpactAdjustedSize(orderSizeUsd, impact);
  let recommendedQuantity = Math.max(
    0,
    Math.min(MAX_KALSHI_ORDER_CONTRACTS, Math.floor(impactAdjustedSizeUsd / limitPrice)),
  );

  // If impact consumes too much of expected edge, downsize defensively.
  const evImpactExceeded =
    Number.isFinite(input.expectedValue) &&
    Math.abs(input.expectedValue) > 0 &&
    impact.totalImpact > Math.abs(input.expectedValue) * EV_IMPACT_THRESHOLD;

  // Only apply extra EV-based reduction when impact is already in the
  // reduce-size regime; this avoids shrinking otherwise-acceptable orders.
  if (evImpactExceeded && impact.shouldReduceSize && recommendedQuantity > 0) {
    recommendedQuantity = Math.max(1, Math.floor(recommendedQuantity * 0.5));
  }

  const shouldBlockOrder = impact.shouldBlockOrder || recommendedQuantity < 1;

  return {
    estimatedMarketImpact: impact.totalImpact,
    impactBps: impact.impactBps,
    expectedSlippageUsd: impact.expectedSlippage,
    shouldReduceSize: recommendedQuantity < quantity,
    shouldBlockOrder,
    recommendedQuantity,
    recommendedExposureUsd: recommendedQuantity * limitPrice,
  };
}
