/**
 * Portfolio Optimization for Kalshi Markets
 * Implements Kelly Criterion, correlation analysis, and position sizing
 */

export interface Signal {
  marketId: string;
  side: string; // "yes" or "no"
  confidence: number; // 0-1
  expectedValue: number;
}

export interface PortfolioPosition {
  marketId: string;
  side: string;
  size: number;
  expectedReturn: number;
  risk: number;
}

export interface OptimizedPortfolio {
  positions: PortfolioPosition[];
  expectedReturn: number;
  portfolioRisk: number;
  diversificationScore: number;
  kellyFraction: number;
}

/**
 * Kelly Criterion: Optimal position sizing for expected value bets
 * f* = (p * b - q) / b
 * where p = win probability, q = loss probability, b = odds
 */
export function calculateKellyFraction(
  winProbability: number,
  odds: number
): number {
  const lossProbability = 1 - winProbability;
  const kellyFraction = (winProbability * odds - lossProbability) / odds;

  // Fractional Kelly for safety (use 25% of Kelly)
  const fractionalKelly = kellyFraction * 0.25;

  // Clamp between 0 and 1
  return Math.max(0, Math.min(1, fractionalKelly));
}

/**
 * Calculate position size based on Kelly Criterion
 */
export function calculatePositionSize(
  equity: number,
  signal: Signal,
  maxPositionPercent = 0.05 // 5% max per position
): number {
  // Assume 1:1 odds for simplicity (can be enhanced with actual market odds)
  const odds = 1;
  const kellySize = calculateKellyFraction(signal.confidence, odds);

  // Apply max position constraint
  const maxSize = equity * maxPositionPercent;
  const positionSize = equity * kellySize;

  return Math.min(positionSize, maxSize);
}

/**
 * Calculate correlation between two signals
 * Higher correlation = less diversification benefit
 */
export function calculateCorrelation(
  signal1: Signal,
  signal2: Signal
): number {
  // Simplified: signals on same market are highly correlated
  if (signal1.marketId === signal2.marketId) return 1.0;

  // Signals with same side are more correlated
  const sideSimilarity = signal1.side === signal2.side ? 0.5 : 0;

  // Confidence similarity
  const confidenceDiff = Math.abs(signal1.confidence - signal2.confidence);
  const confidenceSimilarity = 1 - confidenceDiff;

  return (sideSimilarity + confidenceSimilarity) / 2;
}

/**
 * Calculate portfolio diversification score
 * Higher = more diversified
 */
export function calculateDiversificationScore(
  signals: Signal[]
): number {
  if (signals.length <= 1) return 1.0;

  let totalCorrelation = 0;
  let correlationCount = 0;

  for (let i = 0; i < signals.length; i++) {
    for (let j = i + 1; j < signals.length; j++) {
      totalCorrelation += calculateCorrelation(signals[i], signals[j]);
      correlationCount++;
    }
  }

  const avgCorrelation = totalCorrelation / correlationCount;
  return 1 - avgCorrelation; // Invert so higher = better
}

/**
 * Filter signals for portfolio based on diversification
 */
export function filterForDiversification(
  signals: Signal[],
  maxCorrelation = 0.7
): Signal[] {
  if (signals.length <= 1) return signals;

  const filtered: Signal[] = [signals[0]]; // Start with highest confidence

  for (let i = 1; i < signals.length; i++) {
    const signal = signals[i];
    let canAdd = true;

    for (const existing of filtered) {
      if (calculateCorrelation(signal, existing) > maxCorrelation) {
        canAdd = false;
        break;
      }
    }

    if (canAdd) {
      filtered.push(signal);
    }
  }

  return filtered;
}

/**
 * Optimize portfolio from signals
 */
export function optimizePortfolio(
  signals: Signal[],
  equity: number,
  maxPositions = 5
): OptimizedPortfolio {
  // Sort by confidence (highest first)
  const sorted = [...signals].sort((a, b) => b.confidence - a.confidence);

  // Filter for diversification
  const diversified = filterForDiversification(sorted);

  // Limit number of positions
  const topSignals = diversified.slice(0, maxPositions);

  // Calculate positions
  const positions: PortfolioPosition[] = topSignals.map((signal) => ({
    marketId: signal.marketId,
    side: signal.side,
    size: calculatePositionSize(equity, signal),
    expectedReturn: signal.expectedValue * signal.confidence,
    risk: (1 - signal.confidence) * 0.1, // Simplified risk
  }));

  // Calculate portfolio metrics
  const totalSize = positions.reduce((sum, p) => sum + p.size, 0);
  const expectedReturn = positions.reduce((sum, p) => sum + p.expectedReturn, 0);
  const portfolioRisk = Math.sqrt(
    positions.reduce((sum, p) => sum + p.risk * p.risk, 0)
  );

  return {
    positions,
    expectedReturn,
    portfolioRisk,
    diversificationScore: calculateDiversificationScore(topSignals),
    kellyFraction: calculateKellyFraction(
      topSignals[0]?.confidence || 0.5,
      1
    ),
  };
}

/**
 * Rebalance portfolio based on new signals
 */
export function rebalancePortfolio(
  currentPositions: PortfolioPosition[],
  newSignals: Signal[],
  equity: number
): OptimizedPortfolio {
  // Close positions not in new signals
  const newMarketIds = new Set(newSignals.map((s) => s.marketId));
  const positionsToClose = currentPositions.filter(
    (p) => !newMarketIds.has(p.marketId)
  );

  // Optimize new portfolio
  return optimizePortfolio(newSignals, equity);
}
