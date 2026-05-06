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
 */

import type { PolymarketMarket } from "./polymarketAuth";
import {
  detectClusterActivityBatch,
  buildFadeRecommendations,
  type MarketSnapshot,
} from "./polymarketClusterMonitor";

export type PolymarketSignalType =
  | "value_play"
  | "momentum"
  | "contrarian"
  | "arbitrage"
  | "sentiment"
  | "cluster_fade"
  | "cluster_copy"
  | "wash_volume_warning"
  | "confluence";

export interface PolymarketSignal {
  marketId: string;
  conditionId: string;
  question: string;
  signalType: PolymarketSignalType;
  /** "yes" = buy YES token, "no" = buy NO token */
  side: "yes" | "no";
  /** Confidence 0-1 */
  confidence: number;
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
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

/**
 * Estimate a naive fair value for a binary market based on its current price
 * and a category-driven prior.  In production this would be replaced by an
 * AI or fundamentals estimate.
 */
function estimateFairValue(market: PolymarketMarket): number {
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
  } = options;

  const signals: PolymarketSignal[] = [];

  for (const market of markets) {
    if (market.closed || !market.active) continue;
    if (market.liquidity < minLiquidity) continue;

    const p = market.impliedProbabilityYes;
    if (!Number.isFinite(p) || p <= 0.01 || p >= 0.99) continue;

    const fairValue = fairValues?.get(market.marketId) ?? estimateFairValue(market);
    const sentimentScore = sentimentScores?.get(market.marketId) ?? 0;

    const yesToken = market.tokens.find((t) => t.outcome.toLowerCase() === "yes");
    const noToken = market.tokens.find((t) => t.outcome.toLowerCase() === "no");

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

  return signals.filter((s) => s.confidence >= minConfidence);
}
