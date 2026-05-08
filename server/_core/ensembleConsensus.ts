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
import {
  MARKET_CATEGORIES,
  type MarketCategory,
} from "./marketCategoryRouter";

function normalizeCategory(value: string | undefined): MarketCategory {
  if (!value) return "other";
  const lower = value.toLowerCase().trim();
  return (MARKET_CATEGORIES as readonly string[]).includes(lower)
    ? (lower as MarketCategory)
    : "other";
}

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

  // Fail closed when live capital is unavailable. Every percentage threshold
  // (Kelly, exposure caps, drawdown breakers, high-stakes triggers) derives
  // from `capitalUsd`; a 0 or non-finite value is "balance unknown" — refuse
  // to trade until the next tick can re-fetch.
  if (!Number.isFinite(input.capitalUsd) || input.capitalUsd <= 0) {
    return {
      approved: false,
      finalConfidenceAdjustment: input.grokVerdict.confidenceAdjustment,
      finalExpectedValueAdjustment: input.grokVerdict.expectedValueAdjustment,
      finalImpliedProbability: input.grokVerdict.impliedProbability,
      reasoning:
        "Live Kalshi capital unavailable; refusing to trade until balance is known.",
      classification,
      reviews,
      totalAiCostUsd,
    };
  }

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

  // For CATASTROPHIC-BETS, run Sonnet TWICE in parallel as a self-consistency
  // check. Both Sonnet passes must approve to advance to Opus. If they
  // disagree, we treat it as an ambiguity-flag and veto outright. Costs ~2×
  // Sonnet on catastrophic-bets only (~6 trades/mo × 2 = ~$0.10/mo extra).
  let sonnet: ClaudeReviewVerdict;
  if (classification.isCatastrophicBet) {
    const [sonnetPass1, sonnetPass2] = await Promise.all([
      reviewWithSonnet(sonnetReviewInput),
      reviewWithSonnet(sonnetReviewInput),
    ]);
    reviews.push({ reviewerId: "claude.sonnet-4-6", verdict: sonnetPass1 });
    reviews.push({ reviewerId: "claude.sonnet-4-6", verdict: sonnetPass2 });
    totalAiCostUsd += sonnetPass1.costUsd + sonnetPass2.costUsd;

    if (sonnetPass1.approved !== sonnetPass2.approved) {
      // Self-consistency split → catastrophic-bet veto. The two passes
      // disagreed on a trade large enough to materially dent the bankroll;
      // refuse it and let the operator look at what happened.
      return {
        approved: false,
        finalConfidenceAdjustment: avg(
          sonnetPass1.confidenceAdjustment,
          sonnetPass2.confidenceAdjustment,
        ),
        finalExpectedValueAdjustment: avg(
          sonnetPass1.expectedValueAdjustment,
          sonnetPass2.expectedValueAdjustment,
        ),
        finalImpliedProbability: avg(
          sonnetPass1.impliedProbability,
          sonnetPass2.impliedProbability,
        ),
        reasoning:
          "Catastrophic-bet veto: Sonnet self-consistency split — two passes disagreed on direction.",
        classification,
        reviews,
        totalAiCostUsd,
      };
    }
    // Use whichever pass had the more conservative EV adjustment (lower of
    // the two) so we don't average away a legitimate concern.
    sonnet =
      sonnetPass1.expectedValueAdjustment <= sonnetPass2.expectedValueAdjustment
        ? sonnetPass1
        : sonnetPass2;
  } else {
    sonnet = await reviewWithSonnet(sonnetReviewInput);
    reviews.push({ reviewerId: "claude.sonnet-4-6", verdict: sonnet });
    totalAiCostUsd += sonnet.costUsd;
  }

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

// ── Hot-path integration: filter Grok-approved signals through Tier 2/3 ───
//
// Called from kalshiAutonomy.ts AFTER reviewSignalsWithTrader has approved
// a list of KalshiSignal candidates. For each signal, we synthesise a
// GrokVerdict from the signal's existing fields, then run the ensemble.
// Vetoed signals are filtered out; approved signals carry the ensemble's
// adjusted EV/confidence. Per-signal reviewer trail is logged into the
// audit table so the calibration job can score Brier per reviewer.

// (logger is already imported at the top of this file; no second import needed.)
import { calculateNetEv } from "./feeCalculator";

export interface SignalForEnsemble {
  marketId: string;
  /** Signal type from the originating generator (momentum / value /
   *  contrarian / sentiment / etc). Combined with `marketId` + `side`
   *  this forms the stable composite identity used by callers to match
   *  ensemble verdicts back to source signals — multiple signals can
   *  exist per market. */
  signalType: string;
  ticker: string;
  category: string;
  side: "yes" | "no";
  confidence: number;
  impliedProbability: number;
  marketPrice: number;
  expectedValue: number;
  /** Number of contracts the autonomy plans to buy. */
  count: number;
  /** Resolution timestamp in ms (or null if unknown). */
  resolutionAtMs: number | null;
  /** Verbatim resolution rules from the market metadata. */
  resolutionPrimary: string | null;
  resolutionSecondary: string | null;
}

export interface EnsembleFilterResult {
  /** Signals that passed the ensemble (Grok + maybe Sonnet/Opus). */
  approvedSignals: SignalForEnsemble[];
  /** Per-signal verdict trail for the audit log. */
  verdicts: Array<{
    marketId: string;
    ensemble: EnsembleVerdict;
  }>;
}

/**
 * Filter Grok-approved signals through the Tier 2/3 ensemble. Returns the
 * subset that survived plus a verdict trail for audit logging. Synchronous
 * filtering on the input order; vetoed signals are dropped.
 */
export async function applyEnsembleFilter(
  signals: SignalForEnsemble[],
  ctx: { liveCapitalUsd: number },
): Promise<EnsembleFilterResult> {
  const approvedSignals: SignalForEnsemble[] = [];
  const verdicts: EnsembleFilterResult["verdicts"] = [];

  // Parallelize the per-signal ensemble. On a high-opportunity day with 8+
  // high-stakes signals firing, sequential Sonnet calls would add 25-40s
  // of latency — long enough for orderbook prices to drift. We chunk into
  // groups of CONCURRENCY to bound peak load on the Anthropic API while
  // still capturing most of the speedup.
  const CONCURRENCY = 4;
  const chunks: SignalForEnsemble[][] = [];
  for (let i = 0; i < signals.length; i += CONCURRENCY) {
    chunks.push(signals.slice(i, i + CONCURRENCY));
  }

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(
      chunk.map((s) => processOneSignalForEnsemble(s, ctx)),
    );
    for (const result of chunkResults) {
      verdicts.push({
        marketId: result.signal.marketId,
        ensemble: result.ensemble,
      });
      if (result.adjusted) {
        approvedSignals.push(result.adjusted);
      }
    }
  }

  return { approvedSignals, verdicts };
}

/** Process one signal through the ensemble. Returns the verdict + an
 *  adjusted signal (if approved) or null (if vetoed). Extracted out of
 *  the serial loop so applyEnsembleFilter can run them in parallel. */
async function processOneSignalForEnsemble(
  s: SignalForEnsemble,
  ctx: { liveCapitalUsd: number },
): Promise<{
  signal: SignalForEnsemble;
  ensemble: EnsembleVerdict;
  adjusted: SignalForEnsemble | null;
}> {
  const liveCapitalUsd = ctx.liveCapitalUsd;
  // INNER: this body is identical to the prior serial-loop body (scoped to
  // a single signal). Kept as a helper so we can Promise.all it.
  const notionalUsd = s.count * s.marketPrice;
  const grossEvFraction = s.expectedValue;

  // Synthesise the GrokVerdict from the upstream-approved signal's
  // existing fields. The autonomy already passed Grok's self-consistency
  // check before we get here, so first/second pass are both treated as
  // approved (the per-pass details aren't propagated through
  // reviewSignalsWithTrader yet).
  const grokVerdict: GrokVerdict = {
    approved: true,
    confidenceAdjustment: 0,
    expectedValueAdjustment: 0,
    impliedProbability: s.impliedProbability,
    reasoning: "Approved by Grok primary reviewer (Tier 1)",
    firstPassApproved: true,
    secondPassApproved: true,
    firstPassEvAdjustment: 0,
    secondPassEvAdjustment: 0,
    costUsd: 0, // already counted upstream in tradingReviewer telemetry
  };

  const ensemble = await runEnsemble({
    marketId: s.marketId,
    ticker: s.ticker,
    category: normalizeCategory(s.category),
    side: s.side,
    count: s.count,
    entryPrice: s.marketPrice,
    grossEvFraction,
    confidence: s.confidence,
    resolutionPrimary: s.resolutionPrimary,
    resolutionSecondary: s.resolutionSecondary,
    capitalUsd: liveCapitalUsd,
    resolutionAtMs: s.resolutionAtMs,
    grokVerdict,
    notionalUsd,
  });

  if (!ensemble.approved) {
    logger.info(
      {
        ticker: s.ticker,
        reason: ensemble.reasoning,
        tiersFired: ensemble.reviews.map((r) => r.reviewerId),
      },
      "[Ensemble] Tier 2/3 vetoed signal",
    );
    return { signal: s, ensemble, adjusted: null };
  }

  // Apply ensemble adjustments to the signal before returning it.
  const adjustedSignal: SignalForEnsemble = {
    ...s,
    confidence: clamp01(s.confidence + ensemble.finalConfidenceAdjustment),
    expectedValue: s.expectedValue + ensemble.finalExpectedValueAdjustment,
    impliedProbability: ensemble.finalImpliedProbability,
  };

  // Re-check the post-adjustment confidence against the configured hard
  // floor (default MIN_CONFIDENCE_AFTER_ADJUST=0.76). The pre-ensemble
  // gate already validated this for the GROSS confidence, but Claude
  // reviewers can trim it; a 78% confident signal reduced to 60% must
  // be vetoed even if the user-preference floor is lower (e.g. 0.55 in
  // aggressive mode), since execution-score ranking would otherwise let
  // it through.
  const minConfidence = ENV.profitGuardrails.minConfidenceAfterAdjust;
  if (adjustedSignal.confidence < minConfidence) {
    logger.info(
      {
        ticker: s.ticker,
        confidence: adjustedSignal.confidence,
        minConfidence,
      },
      "[Ensemble] post-adjustment confidence below MIN_CONFIDENCE_AFTER_ADJUST floor — vetoing",
    );
    const vetoedEnsemble: EnsembleVerdict = {
      ...ensemble,
      approved: false,
      reasoning: `Post-adjustment confidence ${(adjustedSignal.confidence * 100).toFixed(2)}% < MIN_CONFIDENCE_AFTER_ADJUST ${(minConfidence * 100).toFixed(2)}%. ${ensemble.reasoning}`,
    };
    return { signal: s, ensemble: vetoedEnsemble, adjusted: null };
  }

  // Re-check the post-fee + post-AI-cost net EV against the configured hard
  // floor (default MIN_NET_EV=0.065). Claude reviewers can trim EV; a
  // previously valid 7% trade reduced to 4% must be vetoed.
  const net = calculateNetEv({
    count: adjustedSignal.count,
    entryPrice: adjustedSignal.marketPrice,
    grossEvFraction: adjustedSignal.expectedValue,
    amortizedAiCostUsd: ensemble.totalAiCostUsd,
  });
  const minNetEv = ENV.profitGuardrails.minNetEv;
  if (net.netEvFraction < minNetEv) {
    logger.info(
      {
        ticker: s.ticker,
        netEv: net.netEvFraction,
        minNetEv,
        ensembleCost: ensemble.totalAiCostUsd,
      },
      "[Ensemble] post-cost net EV below MIN_NET_EV floor after Tier 2/3 adjustment — vetoing",
    );
    // Mark the ensemble as not approved and update the reasoning so the
    // exported verdict trail reflects this gate. Without this, audit logs
    // would still show `approved: true` for a signal we just vetoed.
    const vetoedEnsemble: EnsembleVerdict = {
      ...ensemble,
      approved: false,
      reasoning: `Post-cost net EV ${(net.netEvFraction * 100).toFixed(2)}% < MIN_NET_EV ${(minNetEv * 100).toFixed(2)}% (after Tier 2/3 cost ${ensemble.totalAiCostUsd.toFixed(4)}). ${ensemble.reasoning}`,
    };
    return { signal: s, ensemble: vetoedEnsemble, adjusted: null };
  }

  return { signal: s, ensemble, adjusted: adjustedSignal };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
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
