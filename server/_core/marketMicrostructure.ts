/**
 * Market Microstructure Analysis
 *
 * Analyzes bid-ask spread, order book imbalance, and trade flow toxicity
 * (VPIN proxy) using available scalar market data from Kalshi REST API.
 * Generates confidence adjustments and order_flow signals.
 */

import type { KalshiSignal } from "./kalshiSignals";
import { logger } from "./logger";

// ── Input / Output types ──────────────────────────────────────────────────────

export interface MicrostructureInput {
  marketId: string;
  yesBid: number;      // best bid price 0-1
  yesAsk: number;      // best ask price 0-1
  volume: number;      // total volume
  volume24h: number;   // 24h volume
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
  const { marketId, yesBid, yesAsk } = input;

  // ── Spread ────────────────────────────────────────────────────────────────
  const spread = Math.max(0, yesAsk - yesBid);
  const epsilon = 1e-9;
  const spreadPct = yesBid < epsilon ? 0 : spread / yesBid;
  const spreadScore = clamp(1 - spreadPct * 10, 0, 1);
  const hasWidespread = spreadPct > 0.05;

  // ── Order-book imbalance (price-position proxy) ───────────────────────────
  // Ask-side approximation is the complement of the ask price from the NO
  // perspective: (1 - yesAsk) represents how much of the book is on the
  // ask side.  This gives an imbalance in [-1, 1].
  const bidSide = Math.max(0, yesBid);
  const askSide = Math.max(0, 1 - yesAsk);
  const imbalanceDenom = bidSide + askSide + epsilon;
  const imbalance = clamp((bidSide - askSide) / imbalanceDenom, -1, 1);
  const hasStrongImbalance = Math.abs(imbalance) > 0.6;
  const imbalanceDirection: "bullish" | "bearish" | "neutral" = hasStrongImbalance
    ? imbalance > 0
      ? "bullish"
      : "bearish"
    : "neutral";

  // ── VPIN proxy ────────────────────────────────────────────────────────────
  // Without tick data we estimate buy fraction from price position between
  // bid and ask.  The midprice relative to bid/ask gives a [0,1] proxy of
  // buy-side dominance.  VPIN = |2 * buyFraction - 1|.
  const spreadForVpin = spread + epsilon;
  const midPrice = (yesBid + yesAsk) / 2;
  const buyFraction = clamp((midPrice - yesBid) / spreadForVpin, 0, 1);
  const vpin = clamp(Math.abs(2 * buyFraction - 1), 0, 1);

  // ── Composite score ───────────────────────────────────────────────────────
  // 40% spread quality + 35% imbalance (normalized to [0,1]) + 25% inverse VPIN
  const imbalanceNorm = (imbalance + 1) / 2;
  const microstructureScore = clamp(
    0.4 * spreadScore + 0.35 * imbalanceNorm + 0.25 * (1 - vpin),
    0,
    1
  );

  // ── Confidence adjustment ─────────────────────────────────────────────────
  // Wide spread takes priority; strong imbalance boost applied otherwise.
  // Signal-direction matching is resolved in applyMicrostructureToSignal.
  let confidenceAdjustment = 0;
  if (hasWidespread) {
    confidenceAdjustment = -0.20;
  } else if (hasStrongImbalance) {
    confidenceAdjustment = +0.15;
  }

  logger.debug(
    { marketId, spread: spread.toFixed(4), spreadPct: spreadPct.toFixed(4), imbalance: imbalance.toFixed(3), vpin: vpin.toFixed(3), microstructureScore: microstructureScore.toFixed(3) },
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
    adjustment = -0.20;
  } else if (result.hasStrongImbalance) {
    // Only boost if imbalance direction matches the signal side
    const signalBullish = signal.side === "yes";
    const imbalanceBullish = result.imbalanceDirection === "bullish";
    if (signalBullish === imbalanceBullish) {
      adjustment = +0.15;
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
