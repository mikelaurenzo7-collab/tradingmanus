/**
 * Cross-Platform Arbitrage — Kalshi ↔ Polymarket
 *
 * Scans matched events across Kalshi and Polymarket to detect price
 * discrepancies that represent near-risk-free arbitrage opportunities.
 *
 * Matching strategy:
 *   1. Normalise question text (lowercase, strip punctuation).
 *   2. Compute token-overlap similarity between each Kalshi/Polymarket pair.
 *   3. Flag pairs with similarity ≥ threshold and price spread ≥ minEdge.
 *
 * For each matched pair the scanner identifies:
 *   - Which platform has the underpriced side.
 *   - The gross edge (difference in YES prices).
 *   - Recommended legs (buy on cheaper platform, sell on pricier platform).
 */

export interface CrossPlatformCandidate {
  /** Similarity score [0, 1] between question texts */
  similarity: number;
  kalshi: {
    marketId: string;
    title: string;
    category: string;
    yesPrice: number;
    noPrice: number;
    liquidity: number;
  };
  polymarket: {
    marketId: string;
    question: string;
    category: string;
    yesPrice: number;
    noPrice: number;
    liquidity: number;
  };
}

export type CrossPlatformArbitrageType =
  | "buy_kalshi_yes_sell_polymarket_yes"
  | "buy_polymarket_yes_sell_kalshi_yes";

export interface CrossPlatformArbitrageOpportunity {
  type: CrossPlatformArbitrageType;
  kalshiMarketId: string;
  kalshiTitle: string;
  polymarketMarketId: string;
  polymarketQuestion: string;
  /** YES price on Kalshi */
  kalshiYesPrice: number;
  /** YES price on Polymarket */
  polymarketYesPrice: number;
  /** Price spread (absolute difference) before fees */
  spread: number;
  /** Estimated net edge after typical fees (~0.5% per leg) */
  netEdge: number;
  /** Which platform to buy YES on */
  buyPlatform: "kalshi" | "polymarket";
  /** Which platform to sell/short YES on (buy NO) */
  sellPlatform: "kalshi" | "polymarket";
  /** Confidence 0–1 based on similarity + spread */
  confidence: number;
  reasoning: string;
  /** Liquidity bottleneck: minimum of both sides */
  minLiquidity: number;
  /** Combined fee burden used in net-edge calc */
  feeBurden: number;
  /** Estimated slippage + latency risk deducted from spread */
  executionRisk: number;
  /** Hedge ratio [0.5, 1.0] to size second leg under latency risk */
  hedgeRatio: number;
}

/** Platform fee assumptions from the task spec. */
const KALSHI_FEE = 0.03;
const POLYMARKET_FEE = 0.02;
const KALSHI_LATENCY_MS = 500;
const POLYMARKET_LATENCY_MS = 3_000;
const DEFAULT_DAILY_VOLATILITY = 0.10;
const DEFAULT_MIN_NET_EDGE = 0.05;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Latency-risk proxy in probability points.
 * Uses a sqrt-time scaling from a daily volatility estimate.
 */
export function estimateLatencyRisk(
  dailyVolatility: number,
  latencyMs: number,
): number {
  const vol = Number.isFinite(dailyVolatility) && dailyVolatility > 0
    ? dailyVolatility
    : DEFAULT_DAILY_VOLATILITY;
  const dayMs = 24 * 60 * 60 * 1000;
  const scaled = vol * Math.sqrt(Math.max(latencyMs, 0) / dayMs);
  return clamp(scaled, 0, 0.25);
}

/**
 * Dynamic hedge ratio: reduce second-leg size when latency/execution risk is high.
 */
export function calculateDynamicHedgeRatio(input: {
  baseRatio?: number;
  latencyRisk: number;
  slippageRisk: number;
}): number {
  const baseRatio = Number.isFinite(input.baseRatio ?? 1)
    ? Number(input.baseRatio ?? 1)
    : 1;
  const riskPenalty = clamp((input.latencyRisk + input.slippageRisk) * 2, 0, 0.5);
  return clamp(baseRatio - riskPenalty, 0.5, 1);
}

export function assessPartialLegRisk(input: {
  firstLegFilled: number;
  secondLegFilled: number;
  hedgeRatio: number;
}): {
  unhedgedFraction: number;
  action: "hold" | "hedge" | "exit";
} {
  const first = Math.max(0, input.firstLegFilled);
  const second = Math.max(0, input.secondLegFilled);
  if (first <= 0) {
    return { unhedgedFraction: 0, action: "hold" };
  }

  const targetSecond = first * clamp(input.hedgeRatio, 0.5, 1);
  const unhedged = clamp((targetSecond - second) / targetSecond, 0, 1);

  if (unhedged >= 0.6) {
    return { unhedgedFraction: unhedged, action: "exit" };
  }
  if (unhedged >= 0.15) {
    return { unhedgedFraction: unhedged, action: "hedge" };
  }
  return { unhedgedFraction: unhedged, action: "hold" };
}

/**
 * Normalise a question string for comparison:
 *   - Lowercase
 *   - Remove punctuation and parenthetical notes
 *   - Collapse whitespace
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")   // strip parenthetical notes
    .replace(/[^a-z0-9 ]/g, " ") // strip punctuation
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compute word-overlap Jaccard similarity between two strings.
 * Returns a value in [0, 1].
 */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = normalise(a).split(" ").filter(Boolean);
  const wordsB = normalise(b).split(" ").filter(Boolean);
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const word of Array.from(setA)) {
    if (setB.has(word)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

/**
 * Find the best Polymarket market match for a Kalshi market using
 * Jaccard similarity on question text.
 */
function findBestPolymarketMatch(
  kalshiTitle: string,
  polymarkets: Array<{ marketId: string; question: string; category: string }>,
  minSimilarity: number,
): { marketId: string; question: string; category: string; similarity: number } | null {
  let best: { marketId: string; question: string; category: string; similarity: number } | null = null;
  let bestScore = minSimilarity - 0.001;

  for (const pm of polymarkets) {
    const score = jaccardSimilarity(kalshiTitle, pm.question);
    if (score > bestScore) {
      bestScore = score;
      best = { ...pm, similarity: score };
    }
  }

  return best;
}

/**
 * Scan Kalshi and Polymarket markets for cross-platform arbitrage opportunities.
 *
 * @param kalshiMarkets     Open Kalshi markets
 * @param polymarketMarkets Open Polymarket markets
 * @param options           Tuning parameters
 */
export function detectCrossPlatformArbitrage(
  kalshiMarkets: Array<{
    marketId: string;
    title: string;
    category: string;
    yesPrice: number;
    noPrice: number;
    liquidity: number;
  }>,
  polymarketMarkets: Array<{
    marketId: string;
    question: string;
    category: string;
    yesPrice: number;
    noPrice: number;
    liquidity: number;
  }>,
  options: {
    /** Minimum Jaccard similarity to consider a pair matched [0, 1] */
    minSimilarity?: number;
    /** Minimum gross spread to flag as an opportunity */
    minSpread?: number;
    /** Minimum liquidity (in respective platform units) on each side */
    minLiquidity?: number;
    /** Minimum net edge after fees+execution risk to consider actionable */
    minNetEdge?: number;
  } = {},
): CrossPlatformArbitrageOpportunity[] {
  const {
    minSimilarity = 0.35,
    minSpread = 0.03,
    minLiquidity = 100,
    minNetEdge = DEFAULT_MIN_NET_EDGE,
  } = options;

  const opportunities: CrossPlatformArbitrageOpportunity[] = [];

  for (const kalshi of kalshiMarkets) {
    if (!Number.isFinite(kalshi.yesPrice) || kalshi.yesPrice <= 0) continue;
    if (kalshi.liquidity < minLiquidity) continue;

    const match = findBestPolymarketMatch(
      kalshi.title,
      polymarketMarkets,
      minSimilarity,
    );
    if (!match) continue;

    const pm = polymarketMarkets.find((m) => m.marketId === match.marketId);
    if (!pm) continue;
    if (!Number.isFinite(pm.yesPrice) || pm.yesPrice <= 0) continue;
    if (pm.liquidity < minLiquidity) continue;

    // The actual cross-platform arb is: buy YES on the cheaper venue +
    // buy NO on the more expensive venue.  Since one side resolves YES
    // and the other NO, total payout = $1.  Gross profit = 1 - cheapYes
    // - expensiveNo.  We gate on grossEdge directly, NOT on the YES-only
    // diff |yesA - yesB| — those are only equal when noPrice = 1 - yesPrice
    // (no quote spread), and the YES-diff prefilter would skip legitimate
    // hedges where YES quotes are close but the NO quote on the expensive
    // venue is cheap (e.g. Kalshi YES 0.50, Polymarket YES 0.52, Polymarket
    // NO 0.40 → 10pp grossEdge but only 2pp YES diff).
    const spread = Math.abs(kalshi.yesPrice - pm.yesPrice);
    const buyVenueCheaperYes = kalshi.yesPrice < pm.yesPrice;
    const cheapYesPrice = buyVenueCheaperYes ? kalshi.yesPrice : pm.yesPrice;
    const expensiveNoPrice = buyVenueCheaperYes ? pm.noPrice : kalshi.noPrice;
    if (
      !Number.isFinite(expensiveNoPrice) ||
      expensiveNoPrice <= 0 ||
      expensiveNoPrice >= 1
    ) {
      continue;
    }
    const grossEdge = 1 - cheapYesPrice - expensiveNoPrice;
    if (grossEdge < minSpread) continue;

    const feeBurden = KALSHI_FEE + POLYMARKET_FEE;
    const kalshiLatencyRisk = estimateLatencyRisk(DEFAULT_DAILY_VOLATILITY, KALSHI_LATENCY_MS);
    const polymarketLatencyRisk = estimateLatencyRisk(DEFAULT_DAILY_VOLATILITY, POLYMARKET_LATENCY_MS);
    const latencyRisk = kalshiLatencyRisk + polymarketLatencyRisk;
    const slippageRisk = clamp(0.5 / Math.max(Math.min(kalshi.liquidity, pm.liquidity), 1), 0, 0.02);
    const executionRisk = latencyRisk + slippageRisk;
    const netEdge = grossEdge - feeBurden - executionRisk;
    if (netEdge <= minNetEdge) continue;

    const buyPlatform: "kalshi" | "polymarket" = kalshi.yesPrice < pm.yesPrice ? "kalshi" : "polymarket";
    const sellPlatform: "kalshi" | "polymarket" = buyPlatform === "kalshi" ? "polymarket" : "kalshi";

    const type: CrossPlatformArbitrageType =
      buyPlatform === "kalshi"
        ? "buy_kalshi_yes_sell_polymarket_yes"
        : "buy_polymarket_yes_sell_kalshi_yes";

    const confidence = Math.min(
      0.95,
      match.similarity * 0.5 + Math.min(spread / 0.15, 1) * 0.35 + (netEdge > 0.02 ? 0.1 : 0),
    );

    const buyPrice = buyPlatform === "kalshi" ? kalshi.yesPrice : pm.yesPrice;
    const sellPrice = sellPlatform === "kalshi" ? kalshi.yesPrice : pm.yesPrice;

    const hedgeRatio = calculateDynamicHedgeRatio({
      baseRatio: 1,
      latencyRisk,
      slippageRisk,
    });

    opportunities.push({
      type,
      kalshiMarketId: kalshi.marketId,
      kalshiTitle: kalshi.title,
      polymarketMarketId: pm.marketId,
      polymarketQuestion: pm.question,
      kalshiYesPrice: kalshi.yesPrice,
      polymarketYesPrice: pm.yesPrice,
      spread,
      netEdge,
      buyPlatform,
      sellPlatform,
      confidence,
      reasoning:
        `Cross-platform arb: ${buyPlatform.toUpperCase()} YES at ${(buyPrice * 100).toFixed(1)}¢ vs ` +
        `${sellPlatform.toUpperCase()} YES at ${(sellPrice * 100).toFixed(1)}¢. ` +
        // Distinguish YES-price spread (informational) from gross hedge edge
        // (the actual buy-cheap-YES + buy-expensive-NO economics) so the
        // operator can sanity-check both numbers from the audit log.
        `YES spread ${(spread * 100).toFixed(1)}pp · gross edge ${(grossEdge * 100).toFixed(1)}pp ` +
        `→ net edge ${(netEdge * 100).toFixed(1)}pp after fees. ` +
        `Question similarity ${(match.similarity * 100).toFixed(0)}%.`,
      minLiquidity: Math.min(kalshi.liquidity, pm.liquidity),
      feeBurden,
      executionRisk,
      hedgeRatio,
    });
  }

  // Sort by net edge descending
  return opportunities.sort((a, b) => b.netEdge - a.netEdge);
}

/**
 * Quick summary for display / logging.
 */
export function summariseCrossPlatformOpportunities(
  opportunities: CrossPlatformArbitrageOpportunity[],
): {
  total: number;
  topNetEdge: number;
  avgConfidence: number;
  byType: Record<CrossPlatformArbitrageType, number>;
} {
  const byType: Record<CrossPlatformArbitrageType, number> = {
    buy_kalshi_yes_sell_polymarket_yes: 0,
    buy_polymarket_yes_sell_kalshi_yes: 0,
  };

  let totalNetEdge = 0;
  let totalConfidence = 0;

  for (const opp of opportunities) {
    byType[opp.type]++;
    totalNetEdge += opp.netEdge;
    totalConfidence += opp.confidence;
  }

  return {
    total: opportunities.length,
    topNetEdge: opportunities[0]?.netEdge ?? 0,
    avgConfidence: opportunities.length > 0 ? totalConfidence / opportunities.length : 0,
    byType,
  };
}
