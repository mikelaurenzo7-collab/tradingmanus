/**
 * Phase 5: Arbitrage Signal Detection
 * Identifies arbitrage opportunities in Kalshi markets
 */

export interface ArbitrageOpportunity {
  marketId: string;
  type: "mispricing" | "cross_market" | "order_book";
  side: "yes" | "no";
  expectedProfit: number;
  profitMargin: number; // percentage
  confidence: number; // 0-1
  reasoning: string;
}

/**
 * Detect mispricing arbitrage
 * When market price diverges significantly from implied probability
 */
export function detectMispricingArbitrage(
  marketId: string,
  yesPrice: number,
  noPrice: number,
  impliedProbability: number,
  minMargin: number = 0.05 // 5% minimum margin
): ArbitrageOpportunity | null {
  // Yes and no prices should sum to ~1.0
  const priceSum = yesPrice + noPrice;
  
  if (Math.abs(priceSum - 1.0) < 0.01) {
    // Prices are properly calibrated
    return null;
  }

  // If sum < 1.0, both sides are underpriced (arbitrage opportunity)
  if (priceSum < 1.0 - minMargin) {
    const margin = 1.0 - priceSum;
    return {
      marketId,
      type: "mispricing",
      side: "yes", // Buy both sides
      expectedProfit: margin,
      profitMargin: (margin / priceSum) * 100,
      confidence: Math.min(0.9, margin * 10), // Higher margin = higher confidence
      reasoning: `Both sides underpriced. Sum: ${priceSum.toFixed(3)} (margin: ${(margin * 100).toFixed(1)}%)`,
    };
  }

  // If sum > 1.0, both sides are overpriced (avoid)
  if (priceSum > 1.0 + minMargin) {
    return null; // Not an opportunity, risk of loss
  }

  // Check if one side is significantly mispriced vs implied probability
  const yesMisprice = Math.abs(yesPrice - impliedProbability);
  const noMisprice = Math.abs(noPrice - (1 - impliedProbability));

  if (yesMisprice > minMargin && yesPrice < impliedProbability) {
    // Yes is underpriced relative to implied probability
    return {
      marketId,
      type: "mispricing",
      side: "yes",
      expectedProfit: impliedProbability - yesPrice,
      profitMargin: ((impliedProbability - yesPrice) / yesPrice) * 100,
      confidence: Math.min(0.85, yesMisprice),
      reasoning: `Yes underpriced vs implied probability. Yes: ${yesPrice.toFixed(3)}, Implied: ${impliedProbability.toFixed(3)}`,
    };
  }

  if (noMisprice > minMargin && noPrice < (1 - impliedProbability)) {
    // No is underpriced relative to implied probability
    return {
      marketId,
      type: "mispricing",
      side: "no",
      expectedProfit: (1 - impliedProbability) - noPrice,
      profitMargin: (((1 - impliedProbability) - noPrice) / noPrice) * 100,
      confidence: Math.min(0.85, noMisprice),
      reasoning: `No underpriced vs implied probability. No: ${noPrice.toFixed(3)}, Implied: ${(1 - impliedProbability).toFixed(3)}`,
    };
  }

  return null;
}

/**
 * Detect order book arbitrage
 * When bid-ask spread is unusually wide
 */
export function detectOrderBookArbitrage(
  marketId: string,
  bidPrice: number,
  askPrice: number,
  minSpread: number = 0.02 // 2% minimum spread
): ArbitrageOpportunity | null {
  const spread = askPrice - bidPrice;
  const spreadPercent = (spread / bidPrice) * 100;

  if (spreadPercent > minSpread * 100) {
    return {
      marketId,
      type: "order_book",
      side: "yes", // Buy at bid, sell at ask
      expectedProfit: spread,
      profitMargin: spreadPercent,
      confidence: Math.min(0.8, spreadPercent / 10),
      reasoning: `Wide bid-ask spread: ${(spreadPercent).toFixed(2)}% (bid: ${bidPrice.toFixed(3)}, ask: ${askPrice.toFixed(3)})`,
    };
  }

  return null;
}

/**
 * Detect statistical arbitrage
 * When market is moving away from historical mean
 */
export function detectStatisticalArbitrage(
  marketId: string,
  currentPrice: number,
  historicalMean: number,
  historicalStdDev: number,
  minZScore: number = 2.0 // 2 standard deviations
): ArbitrageOpportunity | null {
  if (historicalStdDev === 0) {
    return null;
  }

  const zScore = Math.abs((currentPrice - historicalMean) / historicalStdDev);

  if (zScore > minZScore) {
    const side = currentPrice > historicalMean ? "no" : "yes";
    const expectedReversion = Math.abs(currentPrice - historicalMean);

    return {
      marketId,
      type: "mispricing",
      side,
      expectedProfit: expectedReversion,
      profitMargin: (expectedReversion / currentPrice) * 100,
      confidence: Math.min(0.9, zScore / 3),
      reasoning: `Statistical mean reversion. Z-score: ${zScore.toFixed(2)}, Current: ${currentPrice.toFixed(3)}, Mean: ${historicalMean.toFixed(3)}`,
    };
  }

  return null;
}

/**
 * Rank arbitrage opportunities by profitability and confidence
 */
export function rankArbitrageOpportunities(opportunities: ArbitrageOpportunity[]): ArbitrageOpportunity[] {
  return opportunities.sort((a, b) => {
    // Score = profit margin * confidence
    const scoreA = a.profitMargin * a.confidence;
    const scoreB = b.profitMargin * b.confidence;
    return scoreB - scoreA;
  });
}

/**
 * Filter arbitrage opportunities by minimum profitability
 */
export function filterArbitrageOpportunities(
  opportunities: ArbitrageOpportunity[],
  minProfitMargin: number = 1.0, // 1% minimum
  minConfidence: number = 0.5
): ArbitrageOpportunity[] {
  return opportunities.filter(
    (opp) => opp.profitMargin >= minProfitMargin && opp.confidence >= minConfidence
  );
}
