/**
 * Kalshi Signal Generation Framework
 * Generates trading signals based on market analysis and scoring
 */

import { KalshiMarket, calculateExpectedValue, detectValueOpportunity, detectMomentumOpportunity, detectContrarianOpportunity } from "./kalshiMarketData";
import { MarketFeed, calculatePriceMomentum, calculateVolumeMomentum, detectVolatility } from "./kalshiMarketFeed";
import { detectMispricingArbitrage } from "./kalshiArbitrage";
import * as db from "../db";

export type SignalType = "value_play" | "momentum" | "contrarian" | "arbitrage" | "sentiment";

export interface KalshiSignal {
  marketId: string;
  signalType: SignalType;
  side: "yes" | "no";
  confidence: number; // 0-1
  reasoning: string;
  impliedProbability: number;
  marketPrice: number;
  expectedValue: number;
  metadata?: {
    priceMomentum?: number;
    volumeMomentum?: number;
    volatility?: number;
    fundamentalProbability?: number;
  };
}

/**
 * Generate signals for a market
 * Combines multiple signal types and scores them
 */
export async function generateSignalsForMarket(
  market: KalshiMarket,
  feed?: MarketFeed,
  fundamentalProbability?: number
): Promise<KalshiSignal[]> {
  const signals: KalshiSignal[] = [];

  // Value play: detect mispriced markets
  const valueOpportunity = detectValueOpportunity(market, fundamentalProbability ?? 0.5, 0.05);
  if (valueOpportunity) {
    const confidence = Math.min(0.95, Math.abs(fundamentalProbability! - market.impliedProbability) * 2);
    signals.push({
      marketId: market.id,
      signalType: "value_play",
      side: valueOpportunity.side,
      confidence,
      reasoning: `Market mispriced: ${valueOpportunity.side.toUpperCase()} probability ${(market.impliedProbability * 100).toFixed(1)}% vs fundamental ${(fundamentalProbability! * 100).toFixed(1)}%`,
      impliedProbability: market.impliedProbability,
      marketPrice: valueOpportunity.side === "yes" ? market.yesPrice : market.noPrice,
      expectedValue: valueOpportunity.expectedValue,
      metadata: {
        fundamentalProbability,
      },
    });
  }

  // Momentum: detect strong directional moves
  if (feed) {
    const { yesMomentum, noMomentum } = calculatePriceMomentum(feed, 60000); // 1-minute window
    const { yesVolumeMomentum, noVolumeMomentum } = calculateVolumeMomentum(feed, 60000);
    const volatility = detectVolatility(feed, 300000); // 5-minute window

    const momentumThreshold = 0.01; // 1% price move
    if (Math.abs(yesMomentum) > momentumThreshold || Math.abs(noMomentum) > momentumThreshold) {
      const side = Math.abs(yesMomentum) > Math.abs(noMomentum) ? (yesMomentum > 0 ? "yes" : "no") : noMomentum > 0 ? "yes" : "no";
      const momentum = side === "yes" ? yesMomentum : noMomentum;
      const volumeMomentum = side === "yes" ? yesVolumeMomentum : noVolumeMomentum;

      // Confidence based on momentum magnitude and volume confirmation
      const momentumConfidence = Math.min(0.9, Math.abs(momentum) * 10);
      const volumeConfidence = volumeMomentum > 0 ? 0.1 : -0.1; // Volume confirmation
      const confidence = Math.max(0.3, Math.min(0.9, momentumConfidence + volumeConfidence));

      signals.push({
        marketId: market.id,
        signalType: "momentum",
        side,
        confidence,
        reasoning: `Strong ${side.toUpperCase()} momentum: ${(momentum * 100).toFixed(2)}% price move with ${(volumeMomentum * 100).toFixed(1)}% volume change`,
        impliedProbability: market.impliedProbability,
        marketPrice: side === "yes" ? market.yesPrice : market.noPrice,
        expectedValue: calculateExpectedValue(side, side === "yes" ? market.yesPrice : market.noPrice, 1, 1, market.impliedProbability),
        metadata: {
          priceMomentum: momentum,
          volumeMomentum,
          volatility,
        },
      });
    }
  }

  // Contrarian: detect extreme positions ripe for reversal
  const contrarianOpportunity = detectContrarianOpportunity(market, 0.1);
  if (contrarianOpportunity) {
    signals.push({
      marketId: market.id,
      signalType: "contrarian",
      side: contrarianOpportunity.side,
      confidence: contrarianOpportunity.confidence,
      reasoning: `Extreme market condition: ${(market.impliedProbability * 100).toFixed(1)}% probability suggests ${contrarianOpportunity.side.toUpperCase()} reversal opportunity`,
      impliedProbability: market.impliedProbability,
      marketPrice: contrarianOpportunity.side === "yes" ? market.yesPrice : market.noPrice,
      expectedValue: calculateExpectedValue(contrarianOpportunity.side, contrarianOpportunity.side === "yes" ? market.yesPrice : market.noPrice, 1, 1, market.impliedProbability),
    });
  }
  // Arbitrage: detect mispricing opportunities
  const arbitrageOpp = detectMispricingArbitrage(market.id, market.yesPrice, market.noPrice, market.impliedProbability, 0.02);
  if (arbitrageOpp && arbitrageOpp.confidence >= 0.5) {
    signals.push({
      marketId: market.id,
      signalType: "arbitrage",
      side: arbitrageOpp.side,
      confidence: arbitrageOpp.confidence,
      reasoning: arbitrageOpp.reasoning,
      impliedProbability: market.impliedProbability,
      marketPrice: arbitrageOpp.side === "yes" ? market.yesPrice : market.noPrice,
      expectedValue: arbitrageOpp.expectedProfit,
    });
  }


  return signals;
}

/**
 * Generate signals for multiple markets
 */
export async function generateSignalsForMarkets(
  markets: KalshiMarket[],
  feeds?: Map<string, MarketFeed>,
  fundamentalProbabilities?: Map<string, number>
): Promise<KalshiSignal[]> {
  const allSignals: KalshiSignal[] = [];

  for (const market of markets) {
    const feed = feeds?.get(market.id);
    const fundamentalProb = fundamentalProbabilities?.get(market.id);
    const signals = await generateSignalsForMarket(market, feed, fundamentalProb);
    allSignals.push(...signals);
  }

  return allSignals;
}

/**
 * Filter signals by confidence threshold
 */
export function filterSignalsByConfidence(signals: KalshiSignal[], minConfidence: number = 0.5): KalshiSignal[] {
  return signals.filter((s) => s.confidence >= minConfidence);
}

/**
 * Score a signal for execution readiness
 * Returns a 0-1 score indicating how ready the signal is to trade
 */
export function scoreSignalForExecution(signal: KalshiSignal): number {
  let score = signal.confidence; // Base score from confidence

  // Boost for high expected value
  if (signal.expectedValue > 0.1) {
    score += 0.1;
  }

  // Boost for value plays (more predictable)
  if (signal.signalType === "value_play") {
    score += 0.05;
  }

  // Reduce for momentum (more volatile)
  if (signal.signalType === "momentum") {
    score -= 0.05;
  }

  // Reduce for contrarian (riskier)
  if (signal.signalType === "contrarian") {
    score -= 0.1;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Rank signals by execution readiness
 */
export function rankSignalsByExecution(signals: KalshiSignal[]): Array<KalshiSignal & { executionScore: number }> {
  return signals
    .map((s) => ({
      ...s,
      executionScore: scoreSignalForExecution(s),
    }))
    .sort((a, b) => b.executionScore - a.executionScore);
}

/**
 * Get top N signals ready for execution
 */
export function getTopSignalsForExecution(signals: KalshiSignal[], topN: number = 5, minExecutionScore: number = 0.6): Array<KalshiSignal & { executionScore: number }> {
  return rankSignalsByExecution(signals).filter((s) => s.executionScore >= minExecutionScore).slice(0, topN);
}

/**
 * Save a signal to the database
 */
export async function saveSignal(signal: KalshiSignal): Promise<void> {
  await db.createKalshiSignal({
    marketId: signal.marketId,
    signalType: signal.signalType,
    side: signal.side,
    confidence: signal.confidence,
    reasoning: signal.reasoning,
    impliedProbability: signal.impliedProbability,
    marketPrice: signal.marketPrice,
    expectedValue: signal.expectedValue,
  });
}

/**
 * Save multiple signals to the database
 */
export async function saveSignals(signals: KalshiSignal[]): Promise<void> {
  await Promise.all(signals.map((s) => saveSignal(s)));
}

/**
 * Get signal performance metrics
 */
export interface SignalPerformance {
  signalType: SignalType;
  totalSignals: number;
  winningSignals: number;
  losingSignals: number;
  winRate: number;
  avgConfidence: number;
  avgExpectedValue: number;
  realizedPnL: number;
}

/**
 * Calculate signal performance by type
 */
export function calculateSignalPerformance(
  signals: KalshiSignal[],
  outcomes: Map<string, { won: boolean; pnl: number }>
): Map<SignalType, SignalPerformance> {
  const performance = new Map<SignalType, SignalPerformance>();

  // Initialize performance for each signal type
  const signalTypes: SignalType[] = ["value_play", "momentum", "contrarian", "arbitrage", "sentiment"];
  for (const type of signalTypes) {
    performance.set(type, {
      signalType: type,
      totalSignals: 0,
      winningSignals: 0,
      losingSignals: 0,
      winRate: 0,
      avgConfidence: 0,
      avgExpectedValue: 0,
      realizedPnL: 0,
    });
  }

  // Aggregate performance
  for (const signal of signals) {
    const perf = performance.get(signal.signalType)!;
    perf.totalSignals++;
    perf.avgConfidence += signal.confidence;
    perf.avgExpectedValue += signal.expectedValue;

    const outcome = outcomes.get(signal.marketId);
    if (outcome) {
      if (outcome.won) {
        perf.winningSignals++;
      } else {
        perf.losingSignals++;
      }
      perf.realizedPnL += outcome.pnl;
    }
  }

  // Calculate averages and win rates
  for (const perf of Array.from(performance.values())) {
    if (perf.totalSignals > 0) {
      perf.avgConfidence /= perf.totalSignals;
      perf.avgExpectedValue /= perf.totalSignals;
      perf.winRate = perf.winningSignals / perf.totalSignals;
    }
  }

  return performance;
}

// Arbitrage signal generation is available via detectMispricingArbitrage
// Import: import { detectMispricingArbitrage } from "./kalshiArbitrage";
// Usage in generateSignalsForMarket:
//   const arbitrageOpp = detectMispricingArbitrage(market.id, market.yesPrice, market.noPrice, market.impliedProbability, 0.02);
//   if (arbitrageOpp && arbitrageOpp.confidence >= 0.5) {
//     signals.push({ ...arbitrageOpp, signalType: "arbitrage" });
//   }
