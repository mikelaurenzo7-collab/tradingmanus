/**
 * Cross-Bot Strategy Engine
 *
 * Coordinates the Kalshi and Polymarket bots to:
 *   1. Merge signals from both platforms into a unified view with consensus detection.
 *   2. Execute both legs of a cross-platform arbitrage opportunity atomically.
 *
 * A "consensus" signal exists when both bots independently generate a signal
 * on the same underlying event in the same direction, which increases conviction.
 */

import type { KalshiSignal } from "./kalshiSignals";
import type { PolymarketSignal } from "./polymarketSignals";
import type { CrossPlatformArbitrageOpportunity } from "./crossPlatformArbitrage";
import { assessPartialLegRisk } from "./crossPlatformArbitrage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignalPlatform = "kalshi" | "polymarket";

export interface CrossBotSignal {
  platform: SignalPlatform;
  marketId: string;
  question: string;
  signalType: string;
  side: "yes" | "no";
  confidence: number;
  reasoning: string;
  impliedProbability: number;
  expectedValue: number;
  /** Present when a matching signal on the other platform corroborates this one */
  consensusPartner?: {
    platform: SignalPlatform;
    marketId: string;
    confidence: number;
    signalType: string;
  };
  /** Combined conviction score [0–1]: blends own confidence + consensus boost */
  convictionScore: number;
}

export interface CombinedPlatformSignals {
  signals: CrossBotSignal[];
  consensusCount: number;
  kalshiCount: number;
  polymarketCount: number;
  topConviction: CrossBotSignal | null;
}

export type CrossArbExecutionResult = {
  success: boolean;
  kalshiLeg: {
    attempted: boolean;
    success: boolean;
    orderId?: string;
    error?: string;
  };
  polymarketLeg: {
    attempted: boolean;
    success: boolean;
    orderId?: string;
    error?: string;
  };
  bothLegsExecuted: boolean;
  partialLegAction?: "hold" | "hedge" | "exit";
  unhedgedFraction?: number;
  reasoning: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maximum conviction boost added when a consensus partner is found */
const MAX_CONSENSUS_BOOST = 0.15;
/** How much of the Jaccard similarity score maps to conviction boost */
const SIMILARITY_BOOST_MULTIPLIER = 0.3;

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Jaccard word-overlap similarity between two strings.
 */
function similarity(a: string, b: string): number {
  const wordsA = new Set(normalise(a).split(" ").filter(Boolean));
  const wordsB = new Set(normalise(b).split(" ").filter(Boolean));

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of Array.from(wordsA)) {
    if (wordsB.has(w)) intersection++;
  }

  return intersection / (wordsA.size + wordsB.size - intersection);
}

// ---------------------------------------------------------------------------
// Signal merging
// ---------------------------------------------------------------------------

/**
 * Merge Kalshi and Polymarket signals into a unified, sorted list.
 *
 * For each signal, check whether there is a corresponding signal on the other
 * platform (same direction, similar question).  If yes, mark both as having a
 * consensus partner and boost the conviction score.
 */
export function mergePlatformSignals(
  kalshiSignals: KalshiSignal[],
  polymarketSignals: PolymarketSignal[],
  options: {
    /** Minimum question similarity to consider two signals correlated [0–1] */
    minSimilarity?: number;
    /** Minimum signal confidence to include */
    minConfidence?: number;
    /** Optional map from Kalshi marketId → human-readable title */
    kalshiTitles?: Map<string, string>;
  } = {},
): CombinedPlatformSignals {
  const { minSimilarity = 0.25, minConfidence = 0.5, kalshiTitles } = options;

  // Build cross-bot signals from Kalshi
  const crossKalshi: CrossBotSignal[] = kalshiSignals
    .filter((s) => s.confidence >= minConfidence)
    .map((s) => ({
      platform: "kalshi" as const,
      marketId: s.marketId,
      question: kalshiTitles?.get(s.marketId) ?? s.marketId,
      signalType: s.signalType,
      side: s.side,
      confidence: s.confidence,
      reasoning: s.reasoning,
      impliedProbability: s.impliedProbability,
      expectedValue: s.expectedValue,
      convictionScore: s.confidence,
    }));

  // Build cross-bot signals from Polymarket
  const crossPolymarket: CrossBotSignal[] = polymarketSignals
    .filter((s) => s.confidence >= minConfidence)
    .map((s) => ({
      platform: "polymarket" as const,
      marketId: s.marketId,
      question: s.question,
      signalType: s.signalType,
      side: s.side,
      confidence: s.confidence,
      reasoning: s.reasoning,
      impliedProbability: s.impliedProbabilityYes,
      expectedValue: s.expectedValue,
      convictionScore: s.confidence,
    }));

  // Cross-reference: find consensus pairs
  let consensusCount = 0;

  for (const ks of crossKalshi) {
    let bestScore = minSimilarity - 0.001;
    let bestMatch: CrossBotSignal | null = null;

    for (const ps of crossPolymarket) {
      if (ps.side !== ks.side) continue; // must agree on direction
      const score = similarity(ks.question, ps.question);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = ps;
      }
    }

    if (bestMatch) {
      const boost = Math.min(MAX_CONSENSUS_BOOST, bestScore * SIMILARITY_BOOST_MULTIPLIER);
      ks.consensusPartner = {
        platform: "polymarket",
        marketId: bestMatch.marketId,
        confidence: bestMatch.confidence,
        signalType: bestMatch.signalType,
      };
      ks.convictionScore = Math.min(1, ks.confidence + boost);

      bestMatch.consensusPartner = {
        platform: "kalshi",
        marketId: ks.marketId,
        confidence: ks.confidence,
        signalType: ks.signalType,
      };
      bestMatch.convictionScore = Math.min(1, bestMatch.confidence + boost);

      consensusCount++;
    }
  }

  const all = [...crossKalshi, ...crossPolymarket].sort(
    (a, b) => b.convictionScore - a.convictionScore,
  );

  return {
    signals: all,
    consensusCount,
    kalshiCount: crossKalshi.length,
    polymarketCount: crossPolymarket.length,
    topConviction: all[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Cross-arb execution
// ---------------------------------------------------------------------------

/**
 * Execute both legs of a cross-platform arbitrage opportunity.
 *
 * Leg A: buy YES on the cheaper platform.
 * Leg B: buy NO (i.e., sell YES) on the more expensive platform.
 *
 * Both legs are attempted concurrently.  If either fails the function still
 * returns details for each leg so the caller can take corrective action.
 */
export async function executeCrossArbLegs(
  opportunity: CrossPlatformArbitrageOpportunity,
  params: {
    /** Size for the Kalshi leg in contracts (1 contract = $0.01 max payout) */
    kalshiContracts: number;
    /** Size for the Polymarket leg in USDC */
    polymarketSizeUsdc: number;
    /** Polymarket YES token ID for the target market */
    polymarketTokenIdYes: string;
    /** Polymarket NO token ID for the target market */
    polymarketTokenIdNo: string;
    /** Optional fill fractions for post-trade partial-leg risk evaluation. */
    fillFractions?: {
      kalshi?: number;
      polymarket?: number;
    };
  },
  executors: {
    placeKalshiOrder: (
      marketId: string,
      side: "yes" | "no",
      quantity: number,
      limitPrice: number,
    ) => Promise<{ success: boolean; orderId?: string; error?: string }>;
    placePolymarketOrder: (
      tokenId: string,
      side: "BUY" | "SELL",
      price: number,
      size: number,
    ) => Promise<{ success: boolean; orderId?: string; error?: string }>;
  },
): Promise<CrossArbExecutionResult> {
  const {
    kalshiContracts,
    polymarketSizeUsdc,
    polymarketTokenIdYes,
    polymarketTokenIdNo,
    fillFractions,
  } = params;

  const { buyPlatform, kalshiYesPrice, polymarketYesPrice } = opportunity;

  // --- Determine legs ---
  const kalshiSide: "yes" | "no" = buyPlatform === "kalshi" ? "yes" : "no";
  const kalshiPrice = buyPlatform === "kalshi" ? kalshiYesPrice : 1 - kalshiYesPrice;
  const polymarketSide: "BUY" = "BUY"; // always buy the cheaper token
  const polymarketTokenId =
    buyPlatform === "polymarket" ? polymarketTokenIdYes : polymarketTokenIdNo;
  const polymarketPrice =
    buyPlatform === "polymarket" ? polymarketYesPrice : 1 - polymarketYesPrice;

  // --- Execute concurrently ---
  const [kalshiResult, polymarketResult] = await Promise.allSettled([
    executors.placeKalshiOrder(
      opportunity.kalshiMarketId,
      kalshiSide,
      kalshiContracts,
      kalshiPrice,
    ),
    executors.placePolymarketOrder(
      polymarketTokenId,
      polymarketSide,
      polymarketPrice,
      polymarketSizeUsdc,
    ),
  ]);

  const kalshiLeg =
    kalshiResult.status === "fulfilled"
      ? {
          attempted: true,
          success: kalshiResult.value.success,
          orderId: kalshiResult.value.orderId,
          error: kalshiResult.value.error,
        }
      : {
          attempted: true,
          success: false,
          error: String(kalshiResult.reason),
        };

  const polymarketLeg =
    polymarketResult.status === "fulfilled"
      ? {
          attempted: true,
          success: polymarketResult.value.success,
          orderId: polymarketResult.value.orderId,
          error: polymarketResult.value.error,
        }
      : {
          attempted: true,
          success: false,
          error: String(polymarketResult.reason),
        };

  const bothLegsExecuted = kalshiLeg.success && polymarketLeg.success;

  const kalshiFill = kalshiLeg.success ? clamp01(fillFractions?.kalshi ?? 1) : 0;
  const polymarketFill = polymarketLeg.success ? clamp01(fillFractions?.polymarket ?? 1) : 0;

  const partialRisk = assessPartialLegRisk({
    firstLegFilled: Math.max(kalshiFill, polymarketFill),
    secondLegFilled: Math.min(kalshiFill, polymarketFill),
    hedgeRatio: opportunity.hedgeRatio,
  });
  const fullyHedged = bothLegsExecuted && partialRisk.unhedgedFraction <= 0.0001;

  const reasoning =
    fullyHedged
      ? `Both legs executed. Kalshi ${kalshiSide.toUpperCase()} @ ${(kalshiPrice * 100).toFixed(1)}¢ (order ${kalshiLeg.orderId ?? "?"}), Polymarket ${buyPlatform === "polymarket" ? "YES" : "NO"} @ ${(polymarketPrice * 100).toFixed(1)}¢ (order ${polymarketLeg.orderId ?? "?"}).  Net edge: ${(opportunity.netEdge * 100).toFixed(1)}pp.`
      : `Partial execution. Kalshi: ${kalshiLeg.success ? "OK" : `FAIL – ${kalshiLeg.error}`}. Polymarket: ${polymarketLeg.success ? "OK" : `FAIL – ${polymarketLeg.error}`}. Recommended action: ${partialRisk.action.toUpperCase()} (${(partialRisk.unhedgedFraction * 100).toFixed(0)}% unhedged).`;

  return {
    success: bothLegsExecuted,
    kalshiLeg,
    polymarketLeg,
    bothLegsExecuted,
    partialLegAction: fullyHedged ? "hold" : partialRisk.action,
    unhedgedFraction: fullyHedged ? 0 : partialRisk.unhedgedFraction,
    reasoning,
  };
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
