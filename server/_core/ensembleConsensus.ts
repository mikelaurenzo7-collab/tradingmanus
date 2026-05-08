/**
 * 3-tier ensemble consensus orchestrator.
 *
 * Tiers:
 *   1. Grok 4.1 Fast       — always runs (cheap, has live X access).
 *   2. Claude Sonnet 4.6   — runs ONLY on high-stakes signals (cross-family veto).
 *   3. Claude Opus 4.7     — runs ONLY when Grok and Sonnet disagree, OR the
 *                            position is a catastrophic-bet (≥10% of capital
 *                            requires unanimous approval across all three).
 *
 * Decision rules (in order):
 *   - If Grok vetoes  → SKIP. (No further reviewers — we already have a no.)
 *   - If !highStakes  → trust Grok. APPROVE iff Grok approved.
 *   - If highStakes && !catastrophic:
 *       - Grok ✓ + Sonnet ✓ → APPROVE.
 *       - Grok ✓ + Sonnet ✗ → escalate to Opus tiebreaker. Opus decides.
 *   - If catastrophicBet:
 *       - Require UNANIMOUS Grok ✓ + Sonnet ✓ + Opus ✓.
 *       - Any veto → SKIP, regardless of the other two.
 *
 * All review costs and verdicts are logged into the trade's audit trail so
 * the calibration job can compute Brier score per reviewer.
 */

import { ENV } from "./env";
import { logger } from "./logger";
import {
  reviewWithSonnet,
  reviewWithOpus,
  type ClaudeReviewInput,
  type ClaudeReviewVerdict,
} from "./claudeReviewer";
import { classifySignal, type HighStakesClassification } from "./highStakesDetector";
import type { MarketCategory } from "./marketCategoryRouter";

export interface GrokVerdict {
  approved: boolean;
  confidenceAdjustment: number;
  expectedValueAdjustment: number;
  impliedProbability: number;
  reasoning: string;
  /** First and second self-consistency passes — used to detect splits. */
  firstPassApproved: boolean;
  secondPassApproved: boolean;
  firstPassEvAdjustment: number;
  secondPassEvAdjustment: number;
  costUsd: number;
}

export interface EnsembleVerdict {
  approved: boolean;
  finalConfidenceAdjustment: number;
  finalExpectedValueAdjustment: number;
  finalImpliedProbability: number;
  reasoning: string;
  classification: HighStakesClassification;
  /** Stack of every reviewer that ran, in order. */
  reviews: Array<
    | { reviewerId: "grok.4-1-fast"; verdict: GrokVerdict }
    | { reviewerId: ClaudeReviewVerdict["reviewerId"]; verdict: ClaudeReviewVerdict }
  >;
  totalAiCostUsd: number;
}

export interface EnsembleInput extends Omit<ClaudeReviewInput, "grokVerdict"> {
  capitalUsd: number;
  resolutionAtMs: number | null;
  grokVerdict: GrokVerdict;
}

export async function runEnsemble(input: EnsembleInput): Promise<EnsembleVerdict> {
  const reviews: EnsembleVerdict["reviews"] = [
    { reviewerId: "grok.4-1-fast", verdict: input.grokVerdict },
  ];
  let totalAiCostUsd = input.grokVerdict.costUsd;

  // Rule 1: Grok veto → done.
  if (!input.grokVerdict.approved) {
    return {
      approved: false,
      finalConfidenceAdjustment: input.grokVerdict.confidenceAdjustment,
      finalExpectedValueAdjustment: input.grokVerdict.expectedValueAdjustment,
      finalImpliedProbability: input.grokVerdict.impliedProbability,
      reasoning: `Grok veto: ${input.grokVerdict.reasoning}`,
      classification: classifySignal({
        notionalUsd: input.notionalUsd,
        capitalUsd: input.capitalUsd,
        resolutionAtMs: input.resolutionAtMs,
        grokFirstPassApproved: input.grokVerdict.firstPassApproved,
        grokSecondPassApproved: input.grokVerdict.secondPassApproved,
        grokFirstEvAdjustment: input.grokVerdict.firstPassEvAdjustment,
        grokSecondEvAdjustment: input.grokVerdict.secondPassEvAdjustment,
      }),
      reviews,
      totalAiCostUsd,
    };
  }

  // Classify stakes.
  const classification = classifySignal({
    notionalUsd: input.notionalUsd,
    capitalUsd: input.capitalUsd,
    resolutionAtMs: input.resolutionAtMs,
    grokFirstPassApproved: input.grokVerdict.firstPassApproved,
    grokSecondPassApproved: input.grokVerdict.secondPassApproved,
    grokFirstEvAdjustment: input.grokVerdict.firstPassEvAdjustment,
    grokSecondEvAdjustment: input.grokVerdict.secondPassEvAdjustment,
  });

  // Rule 2: low-stakes → trust Grok.
  if (!classification.isHighStakes) {
    return {
      approved: true,
      finalConfidenceAdjustment: input.grokVerdict.confidenceAdjustment,
      finalExpectedValueAdjustment: input.grokVerdict.expectedValueAdjustment,
      finalImpliedProbability: input.grokVerdict.impliedProbability,
      reasoning: `Low-stakes (${classification.reasoning}); Grok approval stands.`,
      classification,
      reviews,
      totalAiCostUsd,
    };
  }

  // Tier 2: Sonnet (cross-family second opinion).
  if (!ENV.anthropicApiKey) {
    // No Anthropic key configured. Fall back to Grok-only behavior with a
    // warning — the operator should set ANTHROPIC_API_KEY for the ensemble.
    logger.warn(
      { ticker: input.ticker, classification: classification.reasoning },
      "[Ensemble] high-stakes signal but ANTHROPIC_API_KEY unset — degrading to Grok-only",
    );
    return {
      approved: true,
      finalConfidenceAdjustment: input.grokVerdict.confidenceAdjustment,
      finalExpectedValueAdjustment: input.grokVerdict.expectedValueAdjustment,
      finalImpliedProbability: input.grokVerdict.impliedProbability,
      reasoning: `Grok-only (Anthropic key unset). High-stakes triggers: ${classification.reasoning}`,
      classification,
      reviews,
      totalAiCostUsd,
    };
  }

  const sonnetReviewInput: ClaudeReviewInput = toClaudeReviewInput(input);
  const sonnet = await reviewWithSonnet(sonnetReviewInput);
  reviews.push({ reviewerId: "claude.sonnet-4-6", verdict: sonnet });
  totalAiCostUsd += sonnet.costUsd;

  // Rule 3a: catastrophic-bet → demand unanimous (Sonnet approves AND Opus approves).
  if (classification.isCatastrophicBet) {
    if (!sonnet.approved) {
      return {
        approved: false,
        finalConfidenceAdjustment: avg(
          input.grokVerdict.confidenceAdjustment,
          sonnet.confidenceAdjustment,
        ),
        finalExpectedValueAdjustment: avg(
          input.grokVerdict.expectedValueAdjustment,
          sonnet.expectedValueAdjustment,
        ),
        finalImpliedProbability: avg(
          input.grokVerdict.impliedProbability,
          sonnet.impliedProbability,
        ),
        reasoning: `Catastrophic-bet veto: Sonnet rejected. ${sonnet.reasoning}`,
        classification,
        reviews,
        totalAiCostUsd,
      };
    }

    // Both approve so far; still need Opus unanimous.
    const opus = await reviewWithOpus(sonnetReviewInput);
    reviews.push({ reviewerId: "claude.opus-4-7", verdict: opus });
    totalAiCostUsd += opus.costUsd;

    if (!opus.approved) {
      return {
        approved: false,
        finalConfidenceAdjustment: avg(
          input.grokVerdict.confidenceAdjustment,
          sonnet.confidenceAdjustment,
          opus.confidenceAdjustment,
        ),
        finalExpectedValueAdjustment: avg(
          input.grokVerdict.expectedValueAdjustment,
          sonnet.expectedValueAdjustment,
          opus.expectedValueAdjustment,
        ),
        finalImpliedProbability: avg(
          input.grokVerdict.impliedProbability,
          sonnet.impliedProbability,
          opus.impliedProbability,
        ),
        reasoning: `Catastrophic-bet veto: Opus rejected. ${opus.reasoning}`,
        classification,
        reviews,
        totalAiCostUsd,
      };
    }

    // Unanimous approval on a catastrophic-bet.
    return {
      approved: true,
      finalConfidenceAdjustment: avg(
        input.grokVerdict.confidenceAdjustment,
        sonnet.confidenceAdjustment,
        opus.confidenceAdjustment,
      ),
      finalExpectedValueAdjustment: avg(
        input.grokVerdict.expectedValueAdjustment,
        sonnet.expectedValueAdjustment,
        opus.expectedValueAdjustment,
      ),
      finalImpliedProbability: avg(
        input.grokVerdict.impliedProbability,
        sonnet.impliedProbability,
        opus.impliedProbability,
      ),
      reasoning: `Catastrophic-bet UNANIMOUS approval: Grok+Sonnet+Opus all green.`,
      classification,
      reviews,
      totalAiCostUsd,
    };
  }

  // Rule 3b: high-stakes (non-catastrophic).
  if (sonnet.approved) {
    // Grok ✓ + Sonnet ✓ → APPROVE. Average their adjustments.
    return {
      approved: true,
      finalConfidenceAdjustment: avg(
        input.grokVerdict.confidenceAdjustment,
        sonnet.confidenceAdjustment,
      ),
      finalExpectedValueAdjustment: avg(
        input.grokVerdict.expectedValueAdjustment,
        sonnet.expectedValueAdjustment,
      ),
      finalImpliedProbability: avg(
        input.grokVerdict.impliedProbability,
        sonnet.impliedProbability,
      ),
      reasoning: `Grok ✓ + Sonnet ✓ on high-stakes (${classification.reasoning})`,
      classification,
      reviews,
      totalAiCostUsd,
    };
  }

  // Grok ✓ + Sonnet ✗ → escalate to Opus tiebreaker.
  const opus = await reviewWithOpus(sonnetReviewInput);
  reviews.push({ reviewerId: "claude.opus-4-7", verdict: opus });
  totalAiCostUsd += opus.costUsd;

  return {
    approved: opus.approved,
    finalConfidenceAdjustment: avg(
      input.grokVerdict.confidenceAdjustment,
      sonnet.confidenceAdjustment,
      opus.confidenceAdjustment,
    ),
    finalExpectedValueAdjustment: avg(
      input.grokVerdict.expectedValueAdjustment,
      sonnet.expectedValueAdjustment,
      opus.expectedValueAdjustment,
    ),
    finalImpliedProbability: avg(
      input.grokVerdict.impliedProbability,
      sonnet.impliedProbability,
      opus.impliedProbability,
    ),
    reasoning: `Tiebreaker: Grok ✓, Sonnet ✗, Opus ${opus.approved ? "✓" : "✗"} → ${opus.approved ? "APPROVE" : "VETO"}. ${opus.reasoning}`,
    classification,
    reviews,
    totalAiCostUsd,
  };
}

function avg(...nums: number[]): number {
  if (nums.length === 0) return 0;
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum / nums.length;
}

function toClaudeReviewInput(input: EnsembleInput): ClaudeReviewInput {
  return {
    marketId: input.marketId,
    ticker: input.ticker,
    category: input.category as MarketCategory,
    side: input.side,
    count: input.count,
    entryPrice: input.entryPrice,
    grossEvFraction: input.grossEvFraction,
    confidence: input.confidence,
    resolutionPrimary: input.resolutionPrimary,
    resolutionSecondary: input.resolutionSecondary,
    grokVerdict: {
      approved: input.grokVerdict.approved,
      impliedProbability: input.grokVerdict.impliedProbability,
      confidenceAdjustment: input.grokVerdict.confidenceAdjustment,
      expectedValueAdjustment: input.grokVerdict.expectedValueAdjustment,
      reasoning: input.grokVerdict.reasoning,
    },
    notionalUsd: input.notionalUsd,
  };
}
