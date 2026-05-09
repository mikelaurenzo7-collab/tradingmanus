/**
 * Polymarket Signal Generation
 *
 * Implements the same strategy types used for Kalshi, plus cluster-based
 * wash-trading signals derived from the Columbia University paper:
 *
 *   - value_play:           market price significantly deviates from fair value
 *   - momentum:             rapid price movement suggests continued direction
 *   - contrarian:           extreme prices are likely to mean-revert
 *   - arbitrage:            related markets have contradictory implied probs
 *   - sentiment:            external news/social sentiment diverges from price
 *   - cluster_fade:         coordinated pump detected → fade the retracement
 *   - cluster_copy:         cluster #3 low-prob political entry to mirror
 *   - wash_volume_warning:  cluster #4 airdrop farmers inflating volume
 *   - multi_timeframe:      multiple timeframes align on direction (requires feed)
 */

import type { PolymarketMarket } from "./polymarketAuth";
import {
  detectClusterActivityBatch,
  buildFadeRecommendations,
  type MarketSnapshot,
} from "./polymarketClusterMonitor";
import {
  analyzeMultipleTimeframes,
  calculateConfidenceBoost,
  shouldGenerateMultiTimeframeSignal,
  calculateAverageConfidence,
  getMomentumDirection,
  Timeframe,
  type MultiTimeframeAnalysis,
} from "./multiTimeframeAnalysis";
import type { MarketFeed } from "./kalshiMarketFeed";
import { lookupAwardsFundamental } from "./kalshiAwardsPrecursor";
import { classifyTellMarket, lookupLinguisticTellPrior } from "./kalshiLinguisticTells";
import * as db from "../db";
import { logger } from "./logger";

export type PolymarketSignalType =
  | "value_play"
  | "momentum"
  | "contrarian"
  | "arbitrage"
  | "sentiment"
  | "cluster_fade"
  | "cluster_copy"
  | "wash_volume_warning"
  | "confluence"
  | "multi_timeframe"
  // Corporate code-language tell detector (M&A, CEO departure, layoffs, …)
  | "linguistic_tell"
  // Wikipedia recent-edit alarm signal
  | "wikipedia_edit";

export interface PolymarketSignal {
  marketId: string;
  conditionId: string;
  question: string;
  signalType: PolymarketSignalType;
  /** "yes" = buy YES token, "no" = buy NO token */
  side: "yes" | "no";
  /** Confidence 0-1 */
  confidence: number;
  bayesianProbability?: number; // Bayesian posterior probability (separate from confidence)
  reasoning: string;
  impliedProbabilityYes: number;
  /** Fair-value estimate used for the trade thesis */
  fairValueEstimate: number;
  /** Token ID to trade (the selected outcome) */
  tokenId: string;
  /** Limit price for the CLOB order (0-1) */
  limitPrice: number;
  /** Expected value in dollars for a $1 position */
  expectedValue: number;
  /** Number of independent signal types that agree on direction (confluence signals only). */
  confluenceCount?: number;
  /** The individual signal types that contributed to this confluence signal. */
  confluenceSignalTypes?: PolymarketSignalType[];
  /** Spread-adjusted expected value (net of bid-ask spread cost). */
  spreadAdjustedEV?: number;
  /** Optional metadata for signal enrichment and analytics. */
  metadata?: {
    /** Instruction matches from training system (for effectiveness analytics). */
    instructionMatches?: Array<{
      instructionId: number;
      instructionTitle: string;
      passed: boolean;
      failedRules?: Array<{ ruleId: number; ruleKey: string; ruleType: string; reason: string }>;
    }>;
    /** Multi-timeframe analysis fields */
    timeframeAlignment?: number[];      // Array of timeframe values (in ms) that agree
    confluenceScore?: number;            // 0-1 score of how well timeframes align
    trendStrengthPerTimeframe?: Record<string, number>; // TSI values for each timeframe
    platformBehaviorProfile?: {
      platform: "polymarket";
      sampleSize: number;
      adaptationEpoch: number;
      hasSufficientData: boolean;
      signalAdjustments: Partial<Record<PolymarketSignalType, number>>;
      categoryAdjustment?: number;
    };
  };
}

export interface PolymarketPlatformPerformanceSnapshot {
  totalClosedTrades: number;
  signalWinRates?: Partial<Record<PolymarketSignalType, number>>;
  categoryEdge?: Partial<Record<string, number>>;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function clampAdjustment(value: number, min: number = -0.2, max: number = 0.25): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, value));
}

function buildPolymarketBehaviorProfile(
  signalType: PolymarketSignalType,
  category: string | undefined,
  performance?: PolymarketPlatformPerformanceSnapshot
): {
  multiplier: number;
  sampleSize: number;
  adaptationEpoch: number;
  hasSufficientData: boolean;
  signalAdjustments: Partial<Record<PolymarketSignalType, number>>;
  categoryAdjustment: number;
} {
  const baseAdjustments: Partial<Record<PolymarketSignalType, number>> = {
    sentiment: 0.15,
    momentum: 0.08,
    cluster_fade: 0.06,
    cluster_copy: 0.04,
    contrarian: -0.03,
  };

  const sampleSize = Math.max(0, Math.floor(Number(performance?.totalClosedTrades ?? 0)));
  const hasSufficientData = sampleSize >= 100;
  const adaptationEpoch = Math.floor(sampleSize / 100);

  let adaptiveSignalAdjustment = 0;
  if (hasSufficientData) {
    const winRate = performance?.signalWinRates?.[signalType];
    if (Number.isFinite(winRate)) {
      adaptiveSignalAdjustment = clampAdjustment((Number(winRate) - 0.5) * 0.4, -0.08, 0.08);
    }
  }

  const normalizedCategory = (category ?? "").trim().toLowerCase();
  let categoryAdjustment = 0;
  if (hasSufficientData && normalizedCategory.length > 0) {
    const categoryEdge = performance?.categoryEdge?.[normalizedCategory];
    if (Number.isFinite(categoryEdge)) {
      categoryAdjustment = clampAdjustment(Number(categoryEdge), -0.05, 0.05);
    }
  }

  const totalAdjustment = clampAdjustment(
    (baseAdjustments[signalType] ?? 0) + adaptiveSignalAdjustment + categoryAdjustment,
    -0.2,
    0.25
  );

  return {
    multiplier: 1 + totalAdjustment,
    sampleSize,
    adaptationEpoch,
    hasSufficientData,
    signalAdjustments: {
      ...baseAdjustments,
      [signalType]: clampAdjustment((baseAdjustments[signalType] ?? 0) + adaptiveSignalAdjustment, -0.2, 0.25),
    },
    categoryAdjustment,
  };
}

function applyPolymarketPlatformBehaviorAdjustment(
  signal: PolymarketSignal,
  category: string | undefined,
  performance?: PolymarketPlatformPerformanceSnapshot
): PolymarketSignal {
  const profile = buildPolymarketBehaviorProfile(signal.signalType, category, performance);
  const adjustedConfidence = clamp(signal.confidence * profile.multiplier, 0.05, 0.99);

  return {
    ...signal,
    confidence: adjustedConfidence,
    metadata: {
      ...signal.metadata,
      platformBehaviorProfile: {
        platform: "polymarket",
        sampleSize: profile.sampleSize,
        adaptationEpoch: profile.adaptationEpoch,
        hasSufficientData: profile.hasSufficientData,
        signalAdjustments: profile.signalAdjustments,
        categoryAdjustment: profile.categoryAdjustment,
      },
    },
  };
}

/**
 * Estimate a naive fair value for a binary market based on its current price
 * and a category-driven prior.  In production this would be replaced by an
 * AI or fundamentals estimate.
 *
 * Hooks for the awards precursor model: when the market title matches a
 * curated awards category AND the operator has populated KNOWN_NOMINEES +
 * KNOWN_PRECURSORS, the precursor-weighted probability replaces the naive
 * blend.  Both Kalshi and Polymarket flow through this same lookup so the
 * model fires on whichever venue has the better edge.
 */
function estimateFairValue(market: PolymarketMarket): number {
  // Awards precursor model takes precedence when the operator has staged
  // current-season precursor data.  Returns a calibrated probability per
  // nominee directly — no blending needed.
  const awardsPrior = lookupAwardsFundamental({ title: market.question });
  if (
    awardsPrior != null &&
    Number.isFinite(awardsPrior) &&
    awardsPrior >= 0 &&
    awardsPrior <= 1
  ) {
    return awardsPrior;
  }

  // Category-specific priors (same philosophy as Kalshi strategy profiles)
  const categoryPriors: Record<string, number> = {
    politics: 0.5,
    sports: 0.5,
    crypto: 0.5,
    economics: 0.5,
    weather: 0.5,
    entertainment: 0.5,
    science: 0.5,
  };

  const categoryKey = market.category.toLowerCase().split(/[\s/]/)[0] ?? "general";
  const prior = categoryPriors[categoryKey] ?? 0.5;

  // Blend the prior with the market's implied probability
  return clamp(prior * 0.3 + market.impliedProbabilityYes * 0.7, 0.01, 0.99);
}

/**
 * Generate trading signals for a list of Polymarket markets.
 * 
 * NOTE: Multi-timeframe analysis requires a MarketFeed with historical price/volume data.
 * Polymarket currently does not have feed infrastructure (unlike Kalshi's real-time
 * market feed polling). When feeds are provided, multi-timeframe analysis will be
 * performed, but currently this parameter will typically be undefined/empty.
 */
export function generatePolymarketSignals(
  markets: PolymarketMarket[],
  options: {
    minConfidence?: number;
    minLiquidity?: number;
    /** Optional: override fair-value per marketId */
    fairValues?: Map<string, number>;
    /** Optional: sentiment score per marketId (-1 to 1) */
    sentimentScores?: Map<string, number>;
    /**
     * Optional per-market recent volume (USDC in last hour) keyed by
     * marketId.  Required for cluster detection signals.
     */
    recentVolumes?: Map<string, number>;
    /**
     * Optional per-market count of distinct maker wallets in the last 90s.
     * If absent, sync-entry fingerprinting is skipped.
     */
    recentDistinctMakers?: Map<string, number>;
    /** Markets resolving within the next 5 minutes (set of marketIds). */
    resolvingWithin5Min?: Set<string>;
    /** Markets resolving within the next 4 hours (set of marketIds). */
    resolvingWithin4Hours?: Set<string>;
    /**
     * Optional: per-market historical feed data for multi-timeframe analysis.
     * Currently not available for Polymarket (no feed infrastructure).
     */
    feeds?: Map<string, MarketFeed>;
    /**
     * Optional: userId for persisting timeframe analysis to DB.
     */
    userId?: number;
    /** Optional platform adaptation snapshot, usually sourced from learning loop. */
    platformPerformance?: PolymarketPlatformPerformanceSnapshot;
    /**
     * Optional per-market news/PR/8-K snippets keyed by marketId.  Used by
     * the linguistic-tell detector to surface code-language patterns
     * ("strategic alternatives", "right-sizing", …) against M&A / CEO /
     * layoff markets.
     */
    newsSnippetsByMarket?: Map<string, string[]>;
  } = {},
): PolymarketSignal[] {
  const {
    minConfidence = 0.55,
    minLiquidity = 100,
    fairValues,
    sentimentScores,
    recentVolumes,
    recentDistinctMakers,
    resolvingWithin5Min,
    resolvingWithin4Hours,
    feeds,
    userId,
    platformPerformance,
    newsSnippetsByMarket,
  } = options;

  const signals: PolymarketSignal[] = [];
  
  // Track multi-timeframe analysis per market for later use
  const multiTimeframeAnalyses = new Map<string, MultiTimeframeAnalysis>();

  for (const market of markets) {
    if (market.closed || !market.active) continue;
    if (market.liquidity < minLiquidity) continue;

    const p = market.impliedProbabilityYes;
    if (!Number.isFinite(p) || p <= 0.01 || p >= 0.99) continue;

    const fairValue = fairValues?.get(market.marketId) ?? estimateFairValue(market);
    const sentimentScore = sentimentScores?.get(market.marketId) ?? 0;

    const yesToken = market.tokens.find((t) => t.outcome.toLowerCase() === "yes");
    const noToken = market.tokens.find((t) => t.outcome.toLowerCase() === "no");
    
    // Multi-timeframe analysis (if feed data available)
    const feed = feeds?.get(market.marketId);
    let multiTimeframeAnalysis: MultiTimeframeAnalysis | null = null;
    if (feed) {
      multiTimeframeAnalysis = analyzeMultipleTimeframes(feed);
      
      // Persist timeframe analysis data (non-blocking, best-effort)
      if (multiTimeframeAnalysis && userId) {
        db.saveTimeframeAnalysis({
          userId,
          marketId: market.marketId,
          platform: "polymarket",
          timeframeAnalyses: multiTimeframeAnalysis.analyses.map((a) => ({
            timeframe: a.timeframe,
            momentum: a.momentum,
            volatility: a.volatility,
            volume: a.volume,
            trendStrength: a.trendStrength,
          })),
        }).catch((err) => {
          logger.debug({ err, marketId: market.marketId }, "Failed to persist Polymarket timeframe analysis (non-critical)");
        });
      }
      
      if (multiTimeframeAnalysis) {
        multiTimeframeAnalyses.set(market.marketId, multiTimeframeAnalysis);
      }
    }

    // --- 1. Value-play signal ---
    const valueDiff = fairValue - p;
    if (Math.abs(valueDiff) >= 0.08) {
      const side: "yes" | "no" = valueDiff > 0 ? "yes" : "no";
      const token = side === "yes" ? yesToken : noToken;
      if (token && token.token_id) {
        const limitPrice = clamp(side === "yes" ? p : 1 - p, 0.02, 0.98);
        const confidence = clamp(Math.abs(valueDiff) * 2.5 + 0.35, 0, 1);
        const ev = side === "yes" ? (fairValue - p) / p : (p - fairValue) / (1 - p);

        signals.push({
          marketId: market.marketId,
          conditionId: market.conditionId,
          question: market.question,
          signalType: "value_play",
          side,
          confidence,
          reasoning: `Polymarket value play: market price (${(p * 100).toFixed(1)}%) vs fair value estimate (${(fairValue * 100).toFixed(1)}%) – ${Math.abs(valueDiff * 100).toFixed(1)}pp gap favoring ${side.toUpperCase()}.`,
          impliedProbabilityYes: p,
          fairValueEstimate: fairValue,
          tokenId: token.token_id,
          limitPrice,
          expectedValue: clamp(ev, -1, 5),
        });
      }
    }

    // --- 1b. Linguistic-tell signal (M&A / CEO / layoffs / earnings) ---
    // Fires when (a) the market title classifies as a tell-market type AND
    // (b) recent news snippets for that company contain corporate code-language
    // patterns (e.g. "strategic alternatives", "right-sizing").  The
    // posterior probability stacks each tell's empirical hit-rate Bayesianly.
    const tellMarketType = classifyTellMarket(market.question);
    const newsSnippets = newsSnippetsByMarket?.get(market.marketId);
    if (tellMarketType && newsSnippets && newsSnippets.length > 0) {
      const tellResult = lookupLinguisticTellPrior({
        marketType: tellMarketType,
        newsSnippets,
        basePrior: p,
      });
      if (tellResult && tellResult.posterior > p + 0.08) {
        const yesTokenForTell = market.tokens.find((t) => t.outcome.toLowerCase() === "yes");
        if (yesTokenForTell?.token_id) {
          const limitPrice = clamp(p, 0.02, 0.98);
          const confidence = clamp(tellResult.posterior, 0, 1);
          const ev = (tellResult.posterior - p) / p;
          signals.push({
            marketId: market.marketId,
            conditionId: market.conditionId,
            question: market.question,
            signalType: "linguistic_tell",
            side: "yes",
            confidence,
            reasoning:
              `Linguistic-tell: ${tellResult.matches.length} corporate code-language ` +
              `pattern(s) detected in recent news. ` +
              `Bayesian posterior P(${tellMarketType}) = ${(tellResult.posterior * 100).toFixed(1)}% ` +
              `vs market ${(p * 100).toFixed(1)}%. ` +
              `Top tell: "${tellResult.matches[0]?.tell.phrase}" ` +
              `(historical hit-rate ${(tellResult.matches[0]?.tell.hitRate * 100).toFixed(0)}%).`,
            impliedProbabilityYes: p,
            fairValueEstimate: tellResult.posterior,
            tokenId: yesTokenForTell.token_id,
            limitPrice,
            expectedValue: clamp(ev, -1, 5),
          });
        }
      }
    }

    // --- 2. Contrarian signal (extreme prices likely to mean-revert) ---
    if (p <= 0.07 || p >= 0.93) {
      const side: "yes" | "no" = p <= 0.07 ? "yes" : "no";
      const token = side === "yes" ? yesToken : noToken;
      if (token && token.token_id) {
        const extremity = p <= 0.07 ? 0.07 - p : p - 0.93;
        const confidence = clamp(0.52 + extremity * 3, 0, 0.8);
        const limitPrice = clamp(side === "yes" ? p : 1 - p, 0.02, 0.98);
        const ev = side === "yes" ? (0.5 - p) / p : (p - 0.5) / (1 - p);

        signals.push({
          marketId: market.marketId,
          conditionId: market.conditionId,
          question: market.question,
          signalType: "contrarian",
          side,
          confidence,
          reasoning: `Polymarket contrarian: ${side === "yes" ? "YES" : "NO"} trading at extreme (${(p * 100).toFixed(1)}%). Mean-reversion thesis – buying the unpopular side at a discount.`,
          impliedProbabilityYes: p,
          fairValueEstimate: fairValue,
          tokenId: token.token_id,
          limitPrice,
          expectedValue: clamp(ev, -1, 5),
        });
      }
    }

    // --- 3. Sentiment signal ---
    if (Math.abs(sentimentScore) >= 0.3) {
      const sentimentFavorsYes = sentimentScore > 0;
      const side: "yes" | "no" = sentimentFavorsYes ? "yes" : "no";
      const token = side === "yes" ? yesToken : noToken;
      if (token && token.token_id) {
        // Only fire if sentiment contradicts or strongly supports the current price
        const alreadyPricedIn = sentimentFavorsYes ? p > 0.7 : p < 0.3;
        if (!alreadyPricedIn) {
          const confidence = clamp(0.52 + Math.abs(sentimentScore) * 0.3, 0, 0.85);
          const limitPrice = clamp(side === "yes" ? p : 1 - p, 0.02, 0.98);
          const ev = side === "yes" ? (fairValue - p) / p : (p - fairValue) / (1 - p);

          signals.push({
            marketId: market.marketId,
            conditionId: market.conditionId,
            question: market.question,
            signalType: "sentiment",
            side,
            confidence,
            reasoning: `Polymarket sentiment: ${sentimentScore > 0 ? "bullish" : "bearish"} news/social signal (score ${sentimentScore.toFixed(2)}) not fully priced in at ${(p * 100).toFixed(1)}%.`,
            impliedProbabilityYes: p,
            fairValueEstimate: fairValue,
            tokenId: token.token_id,
            limitPrice,
            expectedValue: clamp(ev, -1, 5),
          });
        }
      }
    }
  }

  // --- 4. Momentum signals (across sorted markets) ---
  // Momentum: markets with very high volume relative to liquidity suggest informed
  // trading.  We approximate with volume/liquidity ratio.
  const sortedByMomentum = [...markets]
    .filter((m) => m.active && !m.closed && m.liquidity > minLiquidity)
    .sort((a, b) => b.volume / (b.liquidity || 1) - a.volume / (a.liquidity || 1));

  for (const market of sortedByMomentum.slice(0, 5)) {
    const ratio = market.volume / (market.liquidity || 1);
    if (ratio < 2) break; // not enough momentum

    const p = market.impliedProbabilityYes;
    if (!Number.isFinite(p) || p <= 0.01 || p >= 0.99) continue;

    // Direction: if price is above 0.5 momentum continues up, else down
    const side: "yes" | "no" = p >= 0.5 ? "yes" : "no";
    const token = market.tokens.find((t) => t.outcome.toLowerCase() === side);
    if (!token || !token.token_id) continue;

    const confidence = clamp(0.5 + Math.min(ratio / 20, 0.3), 0, 0.85);
    const limitPrice = clamp(side === "yes" ? p : 1 - p, 0.02, 0.98);
    const fairValue = fairValues?.get(market.marketId) ?? estimateFairValue(market);
    const ev = side === "yes" ? (fairValue - p) / p : ((1 - fairValue) - (1 - p)) / (1 - p);

    // Avoid adding a duplicate for the same market
    if (signals.some((s) => s.marketId === market.marketId && s.signalType === "momentum")) {
      continue;
    }

    signals.push({
      marketId: market.marketId,
      conditionId: market.conditionId,
      question: market.question,
      signalType: "momentum",
      side,
      confidence,
      reasoning: `Polymarket momentum: volume/liquidity ratio ${ratio.toFixed(1)}x signals informed trading on ${side.toUpperCase()} at ${(p * 100).toFixed(1)}%.`,
      impliedProbabilityYes: p,
      fairValueEstimate: fairValue,
      tokenId: token.token_id,
      limitPrice,
      expectedValue: clamp(ev, -1, 5),
    });
  }

  // --- 5. Arbitrage signals (correlated markets with divergent prices) ---
  // Simple cross-market arbitrage: if two markets in the same category have
  // significantly different implied probabilities for logically linked outcomes.
  const byCategory = new Map<string, PolymarketMarket[]>();
  for (const m of markets) {
    if (!m.active || m.closed || m.liquidity < minLiquidity) continue;
    const cat = m.category.toLowerCase();
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(m);
  }

  for (const [, group] of Array.from(byCategory)) {
    if (group.length < 2) continue;

    for (let i = 0; i < group.length - 1; i++) {
      const a = group[i];
      const b = group[i + 1];
      if (!a || !b) continue;

      const pA = a.impliedProbabilityYes;
      const pB = b.impliedProbabilityYes;

      // Look for markets that sum >1.05 or <0.95 (overround / underround)
      const pSum = pA + pB;
      if (pSum > 1.05) {
        // Both YES overpriced – fade the one that is pricier
        const fadeMarket = pA >= pB ? a : b;
        const noToken = fadeMarket.tokens.find((t) => t.outcome.toLowerCase() === "no");
        if (noToken && noToken.token_id && !signals.some(
          (s) => s.marketId === fadeMarket.marketId && s.signalType === "arbitrage",
        )) {
          const fairValue = fairValues?.get(fadeMarket.marketId) ?? estimateFairValue(fadeMarket);
          const limitPrice = clamp(1 - fadeMarket.impliedProbabilityYes, 0.02, 0.98);
          const ev = ((1 - fairValue) - (1 - fadeMarket.impliedProbabilityYes)) / (1 - fadeMarket.impliedProbabilityYes);

          signals.push({
            marketId: fadeMarket.marketId,
            conditionId: fadeMarket.conditionId,
            question: fadeMarket.question,
            signalType: "arbitrage",
            side: "no",
            confidence: clamp(0.54 + (pSum - 1.05) * 2, 0, 0.82),
            reasoning: `Polymarket arbitrage: correlated ${fadeMarket.category} markets sum to ${(pSum * 100).toFixed(1)}%, indicating YES overpricing. Fading with NO on "${fadeMarket.question}".`,
            impliedProbabilityYes: fadeMarket.impliedProbabilityYes,
            fairValueEstimate: fairValue,
            tokenId: noToken.token_id,
            limitPrice,
            expectedValue: clamp(ev, -1, 5),
          });
        }
      }
    }
  }

  // --- 6. Cluster-based signals (wash-trading detection) ---
  // Build market snapshots from available data and run cluster detection.
  const snapshots: MarketSnapshot[] = markets
    .filter((m) => m.active && !m.closed)
    .map((m) => ({
      marketId: m.marketId,
      question: m.question,
      category: m.category,
      impliedProbabilityYes: m.impliedProbabilityYes,
      recentVolume: recentVolumes?.get(m.marketId) ?? 0,
      totalVolume: m.volume,
      liquidity: m.liquidity,
      recentDistinctMakers: recentDistinctMakers?.get(m.marketId),
      resolvingWithin5Min: resolvingWithin5Min?.has(m.marketId) ?? false,
      resolvingWithin4Hours: resolvingWithin4Hours?.has(m.marketId) ?? false,
    }));

  const clusterSignals = detectClusterActivityBatch(snapshots);
  const recommendations = buildFadeRecommendations(
    clusterSignals,
    0.5, // placeholder; per-market values used inside the loop below
  );

  for (const rec of recommendations) {
    const market = markets.find((m) => m.marketId === rec.marketId);
    if (!market) continue;

    const token = market.tokens.find(
      (t) => t.outcome.toLowerCase() === rec.side,
    );
    if (!token || !token.token_id) continue;

    const p = market.impliedProbabilityYes;
    const fairValue = fairValues?.get(market.marketId) ?? estimateFairValue(market);

    let signalType: PolymarketSignalType;
    let limitPrice: number;
    let ev: number;

    if (rec.action === "skip_market" || rec.action === "exit_now") {
      // Surface wash-volume warning so the UI can flag the market
      if (!signals.some(
        (s) => s.marketId === market.marketId && s.signalType === "wash_volume_warning",
      )) {
        signals.push({
          marketId: market.marketId,
          conditionId: market.conditionId,
          question: market.question,
          signalType: "wash_volume_warning",
          side: rec.side,
          confidence: rec.confidence,
          reasoning: rec.reasoning,
          impliedProbabilityYes: p,
          fairValueEstimate: fairValue,
          tokenId: token.token_id,
          limitPrice: 0,
          expectedValue: 0,
        });
      }
      continue;
    }

    if (rec.action === "copy_buy") {
      signalType = "cluster_copy";
      limitPrice = clamp(rec.suggestedLimitPrice, 0.001, 0.98);
      ev = fairValue > p ? (fairValue - p) / p : 0;
    } else {
      signalType = "cluster_fade";
      limitPrice = clamp(rec.suggestedLimitPrice, 0.02, 0.98);
      ev = rec.side === "no"
        ? clamp(((1 - fairValue) - (1 - p)) / (1 - p), -1, 5)
        : clamp((fairValue - p) / p, -1, 5);
    }

    if (
      !signals.some(
        (s) => s.marketId === market.marketId && s.signalType === signalType,
      )
    ) {
      signals.push({
        marketId: market.marketId,
        conditionId: market.conditionId,
        question: market.question,
        signalType,
        side: rec.side,
        confidence: rec.confidence,
        reasoning: rec.reasoning,
        impliedProbabilityYes: p,
        fairValueEstimate: fairValue,
        tokenId: token.token_id,
        limitPrice,
        expectedValue: clamp(ev, -1, 5),
      });
    }
  }
  
  // Apply multi-timeframe confidence boosts to all generated signals
  for (const signal of signals) {
    const analysis = multiTimeframeAnalyses.get(signal.marketId);
    if (analysis && analysis.hasConfluence) {
      signal.confidence = calculateConfidenceBoost(
        signal.confidence,
        analysis.confluenceScore,
        analysis.hasConfluence
      );
      
      // Attach timeframe metadata
      if (!signal.metadata) {
        signal.metadata = {};
      }
      signal.metadata.timeframeAlignment = analysis.timeframeAlignment;
      signal.metadata.confluenceScore = analysis.confluenceScore;
      signal.metadata.trendStrengthPerTimeframe = analysis.trendStrengthPerTimeframe;
    }
  }
  
  // Generate standalone multi_timeframe signals when >=3 timeframes align
  for (const [marketId, analysis] of multiTimeframeAnalyses.entries()) {
    if (!shouldGenerateMultiTimeframeSignal(analysis)) continue;
    
    // Don't generate duplicate multi_timeframe signal if one already exists
    if (signals.some((s) => s.marketId === marketId && s.signalType === "multi_timeframe")) {
      continue;
    }
    
    const market = markets.find((m) => m.marketId === marketId);
    if (!market) continue;
    
    const side = getMomentumDirection(analysis);
    const token = market.tokens.find((t) => t.outcome.toLowerCase() === side);
    if (!token || !token.token_id) continue;
    
    const baseConfidence = calculateAverageConfidence(analysis, analysis.timeframeAlignment);
    const boostedConfidence = calculateConfidenceBoost(
      baseConfidence,
      analysis.confluenceScore,
      analysis.hasConfluence
    );
    
    // Calculate limit price with small forecast bias from trend strength
    const p = market.impliedProbabilityYes;
    const forecastBias = analysis.combinedTrendStrength * 0.05 * (side === "yes" ? 1 : -1);
    const limitPrice = clamp(
      (side === "yes" ? p : 1 - p) + forecastBias,
      0.02,
      0.98
    );
    
    const fairValue = fairValues?.get(marketId) ?? estimateFairValue(market);
    const ev = side === "yes" ? (fairValue - p) / p : (p - fairValue) / (1 - p);
    
    const timeframeLabels = analysis.timeframeAlignment
      .map((tf) => {
        if (tf === Timeframe.M5) return "5m";
        if (tf === Timeframe.M15) return "15m";
        if (tf === Timeframe.H1) return "1h";
        if (tf === Timeframe.H4) return "4h";
        if (tf === Timeframe.D1) return "24h";
        return "?";
      })
      .join(", ");
    
    signals.push({
      marketId,
      conditionId: market.conditionId,
      question: market.question,
      signalType: "multi_timeframe",
      side,
      confidence: boostedConfidence,
      reasoning: `Multi-timeframe confluence: ${analysis.timeframeAlignment.length} timeframes (${timeframeLabels}) align on ${side.toUpperCase()} with ${(analysis.confluenceScore * 100).toFixed(0)}% correlation and combined TSI of ${analysis.combinedTrendStrength.toFixed(2)}`,
      impliedProbabilityYes: p,
      fairValueEstimate: fairValue,
      tokenId: token.token_id,
      limitPrice,
      expectedValue: clamp(ev, -1, 5),
      metadata: {
        timeframeAlignment: analysis.timeframeAlignment,
        confluenceScore: analysis.confluenceScore,
        trendStrengthPerTimeframe: analysis.trendStrengthPerTimeframe,
      },
    });
  }

  const categoryByMarketId = new Map(markets.map((market) => [market.marketId, market.category]));
  const withPlatformBehavior = signals.map((signal) =>
    applyPolymarketPlatformBehaviorAdjustment(
      signal,
      categoryByMarketId.get(signal.marketId),
      platformPerformance
    )
  );

  return withPlatformBehavior.filter((s) => s.confidence >= minConfidence);
}
