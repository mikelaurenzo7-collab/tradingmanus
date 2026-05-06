/**
 * Market Microstructure Analysis
 *
 * Analyzes bid-ask spread, order book imbalance, and trade flow toxicity
 * (VPIN proxy) using available scalar market data from Kalshi REST API.
 * Generates confidence adjustments and order_flow signals.
 */

import type { KalshiSignal } from "./kalshiSignals";
import { logger } from "./logger";

// ── Named constants ───────────────────────────────────────────────────────────

const SPREAD_WIDE_THRESHOLD = 0.05;        // >5% spread = low liquidity
const SPREAD_SCORE_SCALER = 10;            // spread score denominator
const IMBALANCE_STRONG_THRESHOLD = 0.6;    // strong directional imbalance
const CONFIDENCE_SPREAD_PENALTY = 0.20;    // confidence reduction for wide spread
const CONFIDENCE_IMBALANCE_BOOST = 0.15;   // confidence boost for aligned imbalance
const LARGE_ORDER_VOLUME_THRESHOLD = 500;  // volume24h threshold for large orders
const VOLUME_RATIO_CAP = 3;                // cap for volumeRatio calculation
const COMPOSITE_WEIGHT_SPREAD = 0.35;
const COMPOSITE_WEIGHT_IMBALANCE = 0.30;
const COMPOSITE_WEIGHT_VPIN = 0.20;
const COMPOSITE_WEIGHT_INFORMED = 0.15;

// ── Input / Output types ──────────────────────────────────────────────────────

export interface MicrostructureInput {
  marketId: string;
  yesBid: number;      // best bid price 0-1
  yesAsk: number;      // best ask price 0-1
  volume24h: number;   // 24h volume (yesVolume + noVolume)
  openInterest: number;
  liquidity: number;   // liquidity score
}

export interface MicrostructureResult {
  marketId: string;
  spread: number;
  spreadPct: number;
  spreadScore: number;            // 0-1, higher = tighter spread
  imbalance: number;              // -1 to 1, positive = bid pressure
  vpin: number;                   // 0-1, higher = more informed trading
  microstructureScore: number;    // 0-1 composite
  hasWidespread: boolean;         // spreadPct > 0.05
  hasStrongImbalance: boolean;    // |imbalance| > 0.6
  imbalanceDirection: "bullish" | "bearish" | "neutral";
  confidenceAdjustment: number;   // -0.20 to +0.15
  informedTradingScore: number;   // 0-1, higher = more likely informed trading
  largeOrderDetected: boolean;    // true when volume24h > 500
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

// ── Core analysis ─────────────────────────────────────────────────────────────

/**
 * Analyze market microstructure from scalar bid/ask data.
 *
 * Because the Kalshi REST API only exposes best-bid/best-ask scalars (no
 * depth ladders), every measure is approximated from those two prices plus
 * aggregate volume metrics.
 */
export function analyzeMicrostructure(input: MicrostructureInput): MicrostructureResult {
  const { marketId, yesBid, yesAsk, volume24h, openInterest } = input;

  // ── Spread ────────────────────────────────────────────────────────────────
  const spread = Math.max(0, yesAsk - yesBid);
  const epsilon = 1e-9;
  const spreadPct = yesBid < epsilon ? 0 : spread / yesBid;
  const spreadScore = clamp(1 - spreadPct * SPREAD_SCORE_SCALER, 0, 1);
  const hasWidespread = spreadPct > SPREAD_WIDE_THRESHOLD;

  // ── Volume weight for imbalance ───────────────────────────────────────────
  // Kalshi REST does not provide bid/ask depth separately, so we use volume24h
  // and openInterest as a confidence weight: high turnover → price signal is
  // more reliable.  volumeRatio in [0, 3], volumeWeight in [0, 1].
  const volumeSurge = volume24h / (openInterest + 1);
  const volumeRatio = clamp(volumeSurge, 0, VOLUME_RATIO_CAP);
  const volumeWeight = clamp(volumeRatio / VOLUME_RATIO_CAP, 0, 1);

  // ── Order-book imbalance (volume-weighted price-position proxy) ───────────
  // Ask-side approximation is the complement of the ask price from the NO
  // perspective: (1 - yesAsk) represents how much of the book is on the
  // ask side.  The price imbalance is then scaled by (0.5 + 0.5*volumeWeight)
  // so that low-volume markets contribute less signal.  Range stays [-1, 1].
  const bidSide = Math.max(0, yesBid);
  const askSide = Math.max(0, 1 - yesAsk);
  const imbalanceDenom = bidSide + askSide + epsilon;
  const priceImbalance = clamp((bidSide - askSide) / imbalanceDenom, -1, 1);
  const imbalance = clamp(priceImbalance * (0.5 + 0.5 * volumeWeight), -1, 1);
  const hasStrongImbalance = Math.abs(imbalance) > IMBALANCE_STRONG_THRESHOLD;
  const imbalanceDirection: "bullish" | "bearish" | "neutral" = hasStrongImbalance
    ? imbalance > 0
      ? "bullish"
      : "bearish"
    : "neutral";

  // ── VPIN proxy ────────────────────────────────────────────────────────────
  // For binary prediction markets, informed traders push prices toward extremes
  // (0 or 1) as they gain conviction. Price distance from the neutral 0.5
  // midpoint serves as a proxy for informed trading pressure: VPIN=0 at
  // yesBid=0.5 (maximum uncertainty), VPIN=1 at yesBid=0 or 1 (fully informed).
  const vpin = clamp(Math.abs(yesBid - 0.5) * 2, 0, 1);

  // ── Informed trading detection ────────────────────────────────────────────
  // Proxies for large/aggressive order detection using available scalar data.
  // volumeSurge (already computed above) measures turnover vs open interest.
  const largeOrderDetected = volume24h > LARGE_ORDER_VOLUME_THRESHOLD;
  const informedTradingScore = clamp(
    0.5 * volumeWeight + 0.5 * (largeOrderDetected ? 0.8 : 0.2),
    0,
    1
  );

  // ── Composite score ───────────────────────────────────────────────────────
  // 35% spread quality + 30% imbalance (normalized to [0,1]) + 20% inverse VPIN
  // + 15% informed trading score
  const imbalanceNorm = (imbalance + 1) / 2;
  const microstructureScore = clamp(
    COMPOSITE_WEIGHT_SPREAD * spreadScore +
      COMPOSITE_WEIGHT_IMBALANCE * imbalanceNorm +
      COMPOSITE_WEIGHT_VPIN * (1 - vpin) +
      COMPOSITE_WEIGHT_INFORMED * informedTradingScore,
    0,
    1
  );

  // ── Confidence adjustment ─────────────────────────────────────────────────
  // Wide spread takes priority; strong imbalance boost applied otherwise.
  // Signal-direction matching is resolved in applyMicrostructureToSignal.
  let confidenceAdjustment = 0;
  if (hasWidespread) {
    confidenceAdjustment = -CONFIDENCE_SPREAD_PENALTY;
  } else if (hasStrongImbalance) {
    confidenceAdjustment = +CONFIDENCE_IMBALANCE_BOOST;
  }

  logger.debug(
    { marketId, spread: spread.toFixed(4), spreadPct: spreadPct.toFixed(4), imbalance: imbalance.toFixed(3), vpin: vpin.toFixed(3), microstructureScore: microstructureScore.toFixed(3), informedTradingScore: informedTradingScore.toFixed(3), largeOrderDetected },
    "microstructure analysis"
  );

  if (hasWidespread) {
    logger.warn({ marketId, spreadPct: spreadPct.toFixed(4) }, "wide spread detected — confidence penalty applied");
  }

  return {
    marketId,
    spread,
    spreadPct,
    spreadScore,
    imbalance,
    vpin,
    microstructureScore,
    hasWidespread,
    hasStrongImbalance,
    imbalanceDirection,
    confidenceAdjustment,
    informedTradingScore,
    largeOrderDetected,
  };
}

/**
 * Apply microstructure quality adjustments to a signal.
 *
 * Rules:
 * - Wide spread (spreadPct > 5%): always apply -0.20 penalty.
 * - Strong imbalance in the SAME direction as the signal: apply +0.15 boost.
 * - Strong imbalance in the OPPOSITE direction: no adjustment (0).
 * - No strong features: no adjustment (0).
 *
 * Confidence is clamped to [0.05, 0.95] after adjustment.
 * Metadata fields `microstructureScore` and `spreadPct` are always added.
 */
export function applyMicrostructureToSignal(
  signal: KalshiSignal,
  result: MicrostructureResult
): KalshiSignal {
  // Determine direction-aware adjustment
  let adjustment = 0;
  if (result.hasWidespread) {
    adjustment = -CONFIDENCE_SPREAD_PENALTY;
  } else if (result.hasStrongImbalance) {
    // Only boost if imbalance direction matches the signal side
    const signalBullish = signal.side === "yes";
    const imbalanceBullish = result.imbalanceDirection === "bullish";
    if (signalBullish === imbalanceBullish) {
      adjustment = +CONFIDENCE_IMBALANCE_BOOST;
    }
    // Opposite direction → no adjustment (leave at 0)
  }

  const newConfidence = clamp(signal.confidence + adjustment, 0.05, 0.95);

  return {
    ...signal,
    confidence: newConfidence,
    metadata: {
      ...signal.metadata,
      microstructureScore: result.microstructureScore,
      spreadPct: result.spreadPct,
    },
  };
}
