/**
 * Kalshi Signal Generation Framework
 * Generates trading signals based on market analysis and scoring
 */

import { KalshiMarket, calculateExpectedValue, detectValueOpportunity, detectMomentumOpportunity, detectContrarianOpportunity } from "./kalshiMarketData";
import { MarketFeed, calculatePriceMomentum, calculateVolumeMomentum, detectVolatility } from "./kalshiMarketFeed";
import { detectMispricingArbitrage } from "./kalshiArbitrage";
import { applySentimentBoost, calculateCompositeSentiment, fetchGdeltTopicSignal, fetchLiveNewsSummary } from "./kalshiSentiment";
import {
  analyzeMultipleTimeframes,
  calculateConfidenceBoost,
  shouldGenerateMultiTimeframeSignal,
  calculateAverageConfidence,
  getMomentumDirection,
  timeframeToLabel,
  Timeframe,
  type MultiTimeframeAnalysis,
} from "./multiTimeframeAnalysis";
import { analyzeMicrostructure, applyMicrostructureToSignal, type MicrostructureResult } from "./marketMicrostructure";
import { initializeBayesianProbability } from "./bayesianUpdater";
import { extractFeatures, predictEnsemble, blendProbabilities, type EnsembleModel } from "./mlSignalEnsemble";
import * as db from "../db";
import { assertPositiveIntegerUserId } from "./userScope";
import { logger } from "./logger";

export type SignalType = "value_play" | "momentum" | "contrarian" | "arbitrage" | "sentiment" | "confluence" | "multi_timeframe" | "order_flow";

export interface KalshiSignal {
  marketId: string;
  signalType: SignalType;
  side: "yes" | "no";
  confidence: number; // 0-1
  bayesianProbability?: number; // Bayesian posterior probability (separate from confidence)
  /** Blended ML+rule-based win probability, populated when an ensemble model is provided. */
  mlEnsembleProbability?: number;
  reasoning: string;
  impliedProbability: number;
  marketPrice: number;
  expectedValue: number;
  metadata?: {
    priceMomentum?: number;
    volumeMomentum?: number;
    volatility?: number;
    fundamentalProbability?: number;
    fundamentalSource?: "explicit" | "neutral_fallback";
    sentimentScore?: number;
    sentimentConfidence?: number;
    sentimentContribution?: number;
    sentimentTopic?: string;
    liquidityScore?: number;
    spreadProxy?: number;
    totalVolume?: number;
    marketDataQuality?: number;
    marketCategory?: string;
    strategyProfile?: StrategyProfileKey;
    /** ISO-8601 resolution date from Kalshi, used for time-to-resolution scoring. */
    resolutionDate?: string;
    /** Number of independent signal types that agree on direction (confluence signals only). */
    confluenceCount?: number;
    /** The individual signal types that contributed to this confluence signal. */
    confluenceSignalTypes?: SignalType[];
    /** Kelly fraction recommended for position sizing based on edge and confidence. */
    kellyFraction?: number;
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
    /** Microstructure fields */
    microstructureScore?: number;        // 0-1 composite microstructure quality
    spreadPct?: number;                  // bid-ask spread as fraction of bid price
    platformBehaviorProfile?: {
      platform: "kalshi";
      sampleSize: number;
      adaptationEpoch: number;
      hasSufficientData: boolean;
      signalAdjustments: Partial<Record<SignalType, number>>;
      categoryAdjustment?: number;
    };
  };
}

export interface KalshiPlatformPerformanceSnapshot {
  totalClosedTrades: number;
  signalWinRates?: Partial<Record<SignalType, number>>;
  categoryEdge?: Partial<Record<string, number>>;
}

type StrategyProfileKey =
  | "macro_data"
  | "weather_event"
  | "politics_event"
  | "sports_event"
  | "crypto_event"
  | "general_event";

type StrategyProfileConfig = {
  executionAdjustment: number;
  minLiquidity: number;
};

const STRATEGY_PROFILES: Record<StrategyProfileKey, StrategyProfileConfig> = {
  macro_data: { executionAdjustment: 0.05, minLiquidity: 0.38 },
  weather_event: { executionAdjustment: 0.03, minLiquidity: 0.34 },
  politics_event: { executionAdjustment: -0.02, minLiquidity: 0.45 },
  sports_event: { executionAdjustment: 0.01, minLiquidity: 0.36 },
  crypto_event: { executionAdjustment: -0.05, minLiquidity: 0.55 },
  general_event: { executionAdjustment: 0, minLiquidity: 0.35 },
};

export interface MarketSentimentContext {
  topic?: string;
  newsSentiment?: number;
  socialSentiment?: number;
  marketSentiment?: number;
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0.01, Math.min(0.99, value));
}

function clampAdjustment(value: number, min: number = -0.2, max: number = 0.25): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, value));
}

function buildKalshiBehaviorProfile(
  signalType: SignalType,
  category: string | undefined,
  performance?: KalshiPlatformPerformanceSnapshot
): {
  multiplier: number;
  sampleSize: number;
  adaptationEpoch: number;
  hasSufficientData: boolean;
  signalAdjustments: Partial<Record<SignalType, number>>;
  categoryAdjustment: number;
} {
  const baseAdjustments: Partial<Record<SignalType, number>> = {
    momentum: -0.1,
    sentiment: -0.02,
    value_play: 0.03,
    arbitrage: 0.02,
    contrarian: -0.04,
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

function applyKalshiPlatformBehaviorAdjustment(
  signal: KalshiSignal,
  marketCategory: string | undefined,
  performance?: KalshiPlatformPerformanceSnapshot
): KalshiSignal {
  const profile = buildKalshiBehaviorProfile(signal.signalType, marketCategory, performance);
  const adjustedConfidence = Math.max(0.05, Math.min(0.99, signal.confidence * profile.multiplier));

  return {
    ...signal,
    confidence: adjustedConfidence,
    metadata: {
      ...signal.metadata,
      platformBehaviorProfile: {
        platform: "kalshi",
        sampleSize: profile.sampleSize,
        adaptationEpoch: profile.adaptationEpoch,
        hasSufficientData: profile.hasSufficientData,
        signalAdjustments: profile.signalAdjustments,
        categoryAdjustment: profile.categoryAdjustment,
      },
    },
  };
}

function getLiquidityProfile(feed?: MarketFeed) {
  if (!feed?.currentSnapshot) {
    return {
      liquidityScore: 0.5,
      spreadProxy: 0,
      totalVolume: 0,
      marketDataQuality: feed?.dataQualityScore ?? 0.5,
      isTradable: true,
    };
  }

  const snapshot = feed.currentSnapshot;
  const totalVolume = Math.max(0, snapshot.yesVolume + snapshot.noVolume);
  const spreadProxy = Math.abs(snapshot.yesPrice + snapshot.noPrice - 1);
  const volumeScore = Math.max(0, Math.min(1, totalVolume / 20000));
  const spreadScore = Math.max(0, 1 - Math.min(1, spreadProxy / 0.12));
  const marketDataQuality = Math.max(0, Math.min(1, feed.dataQualityScore ?? 1));
  const liquidityScore = Math.max(0, Math.min(1, volumeScore * 0.5 + spreadScore * 0.35 + marketDataQuality * 0.15));

  return {
    liquidityScore,
    spreadProxy,
    totalVolume,
    marketDataQuality,
    isTradable: totalVolume >= 250 && spreadProxy <= 0.12 && marketDataQuality >= 0.35,
  };
}

function attachLiquidityMetadata(signal: KalshiSignal, feed?: MarketFeed): KalshiSignal {
  const profile = getLiquidityProfile(feed);
  const confidencePenalty = profile.isTradable ? 0 : Math.max(0.08, (0.45 - profile.liquidityScore) * 0.5);

  return {
    ...signal,
    confidence: Math.max(0.05, Math.min(0.99, signal.confidence - confidencePenalty)),
    reasoning: profile.isTradable
      ? signal.reasoning
      : `${signal.reasoning} | Liquidity caution: thin depth or wide spread reduces execution quality`,
    metadata: {
      ...signal.metadata,
      liquidityScore: profile.liquidityScore,
      spreadProxy: profile.spreadProxy,
      totalVolume: profile.totalVolume,
      marketDataQuality: profile.marketDataQuality,
    },
  };
}

function resolveStrategyProfile(market: KalshiMarket): StrategyProfileKey {
  const bucket = `${market.category ?? ""} ${market.title ?? ""}`.toLowerCase();

  if (/(fed|fomc|cpi|inflation|jobs|unemployment|gdp|treasury|economy|recession)/.test(bucket)) {
    return "macro_data";
  }
  if (/(hurricane|storm|rain|snow|temperature|weather|wildfire|earthquake)/.test(bucket)) {
    return "weather_event";
  }
  if (/(election|senate|house|president|politic|approval|primary|governor)/.test(bucket)) {
    return "politics_event";
  }
  if (/(nba|nfl|mlb|nhl|soccer|football|baseball|basketball|tournament|match|game)/.test(bucket)) {
    return "sports_event";
  }
  if (/(bitcoin|btc|ethereum|eth|crypto|solana)/.test(bucket)) {
    return "crypto_event";
  }

  return "general_event";
}

function applySentimentOverlay(
  signal: KalshiSignal,
  sentimentScore: number,
  sentimentConfidence: number,
  topic?: string
): KalshiSignal {
  const aligned = (signal.side === "yes" && sentimentScore >= 0) || (signal.side === "no" && sentimentScore <= 0);
  const signedSentiment = aligned ? Math.abs(sentimentScore) : -Math.abs(sentimentScore);
  const confidence = applySentimentBoost(
    signal.confidence,
    signedSentiment * Math.max(0.25, sentimentConfidence),
    0.18
  );

  return {
    ...signal,
    confidence,
    reasoning: `${signal.reasoning} | Sentiment overlay ${aligned ? "supports" : "pushes against"} this trade (${sentimentScore >= 0 ? "bullish" : "bearish"} ${Math.abs(sentimentScore).toFixed(2)}, confidence ${(sentimentConfidence * 100).toFixed(0)}%)`,
    metadata: {
      ...signal.metadata,
      sentimentScore,
      sentimentConfidence,
      sentimentContribution: signedSentiment * Math.max(0.25, sentimentConfidence) * 0.18,
      sentimentTopic: topic,
    },
  };
}

/**
 * Pre-event confidence boost.
 *
 * Markets approaching resolution in 2–24 h are entering their highest-
 * information window: late news, updated forecasts, and last-minute data
 * releases concentrate edge right before the event.  Boost confidence
 * modestly so the execution scorer surfaces these signals over longer-
 * horizon alternatives.
 *
 * Excluded: < 2 h (adverse selection / thin liquidity spike risk).
 * Excluded: weather/sports (resolution ≠ a scheduled information event).
 */
const PRE_EVENT_BOOST_CATEGORIES = new Set(["economics", "politics", "crypto", "tech"]);
const PRE_EVENT_BOOST_AMOUNT = 0.07;

function applyPreEventBoost(signals: KalshiSignal[], resolutionDate: string | undefined | null, category: string | null | undefined): KalshiSignal[] {
  if (!resolutionDate) return signals;
  if (!category || !PRE_EVENT_BOOST_CATEGORIES.has(category)) return signals;
  const hoursToResolution = (new Date(resolutionDate).getTime() - Date.now()) / 3_600_000;
  if (!Number.isFinite(hoursToResolution) || hoursToResolution < 2 || hoursToResolution > 24) {
    return signals;
  }
  // Linear taper: max boost at 6 h, full boost from 6–18 h, taper back at edges.
  // hoursToResolution in [2, 24] → taper factor in [0, 1].
  const taper =
    hoursToResolution < 6
      ? (hoursToResolution - 2) / 4   // ramp up from 2→6 h
      : hoursToResolution <= 18
        ? 1.0                           // full boost 6→18 h
        : (24 - hoursToResolution) / 6; // ramp down 18→24 h
  const boost = PRE_EVENT_BOOST_AMOUNT * Math.max(0, taper);
  if (boost <= 0) return signals;
  return signals.map((s) => ({
    ...s,
    confidence: Math.min(0.99, s.confidence + boost),
    reasoning: `${s.reasoning} | Pre-event window (${hoursToResolution.toFixed(1)}h to resolution): +${(boost * 100).toFixed(1)}% confidence`,
  }));
}

/**
 * Category-specific fundamental probability priors.
 * Used as a fallback when no explicit fundamental probability is provided.
 * Based on the typical base rate for "YES" outcomes in each category:
 * - politics/elections: near-even by nature, slight lean toward status quo.
 * - crypto: highly volatile; no reliable directional prior.
 * - macro_data: data releases slightly more likely to come in near-consensus.
 * - weather/natural events: most extreme events are <50% probable.
 * - sports: roughly even match-up markets.
 */
const CATEGORY_FUNDAMENTAL_PRIORS: Record<StrategyProfileKey, number> = {
  macro_data: 0.52,      // slight lean toward "consensus outcome"
  weather_event: 0.42,   // extreme events are below-50 by nature
  politics_event: 0.50,  // intentionally neutral; politics are hard to forecast
  sports_event: 0.50,    // match-up markets are designed near even
  crypto_event: 0.50,    // no directional edge from category alone
  general_event: 0.50,
};

/**
 * Resolve a category-aware fundamental prior for a market.
 * Returns the category prior when no explicit value is provided.
 */
export function resolveFundamentalPrior(market: KalshiMarket, explicit?: number): { value: number; source: "explicit" | "category_prior" | "neutral_fallback" } {
  if (explicit != null && Number.isFinite(explicit) && explicit > 0 && explicit < 1) {
    return { value: explicit, source: "explicit" };
  }
  const profile = resolveStrategyProfile(market);
  const prior = CATEGORY_FUNDAMENTAL_PRIORS[profile];
  if (prior !== 0.5) {
    return { value: prior, source: "category_prior" };
  }
  return { value: 0.5, source: "neutral_fallback" };
}

/**
 * Compute Kelly fraction for a signal.
 *
 * Uses fractional Kelly (25%) to limit over-sizing.  The win probability is
 * the signal confidence and the "odds" are derived from the market price:
 *   odds = (1 / marketPrice) - 1  (net profit per dollar risked on a win)
 *
 * Returns a value in [0, 0.2] that can be multiplied by available capital to
 * get a target exposure.
 */
export function computeKellyFraction(confidence: number, marketPrice: number): number {
  if (!Number.isFinite(confidence) || !Number.isFinite(marketPrice) || marketPrice <= 0 || marketPrice >= 1) {
    return 0;
  }
  // Net odds: profit per $ staked if correct
  const odds = (1 - marketPrice) / marketPrice;
  const lossProbability = 1 - confidence;
  const fullKelly = (confidence * odds - lossProbability) / odds;
  // Quarter-Kelly for safety; cap at 20% of capital per position
  return Math.max(0, Math.min(0.2, fullKelly * 0.25));
}

/**
 * Consolidate multiple signals on the same market into a single high-conviction
 * confluence signal when two or more independent signal types agree on direction.
 *
 * Confluence boosts confidence by a diminishing-returns formula so a three-type
 * agreement is stronger than a two-type agreement, but not infinitely so.
 * The best-EV signal among agreeing types is used as the base so execution
 * scoring starts from the most favourable raw edge.
 *
 * Signals that disagree on direction are left as-is (no confluence formed).
 */
export function consolidateSignalsForMarket(signals: KalshiSignal[]): KalshiSignal[] {
  if (signals.length <= 1) return signals;

  // Group by direction
  const yesSigs = signals.filter((s) => s.side === "yes");
  const noSigs = signals.filter((s) => s.side === "no");

  const result: KalshiSignal[] = [];

  for (const group of [yesSigs, noSigs]) {
    if (group.length === 0) continue;

    if (group.length === 1) {
      result.push(group[0]!);
      continue;
    }

    // Build confluence signal from the best-EV base signal
    const base = group.reduce((best, s) =>
      s.expectedValue > best.expectedValue ? s : best
    );

    const contributingTypes = [...new Set(group.map((s) => s.signalType))];
    // Confidence boost: +0.08 for each additional agreeing type (diminishing)
    const boost = (contributingTypes.length - 1) * 0.08;
    const avgConfidence = group.reduce((sum, s) => sum + s.confidence, 0) / group.length;
    const boostedConfidence = Math.min(0.95, Math.max(avgConfidence, base.confidence) + boost);
    const avgEV = group.reduce((sum, s) => sum + s.expectedValue, 0) / group.length;

    const typeLabels = contributingTypes.join(" + ");
    const kelly = computeKellyFraction(boostedConfidence, base.marketPrice);

    result.push({
      ...base,
      signalType: "confluence",
      confidence: boostedConfidence,
      expectedValue: Math.max(base.expectedValue, avgEV),
      reasoning: `Confluence (${typeLabels}): ${group.length} independent signal types agree on ${base.side.toUpperCase()} — ${base.reasoning}`,
      metadata: {
        ...base.metadata,
        confluenceCount: group.length,
        confluenceSignalTypes: contributingTypes,
        kellyFraction: kelly,
      },
    });
  }

  return result;
}

/**
 * Generate signals for a market
 * Combines multiple signal types and scores them
 */
export async function generateSignalsForMarket(
  market: KalshiMarket,
  feed?: MarketFeed,
  fundamentalProbability?: number,
  sentimentContext?: MarketSentimentContext,
  userId?: number,
  platformPerformance?: KalshiPlatformPerformanceSnapshot
): Promise<KalshiSignal[]> {
  const signals: KalshiSignal[] = [];
  const strategyProfile = resolveStrategyProfile(market);

  let sentimentOverlay: ReturnType<typeof calculateCompositeSentiment> | null = null;
  if (sentimentContext?.topic) {
    const [externalSignal, liveNews] = await Promise.all([
      fetchGdeltTopicSignal(sentimentContext.topic),
      fetchLiveNewsSummary(sentimentContext.topic),
    ]);
    const blendedNewsSentiment = liveNews
      ? Math.max(-1, Math.min(1, (sentimentContext.newsSentiment ?? 0) * 0.4 + liveNews.derivedSentiment * 0.6))
      : (sentimentContext.newsSentiment ?? 0);

    sentimentOverlay = calculateCompositeSentiment({
      newsSentiment: blendedNewsSentiment,
      socialSentiment: sentimentContext.socialSentiment ?? 0,
      marketSentiment: sentimentContext.marketSentiment ?? 0,
      externalSentiment: externalSignal?.normalizedSentiment ?? 0,
      externalConfidence: externalSignal?.confidence ?? 0,
      externalSignal,
      liveNews,
    });
  }
  
  // Validate inputs
  if (!market || !market.id || isNaN(market.impliedProbability) || !isFinite(market.impliedProbability)) {
    return signals; // Skip invalid markets
  }
  if (fundamentalProbability && (isNaN(fundamentalProbability) || !isFinite(fundamentalProbability))) {
    fundamentalProbability = undefined; // Skip invalid fundamental probability
  }

  // Multi-timeframe analysis (if feed data available)
  let multiTimeframeAnalysis: MultiTimeframeAnalysis | null = null;
  if (feed) {
    multiTimeframeAnalysis = analyzeMultipleTimeframes(feed);
    
    // Persist timeframe analysis data (non-blocking, best-effort)
    if (multiTimeframeAnalysis && userId) {
      db.saveTimeframeAnalysis({
        userId,
        marketId: market.id,
        platform: "kalshi",
        timeframeAnalyses: multiTimeframeAnalysis.analyses.map((a) => ({
          timeframe: a.timeframe,
          momentum: a.momentum,
          volatility: a.volatility,
          volume: a.volume,
          trendStrength: a.trendStrength,
        })),
      }).catch((err) => {
        logger.debug({ err, marketId: market.id }, "Failed to persist timeframe analysis (non-critical)");
      });
    }
  }

  // Market microstructure analysis
  const microInput = {
    marketId: market.id,
    yesBid: market.yesPrice,
    yesAsk: 1 - market.noPrice,
    volume24h: (market.yesVolume ?? 0) + (market.noVolume ?? 0),
    openInterest: 0,
    liquidity: 0,
  };
  const microResult = analyzeMicrostructure(microInput);

  // Persist microstructure non-blocking
  db.saveMicrostructure(microResult).catch((err: unknown) => {
    logger.debug({ marketId: market.id, err }, "microstructure save failed");
  });

  // Value play: detect mispriced markets.
  // Use category-aware prior instead of universal 0.5 fallback so value
  // signals reflect genuine mispricing rather than arbitrary baseline noise.
  const resolvedFundamental = resolveFundamentalPrior(market, fundamentalProbability);
  const usesFallbackFundamental = resolvedFundamental.source === "neutral_fallback";
  const baselineFundamentalProbability = clampProbability(resolvedFundamental.value);
  const valueOpportunity = detectValueOpportunity(market, baselineFundamentalProbability, 0.05);
  if (valueOpportunity) {
    const confidence = Math.min(
      0.95,
      Math.abs(baselineFundamentalProbability - market.impliedProbability) * 2
    );
    const reasoningPrefix =
      resolvedFundamental.source === "explicit"
        ? "Market mispriced"
        : resolvedFundamental.source === "category_prior"
          ? "Market mispriced (category prior)"
          : "Market mispriced (heuristic baseline)";
    const reasoning = `${reasoningPrefix}: ${valueOpportunity.side.toUpperCase()} probability ${(market.impliedProbability * 100).toFixed(1)}% vs ${resolvedFundamental.source === "explicit" ? "fundamental" : resolvedFundamental.source === "category_prior" ? "category prior" : "neutral baseline"} ${(baselineFundamentalProbability * 100).toFixed(1)}%`;
    if (isFinite(confidence) && isFinite(valueOpportunity.expectedValue)) {
      const category = resolveStrategyProfile(market);
      const bayesianProbability = initializeBayesianProbability(
        category,
        confidence,
        baselineFundamentalProbability,
        market.impliedProbability
      );
      
      signals.push({
        marketId: market.id,
        signalType: "value_play",
        side: valueOpportunity.side,
        confidence,
        bayesianProbability,
        reasoning,
        impliedProbability: market.impliedProbability,
        marketPrice: valueOpportunity.side === "yes" ? market.yesPrice : market.noPrice,
        expectedValue: valueOpportunity.expectedValue,
        metadata: {
          fundamentalProbability: baselineFundamentalProbability,
          fundamentalSource: resolvedFundamental.source === "neutral_fallback" ? "neutral_fallback" : "explicit",
          marketCategory: category,
        },
      });
    }
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
      const volumeConfidence = volumeMomentum > 0 ? 0.15 : -0.05; // Volume confirmation (boost if positive, slight penalty if negative)
      const confidence = Math.max(0.1, Math.min(0.95, momentumConfidence + volumeConfidence)); // Allow weaker signals (0.1 min)

      // Build a forecast probability distinct from the market implied
      // probability.  Passing impliedProbability into the EV function
      // collapses EV to zero algebraically (since entryPrice == implied
      // probability for a fairly-priced market), which is what previously
      // made every edge metric ~0.  We project the move forward by a
      // fraction of the observed momentum, scaled by volume confirmation.
      // Note: calculateExpectedValue takes a YES-perspective probability
      // and internally derives `1 - p` for the NO side, so we always pass
      // the YES-forecast regardless of the chosen side.
      const forecastBias = momentum * (volumeMomentum > 0 ? 0.5 : 0.25);
      const yesForecast = clampProbability(market.impliedProbability + forecastBias);
      const expectedVal = calculateExpectedValue(side, side === "yes" ? market.yesPrice : market.noPrice, 1, 1, yesForecast);
      if (isFinite(confidence) && isFinite(expectedVal)) {
        signals.push({
          marketId: market.id,
          signalType: "momentum",
          side,
          confidence,
          reasoning: `Strong ${side.toUpperCase()} momentum: ${(momentum * 100).toFixed(2)}% price move with ${(volumeMomentum * 100).toFixed(1)}% volume change`,
          impliedProbability: market.impliedProbability,
          marketPrice: side === "yes" ? market.yesPrice : market.noPrice,
          expectedValue: expectedVal,
          metadata: {
            priceMomentum: momentum,
            volumeMomentum,
            volatility,
          },
        });
      }
    }
  }

  if (
    sentimentOverlay &&
    sentimentOverlay.confidence >= 0.15 &&
    Math.abs(sentimentOverlay.overallSentiment) >= 0.2
  ) {
    const side: "yes" | "no" = sentimentOverlay.overallSentiment >= 0 ? "yes" : "no";
    const marketPrice = side === "yes" ? market.yesPrice : market.noPrice;
    const sentimentProbability = clampProbability(
      market.impliedProbability + sentimentOverlay.overallSentiment * 0.18
    );
    const expectedValue = calculateExpectedValue(
      side,
      marketPrice,
      1,
      1,
      sentimentProbability
    );

    if (Number.isFinite(expectedValue)) {
      signals.push({
        marketId: market.id,
        signalType: "sentiment",
        side,
        confidence: Math.max(
          0.1,
          Math.min(
            0.9,
            Math.abs(sentimentOverlay.overallSentiment) * 0.55 + sentimentOverlay.confidence * 0.45
          )
        ),
        reasoning: `Composite sentiment favors ${side.toUpperCase()} with ${Math.abs(sentimentOverlay.overallSentiment).toFixed(2)} directional strength on topic ${sentimentContext?.topic ?? market.title}`,
        impliedProbability: market.impliedProbability,
        marketPrice,
        expectedValue,
        metadata: {
          sentimentScore: sentimentOverlay.overallSentiment,
          sentimentConfidence: sentimentOverlay.confidence,
          sentimentTopic: sentimentContext?.topic ?? market.title,
        },
      });
    }
  }

  // Contrarian: detect extreme positions ripe for reversal
  const contrarianOpportunity = detectContrarianOpportunity(market, 0.1);
  if (contrarianOpportunity) {
    // Contrarian thesis: extreme markets mean-revert.  Project a partial
    // reversion target so EV is computed against an actual forecast rather
    // than the market's own implied probability (which would collapse EV
    // to ~0).  We mean-revert ~25% of the distance back toward 0.5.
    const reversionTarget = clampProbability(
      market.impliedProbability + (0.5 - market.impliedProbability) * 0.25
    );
    signals.push({
      marketId: market.id,
      signalType: "contrarian",
      side: contrarianOpportunity.side,
      confidence: contrarianOpportunity.confidence,
      reasoning: `Extreme market condition: ${(market.impliedProbability * 100).toFixed(1)}% probability suggests ${contrarianOpportunity.side.toUpperCase()} reversal opportunity`,
      impliedProbability: market.impliedProbability,
      marketPrice: contrarianOpportunity.side === "yes" ? market.yesPrice : market.noPrice,
      expectedValue: calculateExpectedValue(contrarianOpportunity.side, contrarianOpportunity.side === "yes" ? market.yesPrice : market.noPrice, 1, 1, reversionTarget),
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

  // Multi-timeframe signal: generate dedicated signal when 3+ timeframes align
  if (multiTimeframeAnalysis && shouldGenerateMultiTimeframeSignal(multiTimeframeAnalysis)) {
    const side = getMomentumDirection(multiTimeframeAnalysis);
    const confidence = calculateAverageConfidence(
      multiTimeframeAnalysis,
      multiTimeframeAnalysis.timeframeAlignment
    );
    const marketPrice = side === "yes" ? market.yesPrice : market.noPrice;
    
    // Project forward based on combined trend strength
    const forecastBias = multiTimeframeAnalysis.combinedTrendStrength * 0.05 * (side === "yes" ? 1 : -1);
    const yesForecast = clampProbability(market.impliedProbability + forecastBias);
    const expectedVal = calculateExpectedValue(side, marketPrice, 1, 1, yesForecast);

    if (Number.isFinite(expectedVal)) {
      const timeframeLabels = multiTimeframeAnalysis.timeframeAlignment
        .map((tf) => timeframeToLabel(tf as Timeframe))
        .join(", ");

      signals.push({
        marketId: market.id,
        signalType: "multi_timeframe",
        side,
        confidence,
        reasoning: `Multi-timeframe confluence: ${multiTimeframeAnalysis.timeframeAlignment.length} timeframes (${timeframeLabels}) align on ${side.toUpperCase()} with ${(multiTimeframeAnalysis.confluenceScore * 100).toFixed(0)}% correlation and combined TSI of ${multiTimeframeAnalysis.combinedTrendStrength.toFixed(2)}`,
        impliedProbability: market.impliedProbability,
        marketPrice,
        expectedValue: expectedVal,
        metadata: {
          timeframeAlignment: multiTimeframeAnalysis.timeframeAlignment,
          confluenceScore: multiTimeframeAnalysis.confluenceScore,
          trendStrengthPerTimeframe: multiTimeframeAnalysis.trendStrengthPerTimeframe,
        },
      });
    }
  }


  const sentimentAdjustedSignals = sentimentOverlay
    ? signals.map((signal) =>
        applySentimentOverlay(
          signal,
          sentimentOverlay!.overallSentiment,
          sentimentOverlay!.confidence,
          sentimentContext?.topic ?? market.title
        )
      )
    : signals;

  // Apply multi-timeframe confidence boost when confluence detected
  const multiTimeframeBoostedSignals = multiTimeframeAnalysis?.hasConfluence
    ? sentimentAdjustedSignals.map((signal) => {
        // Only boost non-multi_timeframe signals
        if (signal.signalType === "multi_timeframe") {
          return signal;
        }

        const boostedConfidence = calculateConfidenceBoost(
          signal.confidence,
          multiTimeframeAnalysis.confluenceScore,
          true
        );

        return {
          ...signal,
          confidence: boostedConfidence,
          reasoning: `${signal.reasoning} | Multi-timeframe confluence boost: ${multiTimeframeAnalysis.timeframeAlignment.length} aligned timeframes increase confidence`,
          metadata: {
            ...signal.metadata,
            timeframeAlignment: multiTimeframeAnalysis.timeframeAlignment,
            confluenceScore: multiTimeframeAnalysis.confluenceScore,
            trendStrengthPerTimeframe: multiTimeframeAnalysis.trendStrengthPerTimeframe,
          },
        };
      })
    : sentimentAdjustedSignals;

  const withLiquidity = multiTimeframeBoostedSignals
    .map((signal) => ({
      ...signal,
      metadata: {
        ...signal.metadata,
        marketCategory: market.category ?? "unknown",
        strategyProfile,
        resolutionDate: market.resolutionDate ?? undefined,
      },
    }))
    .map((signal) => attachLiquidityMetadata(signal, feed));

  // Apply microstructure quality adjustments
  const withMicrostructure = withLiquidity.map((s) => applyMicrostructureToSignal(s, microResult));

  // Generate order_flow signal when strong imbalance detected
  if (microResult.hasStrongImbalance) {
    const side = microResult.imbalanceDirection === "bullish" ? "yes" : "no";
    withMicrostructure.push({
      marketId: market.id,
      signalType: "order_flow",
      side,
      confidence: Math.min(0.5 + Math.abs(microResult.imbalance) * 0.3, 0.85),
      reasoning: `Order flow imbalance ${microResult.imbalance.toFixed(2)} suggests ${microResult.imbalanceDirection} pressure. VPIN=${microResult.vpin.toFixed(2)}.`,
      impliedProbability: market.impliedProbability,
      marketPrice: market.yesPrice,
      expectedValue: side === "yes" ? market.yesPrice * 0.1 : (1 - market.yesPrice) * 0.1,
      metadata: {
        microstructureScore: microResult.microstructureScore,
        spreadPct: microResult.spreadPct,
      },
    });
  }

  const withPlatformProfile = withMicrostructure.map((signal) =>
    applyKalshiPlatformBehaviorAdjustment(signal, market.category, platformPerformance)
  );

  // Pre-event boost: markets resolving in 2–24 h in high-signal categories get
  // a modest confidence lift to surface them over longer-horizon alternatives.
  const withPreEvent = applyPreEventBoost(withPlatformProfile, market.resolutionDate, market.category);

  // Apply confluence combining: when multiple independent signal types agree on
  // direction, merge them into a single higher-conviction signal so the execution
  // scorer can concentrate capital on the strongest opportunities.
  return consolidateSignalsForMarket(withPreEvent);
}

/**
 * Generate signals for multiple markets
 */
export async function generateSignalsForMarkets(
  markets: KalshiMarket[],
  feeds?: Map<string, MarketFeed>,
  fundamentalProbabilities?: Map<string, number>,
  sentimentContexts?: Map<string, MarketSentimentContext>,
  userId?: number,
  ensembleModel?: EnsembleModel,
  platformPerformance?: KalshiPlatformPerformanceSnapshot
): Promise<KalshiSignal[]> {
  const allSignals: KalshiSignal[] = [];

  for (const market of markets) {
    const feed = feeds?.get(market.id);
    const fundamentalProb = fundamentalProbabilities?.get(market.id);
    const sentimentContext = sentimentContexts?.get(market.id);
    const signals = await generateSignalsForMarket(
      market,
      feed,
      fundamentalProb,
      sentimentContext,
      userId,
      platformPerformance
    );

    if (ensembleModel) {
      for (const signal of signals) {
        const features = extractFeatures(signal);
        const mlProb = predictEnsemble(ensembleModel, features);
        const ruleProbability = signal.bayesianProbability ?? signal.confidence;
        signal.mlEnsembleProbability = blendProbabilities(mlProb, ruleProbability);
      }
    }

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

export function filterSignalsByMarketConditions(
  signals: KalshiSignal[],
  feeds?: Map<string, MarketFeed>,
  minLiquidityScore: number = 0.35
): KalshiSignal[] {
  return signals.filter((signal) => {
    const hasFiniteCoreFields =
      Number.isFinite(signal.marketPrice) &&
      Number.isFinite(signal.impliedProbability) &&
      Number.isFinite(signal.expectedValue);

    if (!hasFiniteCoreFields) {
      return false;
    }

    const hasActionablePricing =
      signal.marketPrice > 0.01 &&
      signal.marketPrice < 0.99 &&
      signal.impliedProbability > 0.01 &&
      signal.impliedProbability < 0.99 &&
      signal.expectedValue > 0;

    if (!hasActionablePricing) {
      return false;
    }

    const metadataLiquidity = signal.metadata?.liquidityScore;
    if (typeof metadataLiquidity === "number") {
      return metadataLiquidity >= minLiquidityScore;
    }

    const feed = feeds?.get(signal.marketId);
    return getLiquidityProfile(feed).liquidityScore >= minLiquidityScore;
  });
}

/**
 * Score a signal for execution readiness
 * Returns a 0-1 score indicating how ready the signal is to trade
 */
export function scoreSignalForExecution(signal: KalshiSignal): number {
  const expectedValue = Math.max(0, Number.isFinite(signal.expectedValue) ? signal.expectedValue : 0);
  const normalizedEdge = Math.max(0, Math.min(1, expectedValue / 0.2));
  const liquidityScore = Math.max(
    0,
    Math.min(1, Number.isFinite(signal.metadata?.liquidityScore) ? (signal.metadata?.liquidityScore as number) : 0.5)
  );

  let score = signal.confidence * 0.6 + normalizedEdge * 0.25 + liquidityScore * 0.15;
  const strategyProfile = signal.metadata?.strategyProfile ?? "general_event";
  const strategyConfig = STRATEGY_PROFILES[strategyProfile];

  // Reward statistically stable styles; discount wider-variance styles.
  // Confluence signals get the biggest bonus because they represent multiple
  // independent confirmation layers.
  if (signal.signalType === "confluence") {
    const count = signal.metadata?.confluenceCount ?? 2;
    score += 0.08 + Math.min(0.06, (count - 2) * 0.03); // +0.08 base, +0.03 per extra type
  } else if (signal.signalType === "value_play") score += 0.06;
  else if (signal.signalType === "arbitrage") score += 0.04;
  else if (signal.signalType === "momentum") score -= 0.04;
  else if (signal.signalType === "contrarian") score -= 0.08;

  score += strategyConfig.executionAdjustment;

  if (liquidityScore < strategyConfig.minLiquidity) {
    score -= 0.08;
  }

  // Late-cycle tails near 0/1 are often harder to execute without adverse selection.
  if (signal.marketPrice <= 0.06 || signal.marketPrice >= 0.94) {
    score -= 0.08;
  } else if (signal.marketPrice <= 0.1 || signal.marketPrice >= 0.9) {
    score -= 0.04;
  }

  const spreadProxy = Number(signal.metadata?.spreadProxy ?? 0);
  if (Number.isFinite(spreadProxy)) {
    if (spreadProxy > 0.08) score -= 0.05;
    else if (spreadProxy > 0.04) score -= 0.02;
  }

  const totalVolume = Number(signal.metadata?.totalVolume ?? 0);
  if (Number.isFinite(totalVolume) && totalVolume >= 5000) {
    score += 0.03;
  }

  // Time-to-resolution factor: prefer markets with moderate time remaining.
  // Markets resolving very soon (< 2 h) are risky (adverse selection, thin
  // liquidity spike).  Markets resolving > 30 days out have a longer theta
  // drag and higher uncertainty; sweet-spot is 2 h – 7 days.
  const resolutionDate = signal.metadata?.resolutionDate;
  if (resolutionDate) {
    const hoursToResolution = (new Date(resolutionDate).getTime() - Date.now()) / (1000 * 60 * 60);
    if (Number.isFinite(hoursToResolution)) {
      if (hoursToResolution < 0) {
        // Already past resolution — penalise heavily; market should be settled.
        score -= 0.15;
      } else if (hoursToResolution < 2) {
        // Imminent resolution — execution adverse-selection risk is high.
        score -= 0.1;
      } else if (hoursToResolution <= 168) {
        // 2 h – 7 days: sweet spot, slight bonus.
        score += 0.04;
      } else if (hoursToResolution > 720) {
        // More than 30 days out: long time-horizon drag.
        score -= 0.04;
      }
    }
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Rank signals by execution readiness
 */
function isHeuristicBaselineSignal(signal: KalshiSignal): boolean {
  // Confluence signals are never considered baseline — they require ≥2 agreement
  if (signal.signalType === "confluence") return false;
  return (
    signal.metadata?.fundamentalSource === "neutral_fallback" ||
    signal.reasoning.includes("heuristic baseline") ||
    signal.reasoning.includes("neutral baseline 50.0%") ||
    (signal.signalType === "value_play" && signal.reasoning.includes("fundamental 50.0%"))
  );
}

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
  const ranked = rankSignalsByExecution(signals)
    .filter((s) => !isHeuristicBaselineSignal(s))
    .filter((s) => s.executionScore >= minExecutionScore);

  const bestByMarket = new Map<string, KalshiSignal & { executionScore: number }>();
  for (const signal of ranked) {
    if (!bestByMarket.has(signal.marketId)) {
      bestByMarket.set(signal.marketId, signal);
    }
  }

  return Array.from(bestByMarket.values()).slice(0, topN);
}

/**
 * Save a signal to the database
 */
export async function saveSignal(signal: KalshiSignal, userId: number): Promise<void> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "saveSignal userId");
  await db.createKalshiSignal({
    userId: scopedUserId,
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
export async function saveSignals(signals: KalshiSignal[], userId: number): Promise<void> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "saveSignals userId");
  await Promise.all(signals.map((s) => saveSignal(s, scopedUserId)));
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
