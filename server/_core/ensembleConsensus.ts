/**
 * Hybrid ensemble consensus orchestrator (Grok + Claude).
 *
 * Tiers:
 *   1. Claude Haiku 4.5    — always runs (cheap, fast triage).
 *   2A. Grok 4 (xAI)       — breaking-news niches (Weather, Sports, Economics)
 *                            with real-time X search + NOAA + order book tools.
 *   2B. Claude Opus 4.7    — non-breaking-news high-stakes (Politics, Other)
 *                            where depth of reasoning > speed.
 *   3. Claude Opus 4.7     — catastrophic-bet unanimous gate (Haiku + Tier2 + Opus).
 *
 * Decision rules:
 *   - Tier 1 veto → SKIP.
 *   - !highStakes → trust Tier 1.
 *   - highStakes && breaking-news niche → Grok Tier-2.
 *   - highStakes && non-breaking-news → Opus Tier-2.
 *   - catastrophicBet → require unanimous Haiku + Tier-2 + Opus.
 *
 * Sonnet 4.6 is deprecated — Grok handles the middle tier more cost-effectively
 * for breaking-news signals, and Opus handles non-breaking-news depth.
 */

import { ENV } from "./env";
import { logger } from "./logger";
import {
  reviewWithSonnet,
  reviewWithOpus,
  type ClaudeReviewInput,
  type ClaudeReviewVerdict,
} from "./claudeReviewer";
import {
  reviewWithGrok,
  shouldUseGrokReviewer,
  type GrokReviewInput,
  type GrokReviewVerdict,
} from "./grokReviewer";
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

export interface Tier1Verdict {
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
  /** Stack of every reviewer that ran, in order. The first entry is the
   *  Tier-1 marker (synthesised — the real Tier-1 review ran upstream in
   *  reviewSignalsWithTrader using Claude Haiku). */
  reviews: Array<
    | { reviewerId: "claude.haiku-4-5.tier1-synthetic"; verdict: Tier1Verdict }
    | { reviewerId: ClaudeReviewVerdict["reviewerId"]; verdict: ClaudeReviewVerdict }
    | { reviewerId: GrokReviewVerdict["reviewerId"]; verdict: GrokReviewVerdict }
  >;
  totalAiCostUsd: number;
}

export interface EnsembleInput extends Omit<ClaudeReviewInput, "priorVerdict"> {
  capitalUsd: number;
  resolutionAtMs: number | null;
  tier1Verdict: Tier1Verdict;
}

export async function runEnsemble(input: EnsembleInput): Promise<EnsembleVerdict> {
  const reviews: EnsembleVerdict["reviews"] = [
    { reviewerId: "claude.haiku-4-5.tier1-synthetic", verdict: input.tier1Verdict },
  ];
  let totalAiCostUsd = input.tier1Verdict.costUsd;

  // Rule 1: Tier-1 veto → done.
  if (!input.tier1Verdict.approved) {
    return {
      approved: false,
      finalConfidenceAdjustment: input.tier1Verdict.confidenceAdjustment,
      finalExpectedValueAdjustment: input.tier1Verdict.expectedValueAdjustment,
      finalImpliedProbability: input.tier1Verdict.impliedProbability,
      reasoning: `Tier-1 veto: ${input.tier1Verdict.reasoning}`,
      classification: classifySignal({
        notionalUsd: input.notionalUsd,
        capitalUsd: input.capitalUsd,
        resolutionAtMs: input.resolutionAtMs,
        tier1FirstPassApproved: input.tier1Verdict.firstPassApproved,
        tier1SecondPassApproved: input.tier1Verdict.secondPassApproved,
        tier1FirstEvAdjustment: input.tier1Verdict.firstPassEvAdjustment,
        tier1SecondEvAdjustment: input.tier1Verdict.secondPassEvAdjustment,
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
    tier1FirstPassApproved: input.tier1Verdict.firstPassApproved,
    tier1SecondPassApproved: input.tier1Verdict.secondPassApproved,
    tier1FirstEvAdjustment: input.tier1Verdict.firstPassEvAdjustment,
    tier1SecondEvAdjustment: input.tier1Verdict.secondPassEvAdjustment,
  });

  // Fail closed when live capital is unavailable. Every percentage threshold
  // (Kelly, exposure caps, drawdown breakers, high-stakes triggers) derives
  // from `capitalUsd`; a 0 or non-finite value is "balance unknown" — refuse
  // to trade until the next tick can re-fetch.
  if (!Number.isFinite(input.capitalUsd) || input.capitalUsd <= 0) {
    return {
      approved: false,
      finalConfidenceAdjustment: input.tier1Verdict.confidenceAdjustment,
      finalExpectedValueAdjustment: input.tier1Verdict.expectedValueAdjustment,
      finalImpliedProbability: input.tier1Verdict.impliedProbability,
      reasoning:
        "Live Kalshi capital unavailable; refusing to trade until balance is known.",
      classification,
      reviews,
      totalAiCostUsd,
    };
  }

  // Rule 2: low-stakes → trust Tier 1.
  if (!classification.isHighStakes) {
    return {
      approved: true,
      finalConfidenceAdjustment: input.tier1Verdict.confidenceAdjustment,
      finalExpectedValueAdjustment: input.tier1Verdict.expectedValueAdjustment,
      finalImpliedProbability: input.tier1Verdict.impliedProbability,
      reasoning: `Low-stakes (${classification.reasoning}); Tier-1 approval stands.`,
      classification,
      reviews,
      totalAiCostUsd,
    };
  }

  // Tier 2: Grok (breaking-news niches) or Sonnet (everything else).
  // Grok fires when:
  //   1. XAI_API_KEY is set AND GROK_REVIEWER_ENABLED=true
  //   2. Category is weather / sports / economics (real-time info = edge)
  //   3. Resolution is ≤72h away (fresh info matters)
  // Everything else falls through to Sonnet for depth reasoning.
  if (!ENV.anthropicApiKey) {
    // No Anthropic key configured — should never happen post-Phase-1 since
    // env validation requires ANTHROPIC_API_KEY in production. Fail CLOSED:
    // a high-stakes bet without Tier-2/3 review is a configuration error that
    // must not silently pass through to execution.
    logger.error(
      { ticker: input.ticker, classification: classification.reasoning },
      "[Ensemble] ANTHROPIC_API_KEY unset — refusing high-stakes signal (fail closed)",
    );
    return {
      approved: false,
      finalConfidenceAdjustment: input.tier1Verdict.confidenceAdjustment,
      finalExpectedValueAdjustment: input.tier1Verdict.expectedValueAdjustment,
      finalImpliedProbability: input.tier1Verdict.impliedProbability,
      reasoning: `Configuration error: ANTHROPIC_API_KEY unset; refusing high-stakes trade. Triggers: ${classification.reasoning}`,
      classification,
      reviews,
      totalAiCostUsd,
    };
  }

  const hoursToResolution = input.resolutionAtMs
    ? (input.resolutionAtMs - Date.now()) / (1000 * 60 * 60)
    : null;
  const useGrok =
    ENV.grokReviewerEnabled &&
    Boolean(ENV.xaiApiKey) &&
    shouldUseGrokReviewer(normalizeCategory(input.category), hoursToResolution);

  const tier2ReviewInput: ClaudeReviewInput = toClaudeReviewInput(input);

  // For CATASTROPHIC-BETS, normal Tier-2 routing still applies (Grok for
  // breaking-news, Sonnet otherwise). The unanimous Opus gate happens below
  // in Rule 3a regardless of which Tier-2 reviewer is chosen.
  let tier2: ClaudeReviewVerdict | GrokReviewVerdict;
  if (useGrok) {
    // Tier-2 Grok path — breaking-news niche with real-time edge
    const grokInput: GrokReviewInput = {
      marketId: input.marketId,
      ticker: input.ticker,
      category: normalizeCategory(input.category),
      side: input.side,
      count: input.count,
      entryPrice: input.entryPrice,
      grossEvFraction: input.grossEvFraction,
      confidence: input.confidence,
      resolutionPrimary: input.resolutionPrimary ?? null,
      resolutionSecondary: input.resolutionSecondary ?? null,
      priorVerdict: {
        approved: input.tier1Verdict.approved,
        impliedProbability: input.tier1Verdict.impliedProbability,
        confidenceAdjustment: input.tier1Verdict.confidenceAdjustment,
        expectedValueAdjustment: input.tier1Verdict.expectedValueAdjustment,
        reasoning: input.tier1Verdict.reasoning,
      },
      notionalUsd: input.notionalUsd,
      hoursToResolution,
    };
    const grokVerdict = await reviewWithGrok(grokInput);
    reviews.push({ reviewerId: "grok-4-latest", verdict: grokVerdict });
    totalAiCostUsd += grokVerdict.costUsd;
    tier2 = grokVerdict;
  } else {
    // Tier-2 default: Sonnet for non-breaking-news high-stakes signals
    const sonnet = await reviewWithSonnet(tier2ReviewInput);
    reviews.push({ reviewerId: "claude.sonnet-4-6", verdict: sonnet });
    totalAiCostUsd += sonnet.costUsd;
    tier2 = sonnet;
  }

  // Alias for the existing downstream code that uses `sonnet` and `sonnetReviewInput`
  const sonnetReviewInput = tier2ReviewInput;
  const sonnet = tier2;

  // Rule 3a: catastrophic-bet → demand unanimous (Sonnet approves AND Opus approves).
  if (classification.isCatastrophicBet) {
    if (!sonnet.approved) {
      return {
        approved: false,
        finalConfidenceAdjustment: avg(
          input.tier1Verdict.confidenceAdjustment,
          sonnet.confidenceAdjustment,
        ),
        finalExpectedValueAdjustment: avg(
          input.tier1Verdict.expectedValueAdjustment,
          sonnet.expectedValueAdjustment,
        ),
        finalImpliedProbability: avg(
          input.tier1Verdict.impliedProbability,
          sonnet.impliedProbability,
        ),
        reasoning: `Catastrophic-bet veto: Tier-2 rejected. ${sonnet.reasoning}`,
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
          input.tier1Verdict.confidenceAdjustment,
          sonnet.confidenceAdjustment,
          opus.confidenceAdjustment,
        ),
        finalExpectedValueAdjustment: avg(
          input.tier1Verdict.expectedValueAdjustment,
          sonnet.expectedValueAdjustment,
          opus.expectedValueAdjustment,
        ),
        finalImpliedProbability: avg(
          input.tier1Verdict.impliedProbability,
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
        input.tier1Verdict.confidenceAdjustment,
        sonnet.confidenceAdjustment,
        opus.confidenceAdjustment,
      ),
      finalExpectedValueAdjustment: avg(
        input.tier1Verdict.expectedValueAdjustment,
        sonnet.expectedValueAdjustment,
        opus.expectedValueAdjustment,
      ),
      finalImpliedProbability: avg(
        input.tier1Verdict.impliedProbability,
        sonnet.impliedProbability,
        opus.impliedProbability,
      ),
      reasoning: `Catastrophic-bet UNANIMOUS approval: Tier-1 + Tier-2 + Opus all green.`,
      classification,
      reviews,
      totalAiCostUsd,
    };
  }

  // Rule 3b: high-stakes (non-catastrophic).
  if (sonnet.approved) {
    // Tier-1 ✓ + Sonnet ✓ → APPROVE. Average their adjustments.
    return {
      approved: true,
      finalConfidenceAdjustment: avg(
        input.tier1Verdict.confidenceAdjustment,
        sonnet.confidenceAdjustment,
      ),
      finalExpectedValueAdjustment: avg(
        input.tier1Verdict.expectedValueAdjustment,
        sonnet.expectedValueAdjustment,
      ),
      finalImpliedProbability: avg(
        input.tier1Verdict.impliedProbability,
        sonnet.impliedProbability,
      ),
      reasoning: `Tier-1 ✓ + Tier-2 ✓ on high-stakes (${classification.reasoning})`,
      classification,
      reviews,
      totalAiCostUsd,
    };
  }

  // Tier-1 ✓ + Sonnet ✗ → escalate to Opus tiebreaker, BUT only when the
  // signal's gross EV clears the OPUS_ESCALATION_MIN_GROSS_EV floor
  // (default 5 %). Below that the candidate isn't worth Opus's cost
  // (~$0.083/call vs Sonnet's ~$0.017) — we just trust Sonnet's veto.
  if (input.grossEvFraction < ENV.opusEscalationMinGrossEv) {
    return {
      approved: false,
      finalConfidenceAdjustment: avg(
        input.tier1Verdict.confidenceAdjustment,
        sonnet.confidenceAdjustment,
      ),
      finalExpectedValueAdjustment: avg(
        input.tier1Verdict.expectedValueAdjustment,
        sonnet.expectedValueAdjustment,
      ),
      finalImpliedProbability: avg(
        input.tier1Verdict.impliedProbability,
        sonnet.impliedProbability,
      ),
      reasoning: `Tier-2 vetoed and gross EV ${(input.grossEvFraction * 100).toFixed(2)}% below ${(ENV.opusEscalationMinGrossEv * 100).toFixed(2)}% Opus-escalation floor — trusting Tier-2 veto without escalation.`,
      classification,
      reviews,
      totalAiCostUsd,
    };
  }

  const opus = await reviewWithOpus(sonnetReviewInput);
  reviews.push({ reviewerId: "claude.opus-4-7", verdict: opus });
  totalAiCostUsd += opus.costUsd;

  return {
    approved: opus.approved,
    finalConfidenceAdjustment: avg(
      input.tier1Verdict.confidenceAdjustment,
      sonnet.confidenceAdjustment,
      opus.confidenceAdjustment,
    ),
    finalExpectedValueAdjustment: avg(
      input.tier1Verdict.expectedValueAdjustment,
      sonnet.expectedValueAdjustment,
      opus.expectedValueAdjustment,
    ),
    finalImpliedProbability: avg(
      input.tier1Verdict.impliedProbability,
      sonnet.impliedProbability,
      opus.impliedProbability,
    ),
    reasoning: `Tiebreaker: Tier-1 ✓, Tier-2 ✗, Opus ${opus.approved ? "✓" : "✗"} → ${opus.approved ? "APPROVE" : "VETO"}. ${opus.reasoning}`,
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

// ── Hot-path integration: filter Tier-1-approved signals through Tier 2/3 ─
//
// Called from kalshiAutonomy.ts AFTER reviewSignalsWithTrader has approved
// a list of KalshiSignal candidates. For each signal, we synthesise a
// Tier1Verdict from the signal's existing fields, then run the ensemble.
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
  /** Signals that passed the ensemble (Tier-1 + maybe Sonnet/Opus). */
  approvedSignals: SignalForEnsemble[];
  /** Per-signal verdict trail for the audit log. Keyed by composite
   *  (marketId, side, signalType) — matches the same key used downstream
   *  in kalshiAutonomy.ts so multi-signal-per-market candidates don't
   *  collide and adopt each other's verdicts. */
  verdicts: Array<{
    marketId: string;
    side: "yes" | "no";
    signalType: string;
    ensemble: EnsembleVerdict;
  }>;
}

/**
 * Filter Tier-1-approved signals through the Tier 2/3 ensemble. Returns the
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
        side: result.signal.side,
        signalType: String(result.signal.signalType ?? "default"),
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
  // s.expectedValue is dollar EV per $1 payout face (bounded [-1,1]).
  // Convert to ROI-per-dollar-invested for the OPUS_ESCALATION_MIN_GROSS_EV
  // threshold and downstream calculateNetEv.  Without this, the gate
  // understates edge by a factor of marketPrice — e.g. true 50% ROI on a
  // $0.40 contract was reported as 20%.  See profitGuardrails.ts for the
  // matching fix at the per-signal gate.
  const entryForRoi = Math.max(0.01, s.marketPrice);
  const grossEvFraction = s.expectedValue / entryForRoi;

  // Synthesise a Tier-1 approval marker from the upstream-approved signal.
  // The actual Tier-1 review (Claude Haiku) ran in `reviewSignalsWithTrader`
  // before this code is reached — so any signal here is already Tier-1-
  // approved by definition.
  const tier1Verdict: Tier1Verdict = {
    approved: true,
    confidenceAdjustment: 0,
    expectedValueAdjustment: 0,
    impliedProbability: s.impliedProbability,
    reasoning: "Approved by primary reviewer (Tier 1: Claude Haiku)",
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
    tier1Verdict,
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
  // floor (default MIN_NET_EV=0.05). Claude reviewers can trim EV; a
  // previously valid 7% trade reduced to 3% must be vetoed.
  // Convert per-payout-face EV to ROI-per-dollar (see helper above).
  const adjustedEntryForRoi = Math.max(0.01, adjustedSignal.marketPrice);
  const net = calculateNetEv({
    count: adjustedSignal.count,
    entryPrice: adjustedSignal.marketPrice,
    grossEvFraction: adjustedSignal.expectedValue / adjustedEntryForRoi,
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
    priorVerdict: {
      approved: input.tier1Verdict.approved,
      impliedProbability: input.tier1Verdict.impliedProbability,
      confidenceAdjustment: input.tier1Verdict.confidenceAdjustment,
      expectedValueAdjustment: input.tier1Verdict.expectedValueAdjustment,
      reasoning: input.tier1Verdict.reasoning,
    },
    notionalUsd: input.notionalUsd,
  };
}
