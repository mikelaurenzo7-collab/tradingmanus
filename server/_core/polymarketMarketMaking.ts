/**
 * Polymarket Market Making — Automated Liquidity Provision
 *
 * Implements an Avellaneda-Stoikov-inspired two-sided quoting strategy adapted
 * to binary prediction markets (log-odds space).  The bot:
 *
 *   1. Estimates a fair-value probability for each market.
 *   2. Computes a reservation price adjusted for current inventory skew.
 *   3. Posts bid and ask limit prices around the reservation price,
 *      widening the spread when uncertainty (σ) or inventory risk is high.
 *   4. Returns CLOB-ready quote pairs that the caller can submit as GTC orders.
 *
 * Reference: Avellaneda & Stoikov (2008), adapted for 0-1 binary contracts.
 */

export interface MMQuote {
  side: "BUY" | "SELL";
  /** Polymarket token ID (YES or NO) */
  tokenId: string;
  outcome: "yes" | "no";
  /** Limit price in the range [0.02, 0.98] */
  limitPrice: number;
  /** Order size in USDC */
  sizeUsdc: number;
  reasoning: string;
}

export interface MMQuotePair {
  marketId: string;
  question: string;
  fairValue: number;
  reservationPrice: number;
  bid: MMQuote;
  ask: MMQuote;
  halfSpread: number;
  inventorySkew: number;
}

/**
 * Parameters for the market-making quoting engine.
 */
export interface MMParams {
  /**
   * Inventory position in [-1, 1] where:
   *   -1 = fully short YES (max NO inventory)
   *    0 = neutral
   *   +1 = fully long YES (max YES inventory)
   * Drives reservation-price skew to offload excess inventory.
   */
  inventoryRatio: number;

  /** Annualised volatility proxy (log-odds σ). Typical range 0.05–0.40 */
  volatility: number;

  /**
   * Risk-aversion coefficient γ (Avellaneda-Stoikov γ).
   * Higher = wider spreads & more aggressive inventory hedging.
   * Recommended: 0.1 (low) – 0.5 (high).
   */
  gamma: number;

  /** Remaining time to expiry as a fraction of typical contract life [0, 1] */
  timeToExpiry: number;

  /** Order size in USDC per side */
  orderSizeUsdc: number;

  /** Minimum half-spread in probability units (e.g. 0.01 = 1 cent) */
  minHalfSpread: number;

  /** Maximum half-spread (e.g. 0.06 = 6 cents) */
  maxHalfSpread: number;
}

const DEFAULT_PARAMS: MMParams = {
  inventoryRatio: 0,
  volatility: 0.15,
  gamma: 0.2,
  timeToExpiry: 0.5,
  orderSizeUsdc: 20,
  minHalfSpread: 0.01,
  maxHalfSpread: 0.06,
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
}

/**
 * Convert probability to log-odds (logit).
 */
function logit(p: number): number {
  const safe = clamp(p, 0.001, 0.999);
  return Math.log(safe / (1 - safe));
}

/**
 * Convert log-odds back to probability (sigmoid) with numeric stability.
 * Clamps the input to avoid overflow for extreme values.
 */
function sigmoid(x: number): number {
  // Clamp to prevent Math.exp overflow: beyond ±20 the result is ≈ 0 or ≈ 1
  const safe = Math.max(-20, Math.min(20, x));
  return 1 / (1 + Math.exp(-safe));
}

/**
 * Compute the Avellaneda-Stoikov reservation price in probability space.
 *
 * In the original paper: r = s − q * γ * σ² * T
 *   where s = mid price, q = inventory, γ = risk aversion,
 *         σ = volatility, T = time remaining.
 *
 * We work in log-odds space to respect the [0,1] constraint naturally,
 * then convert back to probability.
 */
function computeReservationPrice(
  fairValueProb: number,
  params: MMParams,
): number {
  const midLogit = logit(fairValueProb);
  const adjustment = params.inventoryRatio * params.gamma * params.volatility ** 2 * params.timeToExpiry;
  const reservationLogit = midLogit - adjustment;
  return clamp(sigmoid(reservationLogit), 0.01, 0.99);
}

/**
 * Compute the optimal half-spread in probability units.
 *
 * Avellaneda-Stoikov: spread = γ * σ² * T + (2/γ) * ln(1 + γ/κ)
 * We simplify to: halfSpread = γ * σ² * T + baseSpread
 * where baseSpread accounts for κ (order arrival rate) through the minHalfSpread.
 */
function computeHalfSpread(params: MMParams): number {
  const dynamicComponent = params.gamma * params.volatility ** 2 * params.timeToExpiry;
  const halfSpread = params.minHalfSpread + dynamicComponent;
  return clamp(halfSpread, params.minHalfSpread, params.maxHalfSpread);
}

/**
 * Generate a two-sided quote pair for a single Polymarket binary market.
 *
 * @param market      Market info including token IDs and current price
 * @param fairValue   Estimated fair-value probability for YES
 * @param params      Market-making parameters (spread, sizing, risk aversion)
 */
export function generateMMQuotePair(
  market: {
    marketId: string;
    question: string;
    impliedProbabilityYes: number;
    tokens: Array<{ token_id: string; outcome: string; price: number }>;
  },
  fairValue: number,
  params: Partial<MMParams> = {},
): MMQuotePair | null {
  const p: MMParams = { ...DEFAULT_PARAMS, ...params };
  const fv = clamp(fairValue, 0.02, 0.98);

  const yesToken = market.tokens.find((t) => t.outcome.toLowerCase() === "yes");
  const noToken = market.tokens.find((t) => t.outcome.toLowerCase() === "no");

  if (!yesToken?.token_id || !noToken?.token_id) {
    return null;
  }

  const reservationPrice = computeReservationPrice(fv, p);
  const halfSpread = computeHalfSpread(p);

  // Bid: we want to BUY YES tokens slightly below reservation price
  const bidPrice = clamp(reservationPrice - halfSpread, 0.02, 0.97);
  // Ask: we want to SELL (exit/flip) YES tokens slightly above reservation price
  const askPrice = clamp(reservationPrice + halfSpread, 0.03, 0.98);

  const inventorySkew = p.inventoryRatio;

  return {
    marketId: market.marketId,
    question: market.question,
    fairValue: fv,
    reservationPrice,
    halfSpread,
    inventorySkew,
    bid: {
      side: "BUY",
      tokenId: yesToken.token_id,
      outcome: "yes",
      limitPrice: bidPrice,
      sizeUsdc: p.orderSizeUsdc,
      reasoning: `MM bid: fair value ${(fv * 100).toFixed(1)}%, reservation ${(reservationPrice * 100).toFixed(1)}%, posting BUY YES at ${(bidPrice * 100).toFixed(1)}% (half-spread ${(halfSpread * 100).toFixed(1)}pp, inventory skew ${(inventorySkew * 100).toFixed(0)}%)`,
    },
    ask: {
      side: "SELL",
      tokenId: yesToken.token_id,
      outcome: "yes",
      limitPrice: askPrice,
      sizeUsdc: p.orderSizeUsdc,
      reasoning: `MM ask: fair value ${(fv * 100).toFixed(1)}%, reservation ${(reservationPrice * 100).toFixed(1)}%, posting SELL YES at ${(askPrice * 100).toFixed(1)}% (half-spread ${(halfSpread * 100).toFixed(1)}pp)`,
    },
  };
}

/**
 * Bulk-generate MM quote pairs across a portfolio of markets.
 *
 * @param markets       Array of live Polymarket markets
 * @param fairValues    Map of marketId → fair-value probability
 * @param inventoryMap  Map of marketId → current inventory ratio [-1, 1]
 * @param baseParams    Default MM params (overridden per-market via inventoryMap)
 * @param options       Filtering thresholds
 */
export function generateMMQuotePairs(
  markets: Array<{
    marketId: string;
    question: string;
    impliedProbabilityYes: number;
    liquidity: number;
    active: boolean;
    closed: boolean;
    tokens: Array<{ token_id: string; outcome: string; price: number }>;
  }>,
  fairValues: Map<string, number>,
  inventoryMap: Map<string, number> = new Map(),
  baseParams: Partial<MMParams> = {},
  options: {
    minLiquidity?: number;
    minFairValueDistance?: number;
  } = {},
): MMQuotePair[] {
  const { minLiquidity = 500, minFairValueDistance = 0.02 } = options;
  const results: MMQuotePair[] = [];

  for (const market of markets) {
    if (!market.active || market.closed) continue;
    if (market.liquidity < minLiquidity) continue;

    const fv = fairValues.get(market.marketId);
    if (fv === undefined) continue;

    const p = market.impliedProbabilityYes;
    if (!Number.isFinite(p) || p <= 0.01 || p >= 0.99) continue;
    if (!Number.isFinite(fv) || fv <= 0.01 || fv >= 0.99) continue;

    // Skip markets where fair value is too close to current price — thin edge
    if (Math.abs(fv - p) < minFairValueDistance) continue;

    const inventoryRatio = inventoryMap.get(market.marketId) ?? 0;
    const params = { ...baseParams, inventoryRatio };

    // Widen spreads on uncertain markets (high distance from 0.5)
    const extremity = Math.abs(p - 0.5);
    const volatilityBoost = extremity > 0.35 ? 0.05 : 0;
    if (volatilityBoost > 0) {
      // Apply the boost regardless of whether `params.volatility` was set —
      // the previous gate skipped widening on the common default-params
      // path, exactly the case where the spread should widen the most.
      params.volatility = (params.volatility ?? DEFAULT_PARAMS.volatility) + volatilityBoost;
    }

    const quote = generateMMQuotePair(market, fv, params);
    if (quote) {
      results.push(quote);
    }
  }

  return results;
}

/**
 * Detect YES+NO mispricing: if a market's YES+NO prices sum to < $1 − minMargin,
 * buying both sides locks in a guaranteed risk-free profit at resolution.
 */
export interface YesNoMispricing {
  marketId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  priceSum: number;
  /** Guaranteed profit per $1 invested (before fees) */
  guaranteedProfitPct: number;
  yesTokenId: string;
  noTokenId: string;
}

export function detectYesNoMispricings(
  markets: Array<{
    marketId: string;
    question: string;
    active: boolean;
    closed: boolean;
    tokens: Array<{ token_id: string; outcome: string; price: number }>;
  }>,
  minProfitPct = 0.02,
): YesNoMispricing[] {
  const results: YesNoMispricing[] = [];

  for (const market of markets) {
    if (!market.active || market.closed) continue;

    const yesToken = market.tokens.find((t) => t.outcome.toLowerCase() === "yes");
    const noToken = market.tokens.find((t) => t.outcome.toLowerCase() === "no");

    if (!yesToken?.token_id || !noToken?.token_id) continue;

    const yesPrice = yesToken.price;
    const noPrice = noToken.price;

    if (!Number.isFinite(yesPrice) || !Number.isFinite(noPrice)) continue;
    if (yesPrice <= 0 || noPrice <= 0) continue;

    const priceSum = yesPrice + noPrice;
    // If priceSum < 1, buying both guarantees a $1 payout for < $1 cost
    if (priceSum < 1 - minProfitPct) {
      const guaranteedProfitPct = (1 - priceSum) / priceSum;
      results.push({
        marketId: market.marketId,
        question: market.question,
        yesPrice,
        noPrice,
        priceSum,
        guaranteedProfitPct,
        yesTokenId: yesToken.token_id,
        noTokenId: noToken.token_id,
      });
    }
  }

  return results.sort((a, b) => b.guaranteedProfitPct - a.guaranteedProfitPct);
}
