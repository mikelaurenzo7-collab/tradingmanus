// Market Impact Model — square-root model for estimating price impact of orders

const SQRT_MODEL_SIGMA_DEFAULT = 0.10;   // default daily volatility (10%)
const TEMP_IMPACT_FRACTION = 1.0;        // temporary impact multiplier
const PERM_IMPACT_FRACTION = 0.50;       // permanent = 50% of temporary
const IMPACT_REDUCTION_THRESHOLD = 0.03; // >3% impact → reduce size
const IMPACT_HARD_BLOCK_THRESHOLD = 0.10; // >10% impact → block order
const SIZE_REDUCTION_FACTOR = 0.50;      // halve size when impact > threshold
const EV_IMPACT_THRESHOLD = 0.05;        // reduce size if impact > 5% of EV
const MIN_BOOK_LEVELS = 5;               // simulated book depth levels
const PRICE_LEVEL_STEP = 0.01;           // 1 cent per book level

export interface MarketImpactInput {
  orderSizeUsd: number;       // size of order in USD
  dailyVolumeUsd: number;     // 24h volume
  dailyVolatility: number;    // sigma (0.10 = 10%)
  currentPrice: number;       // current market price 0-1
  side: "yes" | "no";
}

export interface MarketImpactResult {
  temporaryImpact: number;    // immediate price move (fraction of price)
  permanentImpact: number;    // lasting price move (fraction of price)
  totalImpact: number;        // temporaryImpact + permanentImpact
  impactBps: number;          // total impact in basis points (×10000)
  expectedSlippage: number;   // USD cost of market impact
  shouldReduceSize: boolean;  // impact >3%
  shouldBlockOrder: boolean;  // impact >10%
  recommendedSize: number;    // adjusted order size considering impact
}

export function estimateMarketImpact(input: MarketImpactInput): MarketImpactResult {
  const { orderSizeUsd, dailyVolumeUsd, dailyVolatility } = input;

  if (dailyVolumeUsd <= 0) {
    return {
      temporaryImpact: 0,
      permanentImpact: 0,
      totalImpact: 0,
      impactBps: 0,
      expectedSlippage: 0,
      shouldReduceSize: false,
      shouldBlockOrder: false,
      recommendedSize: orderSizeUsd,
    };
  }

  const orderFraction = orderSizeUsd / Math.max(dailyVolumeUsd, 1);
  const temporaryImpact = dailyVolatility * TEMP_IMPACT_FRACTION * Math.sqrt(orderFraction);
  const permanentImpact = temporaryImpact * PERM_IMPACT_FRACTION;
  const rawTotal = temporaryImpact + permanentImpact;
  const totalImpact = Math.min(Math.max(rawTotal, 0), 1);

  const impactBps = totalImpact * 10000;
  const expectedSlippage = orderSizeUsd * totalImpact;
  const shouldReduceSize = totalImpact > IMPACT_REDUCTION_THRESHOLD;
  const shouldBlockOrder = totalImpact > IMPACT_HARD_BLOCK_THRESHOLD;
  const recommendedSize = shouldBlockOrder
    ? 0
    : shouldReduceSize
    ? orderSizeUsd * SIZE_REDUCTION_FACTOR
    : orderSizeUsd;

  return {
    temporaryImpact,
    permanentImpact,
    totalImpact,
    impactBps,
    expectedSlippage,
    shouldReduceSize,
    shouldBlockOrder,
    recommendedSize,
  };
}

export interface OrderBookLevel {
  price: number;     // price level
  quantity: number;  // available contracts at this level
}

export interface BookFillSimulation {
  avgFillPrice: number;    // weighted average fill price
  totalContracts: number;  // contracts actually filled (may be less if book too thin)
  slippage: number;        // avgFillPrice - bestPrice
  filledFraction: number;  // filled / requested (0-1)
}

export function simulateOrderBookFill(
  targetContracts: number,
  currentPrice: number,
  side: "yes" | "no",
  dailyVolume: number,
): BookFillSimulation {
  // Build synthetic book from daily volume
  // For "yes" (buying), ask levels are above current price
  // For "no" (buying no = selling yes), ask levels are below current price
  const levelFractions = [0.10, 0.08, 0.06, 0.04, 0.02];
  const levels: OrderBookLevel[] = [];

  for (let i = 0; i < MIN_BOOK_LEVELS; i++) {
    const priceOffset = i * PRICE_LEVEL_STEP;
    const levelPrice =
      side === "yes"
        ? Math.min(currentPrice + priceOffset, 1)
        : Math.max(currentPrice - priceOffset, 0);
    levels.push({
      price: levelPrice,
      quantity: dailyVolume * levelFractions[i],
    });
  }

  const bestPrice = levels[0].price;
  let remaining = targetContracts;
  let totalCost = 0;
  let totalFilled = 0;

  for (const level of levels) {
    if (remaining <= 0) break;
    const fillQty = Math.min(remaining, level.quantity);
    totalCost += fillQty * level.price;
    totalFilled += fillQty;
    remaining -= fillQty;
  }

  const avgFillPrice = totalFilled > 0 ? totalCost / totalFilled : currentPrice;
  const slippage = side === "yes" ? avgFillPrice - bestPrice : bestPrice - avgFillPrice;
  const filledFraction = targetContracts > 0 ? Math.min(totalFilled / targetContracts, 1) : 0;

  return {
    avgFillPrice,
    totalContracts: totalFilled,
    slippage,
    filledFraction,
  };
}

export function calculateImpactAdjustedSize(
  originalSizeUsd: number,
  impact: MarketImpactResult,
): number {
  if (impact.shouldBlockOrder) return 0;
  if (impact.shouldReduceSize) return Math.min(originalSizeUsd, impact.recommendedSize);
  return originalSizeUsd;
}

export { SQRT_MODEL_SIGMA_DEFAULT, EV_IMPACT_THRESHOLD };
