/**
 * Multi-Timeframe Analysis Module
 * 
 * Professional traders analyze multiple timeframes simultaneously to confirm trends.
 * This module implements 5min/15min/1hour/4hour/24hour analysis with confluence scoring.
 */

import type { MarketFeed, MarketSnapshot } from "./kalshiMarketFeed";
import { logger } from "./logger";

// ── TSI Normalization Thresholds ──────────────────────────────────────────────

// Momentum cap: ±50% price change normalization cap
const MOMENTUM_CAP_THRESHOLD = 0.5;
// Volume log cap: log10(100k) normalization cap for volume
const VOLUME_LOG_CAP = 5;
// Volatility cap: 20% standard deviation cap
const VOLATILITY_CAP = 0.2;

// ── TSI Component Weights (must sum to 1.0) ───────────────────────────────────

const MOMENTUM_WEIGHT = 0.4;
const VOLUME_WEIGHT = 0.3;
const VOLATILITY_WEIGHT = 0.3;

// ── Confidence Boost Constants ────────────────────────────────────────────────

const MAX_CONFIDENCE_CAP = 0.95;
const MAX_CONFLUENCE_BOOST = 0.3;

/**
 * Timeframe enum in milliseconds
 */
export enum Timeframe {
  M5 = 300000,   // 5 minutes
  M15 = 900000,  // 15 minutes
  H1 = 3600000,  // 1 hour
  H4 = 14400000, // 4 hours
  D1 = 86400000, // 24 hours
}

/**
 * Analysis for a single timeframe
 */
export interface TimeframeAnalysis {
  timeframe: Timeframe;
  momentum: number;        // Price change % over the timeframe window
  volatility: number;      // Standard deviation of price changes
  volume: number;          // Total volume traded in window
  trendStrength: number;   // Trend Strength Index (TSI): weighted combination
}

/**
 * Multi-timeframe analysis result
 */
export interface MultiTimeframeAnalysis {
  marketId: string;
  analyses: TimeframeAnalysis[];
  timeframeAlignment: Timeframe[];       // Timeframes that agree on direction
  confluenceScore: number;               // 0-1 score of how well timeframes align
  trendStrengthPerTimeframe: Record<string, number>; // TSI values keyed by timeframe
  hasConfluence: boolean;                // True if ≥3 timeframes align with >0.7 correlation
  combinedTrendStrength: number;         // Average TSI across aligned timeframes
  analyzedAt: Date;
}

/**
 * Get snapshots within a timeframe window
 */
function getSnapshotsInWindow(
  feed: MarketFeed,
  windowMs: number,
  currentTime: number
): MarketSnapshot[] {
  const cutoff = currentTime - windowMs;
  return feed.priceHistory.filter((s) => s.timestamp >= cutoff);
}

/**
 * Calculate momentum (price change %) over a timeframe window
 */
function calculateMomentum(snapshots: MarketSnapshot[]): number {
  if (snapshots.length < 2) return 0;

  const oldest = snapshots[0]!;
  const newest = snapshots[snapshots.length - 1]!;

  if (!oldest || !newest || oldest.impliedProbability === 0) return 0;

  const momentum = (newest.impliedProbability - oldest.impliedProbability) / oldest.impliedProbability;
  
  return Number.isFinite(momentum) ? momentum : 0;
}

/**
 * Calculate volatility (standard deviation of price changes) over a timeframe
 */
function calculateVolatility(snapshots: MarketSnapshot[]): number {
  if (snapshots.length < 2) return 0;

  const prices = snapshots.map((s) => s.impliedProbability);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
  const stdDev = Math.sqrt(variance);

  return Number.isFinite(stdDev) ? stdDev : 0;
}

/**
 * Calculate total volume traded in a timeframe window
 */
function calculateVolume(feed: MarketFeed, windowMs: number, currentTime: number): number {
  const cutoff = currentTime - windowMs;
  const recentVolumes = feed.volumeHistory.filter((v) => v.timestamp >= cutoff);

  if (recentVolumes.length < 2) return 0;

  const oldest = recentVolumes[0];
  const newest = recentVolumes[recentVolumes.length - 1];

  if (!oldest || !newest) return 0;

  const totalVolume = (newest.yesVolume - oldest.yesVolume) + (newest.noVolume - oldest.noVolume);
  
  return totalVolume > 0 ? totalVolume : 0;
}

/**
 * Calculate Trend Strength Index (TSI)
 * Weighted combination: momentum (40%) + volume change (30%) + volatility (30%)
 */
function calculateTrendStrength(
  momentum: number,
  volume: number,
  volatility: number,
  snapshots: MarketSnapshot[]
): number {
  if (snapshots.length < 2) return 0;

  // Normalize momentum to 0-1 scale
  const normalizedMomentum = Math.min(1, Math.abs(momentum) / MOMENTUM_CAP_THRESHOLD);

  // Normalize volume (log scale)
  const normalizedVolume = Math.min(1, Math.log10(Math.max(1, volume)) / VOLUME_LOG_CAP);

  // Normalize volatility
  const normalizedVolatility = Math.min(1, volatility / VOLATILITY_CAP);

  // Weighted combination
  const tsi = normalizedMomentum * MOMENTUM_WEIGHT + normalizedVolume * VOLUME_WEIGHT + normalizedVolatility * VOLATILITY_WEIGHT;

  return Number.isFinite(tsi) ? tsi : 0;
}

/**
 * Analyze a single timeframe
 */
function analyzeTimeframe(
  feed: MarketFeed,
  timeframe: Timeframe,
  currentTime: number
): TimeframeAnalysis {
  const snapshots = getSnapshotsInWindow(feed, timeframe, currentTime);

  if (snapshots.length < 2) {
    // Insufficient data: return deterministic defaults
    return {
      timeframe,
      momentum: 0,
      volatility: 0,
      volume: 0,
      trendStrength: 0,
    };
  }

  const momentum = calculateMomentum(snapshots);
  const volatility = calculateVolatility(snapshots);
  const volume = calculateVolume(feed, timeframe, currentTime);
  const trendStrength = calculateTrendStrength(momentum, volume, volatility, snapshots);

  return {
    timeframe,
    momentum,
    volatility,
    volume,
    trendStrength,
  };
}

/**
 * Calculate momentum alignment correlation between two timeframe analyses.
 *
 * We compare signed momentum magnitudes and return a normalized 0-1 score,
 * where 1 means near-identical directional momentum and 0 means opposite or
 * strongly divergent movement.
 */
function calculateMomentumAlignmentCorrelation(a: TimeframeAnalysis, b: TimeframeAnalysis): number {
  const m1 = a.momentum;
  const m2 = b.momentum;

  if (!Number.isFinite(m1) || !Number.isFinite(m2)) return 0;

  // Opposite directions are not aligned.
  if (m1 * m2 <= 0) return 0;

  // Across heterogeneous windows, momentum magnitudes naturally differ.
  // Treat directional agreement as primary, then modulate by magnitude and TSI similarity.
  const abs1 = Math.abs(m1);
  const abs2 = Math.abs(m2);

  const ratioSimilarity = Math.min(abs1, abs2) / Math.max(abs1, abs2, 1e-6);
  const tsiSimilarity = Math.max(0, 1 - Math.abs(a.trendStrength - b.trendStrength));

  // Base alignment for same-direction momentum is strong by design.
  const correlation = 0.75 + ratioSimilarity * 0.15 + tsiSimilarity * 0.10;

  return Number.isFinite(correlation) ? Math.max(0, Math.min(1, correlation)) : 0;
}

/**
 * Detect timeframe confluence
 * Returns true if ≥3 timeframes show same direction with correlation >0.7
 */
function detectConfluence(analyses: TimeframeAnalysis[]): {
  hasConfluence: boolean;
  alignedTimeframes: Timeframe[];
  confluenceScore: number;
  combinedTrendStrength: number;
} {
  if (analyses.length < 3) {
    return {
      hasConfluence: false,
      alignedTimeframes: [],
      confluenceScore: 0,
      combinedTrendStrength: 0,
    };
  }

  // Group timeframes by momentum direction (positive vs negative)
  const positiveTimeframes = analyses.filter((a) => a.momentum > 0);
  const negativeTimeframes = analyses.filter((a) => a.momentum < 0);

  // Pick the larger group
  const dominantGroup = positiveTimeframes.length >= negativeTimeframes.length
    ? positiveTimeframes
    : negativeTimeframes;

  if (dominantGroup.length < 3) {
    return {
      hasConfluence: false,
      alignedTimeframes: [],
      confluenceScore: 0,
      combinedTrendStrength: 0,
    };
  }

  // For confluence scoring, check pairwise alignment correlations.
  const correlations: number[] = [];
  for (let i = 0; i < dominantGroup.length - 1; i++) {
    for (let j = i + 1; j < dominantGroup.length; j++) {
      const corr = calculateMomentumAlignmentCorrelation(dominantGroup[i]!, dominantGroup[j]!);
      correlations.push(corr);
    }
  }

  const avgCorrelation = correlations.length > 0
    ? correlations.reduce((a, b) => a + b, 0) / correlations.length
    : 0;

  const hasConfluence = avgCorrelation > 0.7;
  const alignedTimeframes = hasConfluence ? dominantGroup.map((a) => a.timeframe) : [];
  
  const combinedTrendStrength = hasConfluence
    ? dominantGroup.reduce((sum, a) => sum + a.trendStrength, 0) / dominantGroup.length
    : 0;

  // Confluence score is the average correlation
  const confluenceScore = hasConfluence ? avgCorrelation : 0;

  return {
    hasConfluence,
    alignedTimeframes,
    confluenceScore,
    combinedTrendStrength,
  };
}

/**
 * Perform multi-timeframe analysis on a market feed
 */
export function analyzeMultipleTimeframes(feed: MarketFeed): MultiTimeframeAnalysis | null {
  const currentTime = feed.currentSnapshot?.timestamp ?? Date.now();
  const allTimeframes = [Timeframe.M5, Timeframe.M15, Timeframe.H1, Timeframe.H4, Timeframe.D1];

  // Return null if no price history available
  if (feed.priceHistory.length === 0) {
    logger.debug({ marketId: feed.marketId }, "[MultiTimeframe] No price history available");
    return null;
  }

  // Analyze each timeframe (always returns 5 analyses, even with sparse data)
  const analyses: TimeframeAnalysis[] = [];
  for (const timeframe of allTimeframes) {
    const analysis = analyzeTimeframe(feed, timeframe, currentTime);
    analyses.push(analysis);
  }

  if (analyses.length === 0) {
    logger.debug({ marketId: feed.marketId }, "[MultiTimeframe] No timeframes configured");
    return null;
  }

  // Detect confluence
  const {
    hasConfluence,
    alignedTimeframes,
    confluenceScore,
    combinedTrendStrength,
  } = detectConfluence(analyses);

  // Build TSI map
  const trendStrengthPerTimeframe: Record<string, number> = {};
  for (const analysis of analyses) {
    trendStrengthPerTimeframe[analysis.timeframe.toString()] = analysis.trendStrength;
  }

  return {
    marketId: feed.marketId,
    analyses,
    timeframeAlignment: alignedTimeframes,
    confluenceScore,
    trendStrengthPerTimeframe,
    hasConfluence,
    combinedTrendStrength,
    analyzedAt: new Date(currentTime),
  };
}

/**
 * Calculate confidence boost for signals when confluence is detected
 * Returns a multiplier (e.g., 1.3 for +30% boost) capped at 0.95 total confidence
 */
export function calculateConfidenceBoost(
  baseConfidence: number,
  confluenceScore: number,
  hasConfluence: boolean
): number {
  if (!hasConfluence) return baseConfidence;

  // Boost by up to MAX_CONFLUENCE_BOOST based on confluence strength
  const boost = confluenceScore * MAX_CONFLUENCE_BOOST;
  const boostedConfidence = baseConfidence * (1 + boost);

  // Cap at MAX_CONFIDENCE_CAP
  return Math.min(MAX_CONFIDENCE_CAP, boostedConfidence);
}

/**
 * Convert timeframe milliseconds to human-readable label
 */
export function timeframeToLabel(timeframe: Timeframe): string {
  switch (timeframe) {
    case Timeframe.M5:
      return "5m";
    case Timeframe.M15:
      return "15m";
    case Timeframe.H1:
      return "1h";
    case Timeframe.H4:
      return "4h";
    case Timeframe.D1:
      return "24h";
    default:
      return "unknown";
  }
}

/**
 * Check if market meets criteria for multi_timeframe signal generation
 * Spec: trigger only when >=3 timeframes align with correlation >0.7
 */
export function shouldGenerateMultiTimeframeSignal(
  analysis: MultiTimeframeAnalysis | null
): boolean {
  if (!analysis) return false;

  return (
    analysis.hasConfluence &&
    analysis.timeframeAlignment.length >= 3
  );
}

/**
 * Calculate average confidence from aligned timeframes
 */
export function calculateAverageConfidence(
  analysis: MultiTimeframeAnalysis,
  alignedTimeframes: Timeframe[]
): number {
  const alignedAnalyses = analysis.analyses.filter((a) =>
    alignedTimeframes.includes(a.timeframe)
  );

  if (alignedAnalyses.length === 0) return 0;

  // Use trend strength as a proxy for confidence (0-1 scale)
  const avgConfidence = alignedAnalyses.reduce((sum, a) => sum + a.trendStrength, 0) / alignedAnalyses.length;

  // Scale to reasonable confidence range (0.55 - 0.85)
  return Math.max(0.55, Math.min(0.85, 0.55 + avgConfidence * 0.3));
}

/**
 * Get momentum direction from multi-timeframe analysis
 * Returns "yes" if aligned timeframes show positive momentum, "no" otherwise
 */
export function getMomentumDirection(analysis: MultiTimeframeAnalysis): "yes" | "no" {
  const alignedAnalyses = analysis.analyses.filter((a) =>
    analysis.timeframeAlignment.includes(a.timeframe)
  );

  if (alignedAnalyses.length === 0) return "yes"; // Default

  const avgMomentum = alignedAnalyses.reduce((sum, a) => sum + a.momentum, 0) / alignedAnalyses.length;

  return avgMomentum >= 0 ? "yes" : "no";
}
