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
}

/** Rough per-leg fee estimate (taker fee + gas/settlement buffer) */
const FEE_PER_LEG = 0.005;

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
  } = {},
): CrossPlatformArbitrageOpportunity[] {
  const {
    minSimilarity = 0.35,
    minSpread = 0.03,
    minLiquidity = 100,
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

    const spread = Math.abs(kalshi.yesPrice - pm.yesPrice);
    if (spread < minSpread) continue;

    const netEdge = spread - 2 * FEE_PER_LEG;
    if (netEdge <= 0) continue;

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
        `Gross spread ${(spread * 100).toFixed(1)}pp → net edge ${(netEdge * 100).toFixed(1)}pp after fees. ` +
        `Question similarity ${(match.similarity * 100).toFixed(0)}%.`,
      minLiquidity: Math.min(kalshi.liquidity, pm.liquidity),
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
