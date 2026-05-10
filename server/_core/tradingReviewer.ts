import { createAnthropicClient } from "./anthropicClient";
import type { KalshiMarket } from "./kalshiMarketData";
import type { KalshiSignal } from "./kalshiSignals";
import { ENV } from "./env";
import { z } from "zod";
import {
  buildCachedSystemPrompt,
  buildExtendedThinking,
  buildMemorySystemBlock,
  buildScoreboardSystemBlock,
  buildToolList,
  callAnthropicWithTimeout,
  extractAnthropicText,
  extractCitations,
  formatCitationsForReasoning,
  getTriageThreshold,
  isHighStakes,
  isTriageEnabled,
  recordAnthropicResponseTelemetry,
  runHaikuTriage,
  selectAnthropicModel,
  type CitationSummary,
  type ReviewerTelemetry,
  type StakesContext,
  type TriageCandidate,
} from "./aiToolbelt";
import { isOpenRouterTriageConfigured, runOpenRouterTriage } from "./openRouterTriage";
import { formatScoreboardForPrompt, getCachedScoreboard } from "./dailyScoreboard";
import {
  classifyMarketCategory,
  groupByCategory,
  type MarketCategory,
} from "./marketCategoryRouter";
import { getCategoryPersona, type CategoryPersona } from "./categoryPersonas";
import { checkProfitGuardrails } from "./profitGuardrails";
import {
  formatDeskMemoryForPrompt,
  getDeskMemoryBatch,
  type DeskMemoryRecord,
} from "../db.desk-memory";

type TradingSignalReview = {
  marketId: string;
  approved: boolean;
  confidenceAdjustment?: number;
  expectedValueAdjustment?: number;
  reasoning?: string;
};

type AnthropicClient = {
  messages: {
    create: (input: {
      model: string;
      max_tokens: number;
      temperature: number;
      system: string;
      messages: Array<{ role: "user"; content: string }>;
    }) => Promise<{
      content: Array<{ type: string; text?: string }>;
    }>;
  };
};

const DEFAULT_MAX_SIGNALS = 12;
const MAX_REASONING_CHARS = 240;
export const MAX_MARKET_SUMMARY_TITLE_CHARS = 160;
export const MAX_MARKET_SUMMARY_CATEGORY_CHARS = 80;
export const MAX_SIGNAL_SUMMARY_REASONING_CHARS = 320;

/**
 * Intra-Claude escalation thresholds.  When the bulk Sonnet pass approves a
 * non-high-stakes trade but tugs confidence down materially or moves
 * expected value materially, that's exactly the contested mid-stakes case
 * where Opus's extra reasoning pays for itself.
 */
const INTRA_ESCALATION_CONFIDENCE_DROP = -0.10;
const INTRA_ESCALATION_EV_MOVE = 0.05;

function reviewIsContested(review: TradingSignalReview): boolean {
  if (!review.approved) return false;
  if ((review.confidenceAdjustment ?? 0) <= INTRA_ESCALATION_CONFIDENCE_DROP) return true;
  if (Math.abs(review.expectedValueAdjustment ?? 0) >= INTRA_ESCALATION_EV_MOVE) return true;
  return false;
}

const reviewSchema = z.object({
  marketId: z.string().min(1),
  approved: z.boolean(),
  confidenceAdjustment: z.number().finite().optional(),
  expectedValueAdjustment: z.number().finite().optional(),
  reasoning: z.string().trim().max(MAX_REASONING_CHARS).optional(),
});

const reviewResponseSchema = z.union([
  z.object({
    reviews: z.array(reviewSchema),
  }),
  z.array(reviewSchema),
]);

export type TradingReviewerOptions = {
  skipInTest?: boolean;
  logger?: Pick<Console, "warn" | "error">;
  anthropicApiKey?: string;
  anthropicModel?: string;
  anthropicTimeoutMs?: number;
  anthropicClient?: AnthropicClient;
  /**
   * If provided, the reviewer loads the per-desk learning tape for this user
   * and injects it into the cached system prompt.  Without a userId, memory
   * is skipped (test/no-DB path).
   */
  userId?: number;
  /** Inject pre-loaded desk memory instead of hitting the DB (test path). */
  deskMemoryByDeskId?: Map<string, DeskMemoryRecord>;
  /** Override the default Haiku triage threshold for tests. */
  triageThresholdOverride?: number;
  /**
   * Optional sink for per-run telemetry (cache hit rate, web_search count,
   * triage drops).  Caller passes a fresh object via newReviewerTelemetry()
   * and reads it after the review returns.
   */
  telemetry?: ReviewerTelemetry;
};

export type TradingReviewer = {
  reviewSignals(input: {
    markets: KalshiMarket[];
    signals: KalshiSignal[];
    maxSignals?: number;
  }): Promise<KalshiSignal[]>;
};

export function createTradingReviewer(options: TradingReviewerOptions = {}): TradingReviewer {
  return {
    reviewSignals(input) {
      return reviewSignalsWithTrader(input, options);
    },
  };
}

/**
 * The reviewer is "configured" iff ANTHROPIC_API_KEY is set.  Phase 1
 * removed the legacy fallback path; env validation already rejects boot when the
 * key is missing in production, so this returns false only in dev/test.
 */
export function isTradingReviewerConfigured(_options: TradingReviewerOptions = {}) {
  return ENV.anthropicApiKey.trim().length > 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

function extractJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function parseTradingReviews(text: string): TradingSignalReview[] {
  const parsed = extractJson(text);
  if (!parsed) return [];

  const result = reviewResponseSchema.safeParse(parsed);
  if (!result.success) return [];

  return Array.isArray(result.data) ? result.data : result.data.reviews;
}

function compactText(value: string | undefined, maxChars: number) {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (normalized.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 1) {
    return normalized.slice(0, maxChars);
  }

  const clipped = normalized.slice(0, maxChars - 1).trimEnd();
  const wordBoundary = clipped.lastIndexOf(" ");
  const readableClip = wordBoundary > Math.floor((maxChars - 1) * 0.6)
    ? clipped.slice(0, wordBoundary).trimEnd()
    : clipped;

  return `${readableClip}…`;
}

function summarizeMarket(market: KalshiMarket) {
  return {
    id: market.id,
    title: compactText(market.title, MAX_MARKET_SUMMARY_TITLE_CHARS),
    category: compactText(market.category, MAX_MARKET_SUMMARY_CATEGORY_CHARS),
    status: market.status,
    yesPrice: market.yesPrice,
    noPrice: market.noPrice,
    impliedProbability: market.impliedProbability,
    yesVolume: market.yesVolume,
    noVolume: market.noVolume,
    resolutionDate: market.resolutionDate,
  };
}

function summarizeSignal(signal: KalshiSignal) {
  return {
    marketId: signal.marketId,
    signalType: signal.signalType,
    side: signal.side,
    confidence: signal.confidence,
    marketPrice: signal.marketPrice,
    impliedProbability: signal.impliedProbability,
    expectedValue: signal.expectedValue,
    reasoning: compactText(signal.reasoning, MAX_SIGNAL_SUMMARY_REASONING_CHARS),
    liquidityScore: signal.metadata?.liquidityScore ?? null,
    spreadProxy: signal.metadata?.spreadProxy ?? null,
    totalVolume: signal.metadata?.totalVolume ?? null,
  };
}


function getReviewPayload(input: {
  markets: KalshiMarket[];
  signals: KalshiSignal[];
  maxSignals: number;
  persona?: CategoryPersona;
}) {
  const signalsForReview = input.signals.slice(0, input.maxSignals);
  const marketById = new Map(input.markets.map((market) => [market.id, market]));

  return {
    mandate:
      "Review candidate Kalshi signals. Approve only if the trade has a clear reason, adequate liquidity, bounded binary-market downside, and no obvious stale/thin-market issue. Veto vague, purely heuristic, low-EV, or weak-liquidity candidates. Do not invent market facts beyond the payload.",
    desk: (input.persona as any)?.label ?? "Generalist Desk",
    outputSchema:
      "{ reviews: Array<{marketId:string, approved:boolean, confidenceAdjustment:number between -0.25 and 0.15, expectedValueAdjustment:number between -0.1 and 0.1, reasoning:string <= 240 chars}> }",
    markets: signalsForReview.map((signal) => {
      const market = marketById.get(signal.marketId);
      return market ? summarizeMarket(market) : { id: signal.marketId };
    }),
    signals: signalsForReview.map(summarizeSignal),
  };
}

function stakesForSignals(signals: KalshiSignal[]): StakesContext {
  let topConfidence = 0;
  let topNotional = 0;
  // Track the most extreme implied probability seen in the batch so a single
  // tail-priced market promotes the whole batch to deep review.
  let extremeImplied: number | undefined;
  for (const signal of signals) {
    if (signal.confidence > topConfidence) topConfidence = signal.confidence;
    // Phase 1.5: notional proxy is `marketPrice × 10`. Pre-1.5 used × 100
    // which was off by ~10× — at $300 bankroll the bot buys 1-30 contracts
    // (Kelly-sized, capped at 4 % capital ≈ $12), not 100. The × 10
    // multiplier is a conservative ceiling that pairs with the recalibrated
    // HIGH_STAKES_NOTIONAL_USD ($25) to keep ~20 % of signals high-stakes.
    const notional = Number(signal.marketPrice ?? 0) * 10;
    if (notional > topNotional) topNotional = notional;
    const implied = Number(signal.impliedProbability);
    if (Number.isFinite(implied)) {
      if (extremeImplied === undefined) {
        extremeImplied = implied;
      } else {
        // Keep whichever is closer to 0 or 1 — that's the more extreme tail.
        const currentDistance = Math.min(extremeImplied, 1 - extremeImplied);
        const candidateDistance = Math.min(implied, 1 - implied);
        if (candidateDistance < currentDistance) extremeImplied = implied;
      }
    }
  }
  return {
    confidence: topConfidence,
    orderNotional: topNotional,
    impliedProbability: extremeImplied,
  };
}

function categoryOfSignal(
  signal: KalshiSignal,
  marketsById: Map<string, KalshiMarket>,
): MarketCategory {
  const market = marketsById.get(signal.marketId);
  if (!market) return "other";
  return classifyMarketCategory({ category: market.category, title: market.title });
}

function buildReviewerBaseMandate(persona?: CategoryPersona): string {
  const desk = (persona as any)?.label ?? "Generalist Desk";
  const personaMandate = (persona as any)?.systemMandate
    ? `\n\nDesk-specific mandate (${desk}):\n${(persona as any).systemMandate}`
    : "";
  return (
    "You are an AI trading reviewer acting as a conservative Kalshi trading reviewer for one founder's small live account. You do not place trades directly. You only approve, veto, or modestly adjust signal confidence and expected value. Capital preservation, liquidity, bounded downside, and avoiding weak heuristic trades are mandatory. Respond with JSON only as {\"reviews\":[...]}." +
    personaMandate
  );
}

async function requestAnthropicReviews(
  reviewPayload: ReturnType<typeof getReviewPayload>,
  options: TradingReviewerOptions,
  persona?: CategoryPersona,
  stakes: StakesContext = {},
  memorySnippet: string | null = null,
  forceDeep = false,
  /** Phase 1.5 — explicit temperature override for self-consistency.
   *  Only honored on the non-thinking (bulk Haiku) path; the deep tier's
   *  extended-thinking modes ignore temperature. */
  temperatureOverride?: number,
) {
  const client = options.anthropicClient ?? createAnthropicClient(
    (options.anthropicApiKey ?? ENV.anthropicApiKey).trim(),
  );

  const useDeepModel = forceDeep || isHighStakes(stakes);
  const defaultTimeoutMs = useDeepModel
    ? ENV.claudeOpusTimeoutMs
    : ENV.claudeSonnetTimeoutMs;
  const timeoutMs = options.anthropicTimeoutMs ?? defaultTimeoutMs;
  const tier = useDeepModel ? "deep" : "review";
  const model = selectAnthropicModel(tier, options.anthropicModel);
  // When forcing deep review (intra-Claude escalation), promote the stakes
  // context so buildExtendedThinking actually fires regardless of the
  // original heuristic.
  const stakesForCall = forceDeep ? { ...stakes, highStakes: true } : stakes;
  const thinking = buildExtendedThinking(stakesForCall);
  // Bumped from 4 → 6 on deep tier.  Sports lineups, weather, news primaries,
  // and macro consensus often need multiple targeted queries to triangulate.
  // Reduce non-deep Haiku web-search uses to 1 (was 2) to cut token
  // overhead on routine batches while keeping richer search capacity
  // on deep Sonnet/Opus calls.
  const tools = buildToolList([], {
    allowWebSearch: true,
    maxWebSearchUses: useDeepModel ? 6 : 1,
  });

  // Build the system prompt as up to two cached blocks: persona mandate
  // (changes rarely) + desk memory (updates after every trade outcome).
  // Splitting them lets the persona block stay cache-warm even when memory
  // changes between runs.
  const personaBlocks = ENV.enableAiPromptCache
    ? buildCachedSystemPrompt(buildReviewerBaseMandate(persona))
    : null;
  const memoryBlock = ENV.enableAiDeskMemory ? buildMemorySystemBlock(memorySnippet) : null;
  // Pay-for-yourself scoreboard — every reviewer call sees today's running
  // net so it can tighten its bar when net-negative.  Block is uncached
  // because the scoreboard changes every tick.
  const scoreboardText = formatScoreboardForPrompt(getCachedScoreboard());
  const scoreboardBlock = buildScoreboardSystemBlock(scoreboardText);

  const messageInput: Record<string, unknown> = {
    model,
    // Deep tier uses adaptive extended thinking (effort=high), which lets
    // the model spend up to max_tokens on thinking + output.  8000 gives
    // room for substantial reasoning while leaving headroom for the JSON
    // review output.
    max_tokens: useDeepModel ? 8000 : 1800,
    messages: [
      {
        role: "user",
        content: JSON.stringify(reviewPayload),
      },
    ],
  };
  // Temperature is only set on non-thinking calls.  Anthropic's
  // extended-thinking modes are designed to run at the default temperature
  // (~1.0); setting temperature=0 alongside thinking is documented as
  // incompatible on some models and is suboptimal even where accepted
  // (constrains the reasoning chain).  Bulk Haiku review without thinking
  // keeps temperature=0 for determinism.
  if (!thinking) {
    // Phase 1.5: temperatureOverride is honored on the non-thinking
    // (Haiku) path so self-consistency can run two passes at distinct
    // temps. Falls back to 0 (deterministic) when no override given.
    messageInput.temperature =
      typeof temperatureOverride === "number" && Number.isFinite(temperatureOverride)
        ? temperatureOverride
        : 0;
  }
  if (personaBlocks) {
    const blocks = [...personaBlocks];
    if (memoryBlock) blocks.push(memoryBlock);
    if (scoreboardBlock) blocks.push(scoreboardBlock);
    messageInput.system = blocks;
  } else {
    const sections = [buildReviewerBaseMandate(persona)];
    if (memorySnippet) sections.push(memorySnippet);
    if (scoreboardText) sections.push(scoreboardText);
    messageInput.system = sections.join("\n\n");
  }
  if (thinking) {
    messageInput.thinking = thinking;
  }
  if (tools) {
    messageInput.tools = tools;
  }

  // Anthropic SDK accepts our extended shape (system as block list, optional
  // thinking/tools) but our minimal AnthropicClient interface is intentionally
  // narrow.  Cast through unknown so test stubs don't need the full surface.
  const response = await callAnthropicWithTimeout(
    client as unknown as {
      messages: { create: (input: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }> };
    },
    messageInput,
    timeoutMs,
    "Anthropic review",
  );

  if (options.telemetry) {
    recordAnthropicResponseTelemetry(options.telemetry, response as { content?: Array<unknown>; usage?: Record<string, unknown> }, {
      extendedThinkingUsed: Boolean(thinking),
    });
    if (persona && !options.telemetry.desks.includes(persona.id)) {
      options.telemetry.desks.push(persona.id);
    }
  }

  const citations: ReturnType<typeof extractCitations> = [];
  void extractCitations; // keep import live

  return {
    provider: "anthropic" as const,
    reviews: parseTradingReviews(extractAnthropicText(response)),
    citations,
  };
}

function combineApprovedSignal(
  signal: KalshiSignal,
  review: TradingSignalReview,
  logger: Pick<Console, "warn" | "error">,
  desk?: string,
  citations: CitationSummary[] = [],
) {
  if (!review.approved) {
    return null;
  }

  const confidenceAdjustment = clamp(Number(review.confidenceAdjustment ?? 0), -0.25, 0.15);
  const expectedValueAdjustment = clamp(Number(review.expectedValueAdjustment ?? 0), -0.1, 0.1);

  const reviewerReasoning = review.reasoning?.trim().slice(0, MAX_REASONING_CHARS) || "AI approved after conservative review.";

  const ledger = "AI review";
  const deskLabel = desk ? ` [${desk}]` : "";
  const citationLabel = formatCitationsForReasoning(citations);

  return {
    ...signal,
    confidence: clamp(signal.confidence + confidenceAdjustment, 0.01, 0.99),
    expectedValue: Math.max(0, signal.expectedValue + expectedValueAdjustment),
    reasoning: `${signal.reasoning} | ${ledger}${deskLabel}: ${reviewerReasoning}${citationLabel}`,
  };
}

/**
 * Result of asking Claude to review one batch of category-bucketed signals.
 * `reviews` may be empty if the request failed; the signal is dropped per fail-closed logic.
 */
type ReviewBatchResult = {
  reviewsByMarket: Map<string, TradingSignalReview>;
  failed: boolean;
  citations: CitationSummary[];
  /** Phase 1.5 — set per-market when Tier-1 self-consistency passes
   *  disagreed.  Caller can choose to escalate split markets to Sonnet. */
  selfConsistencySplits?: Set<string>;
};

/**
 * Phase 1.5 — intersect two Haiku passes at different temperatures.
 *
 *   A approve + B approve → APPROVE with averaged adjustments
 *   A reject + B reject  → REJECT
 *   A ≠ B                 → SPLIT (mark for Sonnet escalation upstream)
 *
 * Self-consistency catches Haiku model-flake — random-sampling variance
 * on borderline trades — without paying for Sonnet on every signal.
 */
function intersectSelfConsistencyReviews(
  reviewsA: TradingSignalReview[],
  reviewsB: TradingSignalReview[],
): { reviewsByMarket: Map<string, TradingSignalReview>; splits: Set<string> } {
  const reviewsByMarket = new Map<string, TradingSignalReview>();
  const splits = new Set<string>();
  const mapA = new Map(reviewsA.map((r) => [r.marketId, r]));
  const mapB = new Map(reviewsB.map((r) => [r.marketId, r]));
  const allIds = new Set<string>([...mapA.keys(), ...mapB.keys()]);
  for (const marketId of allIds) {
    const a = mapA.get(marketId);
    const b = mapB.get(marketId);
    if (!a || !b) {
      // Missing review on either pass = treat as split (escalate); a real
      // Sonnet call will resolve.  Failing closed without escalation would
      // discard signals on transient SDK hiccups.
      splits.add(marketId);
      reviewsByMarket.set(marketId, {
        marketId,
        approved: false,
        reasoning: "Self-consistency: one pass omitted this market; escalating to Sonnet.",
      });
      continue;
    }
    if (a.approved && b.approved) {
      reviewsByMarket.set(marketId, {
        marketId,
        approved: true,
        confidenceAdjustment:
          ((a.confidenceAdjustment ?? 0) + (b.confidenceAdjustment ?? 0)) / 2,
        expectedValueAdjustment:
          ((a.expectedValueAdjustment ?? 0) + (b.expectedValueAdjustment ?? 0)) / 2,
        // Use pass A's reasoning (deterministic temp) as canonical.
        reasoning: a.reasoning ?? b.reasoning,
      });
    } else if (!a.approved && !b.approved) {
      reviewsByMarket.set(marketId, a);
    } else {
      // Disagreement — mark split, default to vetoed pending escalation.
      splits.add(marketId);
      reviewsByMarket.set(marketId, {
        marketId,
        approved: false,
        confidenceAdjustment: a.confidenceAdjustment,
        expectedValueAdjustment: a.expectedValueAdjustment,
        reasoning: `Self-consistency split: pass-A=${a.approved ? "✓" : "✗"} pass-B=${b.approved ? "✓" : "✗"}; escalating to Sonnet.`,
      });
    }
  }
  return { reviewsByMarket, splits };
}

async function callReviewer(
  reviewPayload: ReturnType<typeof getReviewPayload>,
  options: TradingReviewerOptions,
  persona: CategoryPersona | undefined,
  stakes: StakesContext,
  logger: Pick<Console, "warn" | "error">,
  memorySnippet: string | null = null,
  forceDeep = false,
): Promise<ReviewBatchResult> {
  // Phase 1: Claude-only. Anthropic is the sole provider; env validation
  // already guarantees the key is set in production.
  // Phase 1.5: bulk Haiku batches use self-consistency (two passes at
  // distinct temps) when enabled.  Deep-tier (Sonnet/Opus with extended
  // thinking) bypasses self-consistency — extended thinking provides its
  // own variance-reduction internally and explicit temperature is ignored.
  const useDeepModel = forceDeep || isHighStakes(stakes);
     const topBatchConfidence = typeof stakes?.confidence === "number" ? stakes.confidence : undefined;
    const SELF_CONSISTENCY_LOWER = 0.55;
    // Hardcoded upper bound so this behavior is controlled in-code
    // and doesn't require setting an environment variable on Railway.
    const SELF_CONSISTENCY_UPPER = 0.75;
     const selfConsistencyActive =
     !useDeepModel &&
     ENV.claudeHaikuSelfConsistencyEnabled &&
     typeof topBatchConfidence === "number" &&
     topBatchConfidence >= SELF_CONSISTENCY_LOWER &&
     topBatchConfidence <= SELF_CONSISTENCY_UPPER;
  try {
    if (selfConsistencyActive) {
      const [respA, respB] = await Promise.all([
        requestAnthropicReviews(
          reviewPayload,
          options,
          persona,
          stakes,
          memorySnippet,
          forceDeep,
          ENV.claudeHaikuSelfConsistencyTemp1,
        ),
        requestAnthropicReviews(
          reviewPayload,
          options,
          persona,
          stakes,
          memorySnippet,
          forceDeep,
          ENV.claudeHaikuSelfConsistencyTemp2,
        ),
      ]);
      const merged = intersectSelfConsistencyReviews(respA.reviews, respB.reviews);
      return {
        reviewsByMarket: merged.reviewsByMarket,
        failed: false,
        citations: respA.citations,
        selfConsistencySplits: merged.splits,
      };
    }
    const response = await requestAnthropicReviews(
      reviewPayload,
      options,
      persona,
      stakes,
      memorySnippet,
      forceDeep,
    );
    return {
      reviewsByMarket: new Map(response.reviews.map((review) => [review.marketId, review])),
      failed: false,
      citations: response.citations,
    };
  } catch (error) {
    if (options.telemetry) {
      options.telemetry.anthropicFailures += 1;
    }
    logger.warn(
      `[TradingReviewer] AI review failed for desk=${persona?.id ?? "default"}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { reviewsByMarket: new Map(), failed: true, citations: [] };
  }
}

/**
 * Per-category review with Claude-only topology.  Each signal is reviewed by
 * Claude (per-category persona, prompt-cached, web_search-enabled, extended
 * thinking on high-stakes).  If Claude fails to return a review for a market,
 * the signal is dropped per fail-closed logic.
 */
async function runCategoryReview(
  signals: KalshiSignal[],
  marketsById: Map<string, KalshiMarket>,
  options: TradingReviewerOptions,
  persona: CategoryPersona | undefined,
  stakes: StakesContext,
  logger: Pick<Console, "warn" | "error">,
  memorySnippet: string | null = null,
): Promise<KalshiSignal[]> {
  const markets = signals
    .map((signal) => marketsById.get(signal.marketId))
    .filter((market): market is KalshiMarket => Boolean(market));

  const reviewPayload = getReviewPayload({
    markets,
    signals,
    maxSignals: signals.length,
    persona,
  });

  if (!isTradingReviewerConfigured(options)) {
    logger.error(
      "[TradingReviewer] AI reviewer not configured; dropping all candidates so autonomous trading fails closed.",
    );
    return [];
  }

  const batchResult = await callReviewer(reviewPayload, options, persona, stakes, logger, memorySnippet);

  // Intra-Claude tier-2/tier-3 escalation lives downstream in
  // ensembleConsensus.applyEnsembleFilter — that's the single source of
  // truth for the Sonnet/Opus deep-review path, including catastrophic-bet
  // unanimous gates. This Tier-1 reviewer just returns the bulk Haiku
  // verdicts; the ensemble decides whether to escalate.
  const escalationCitationsByMarket = new Map<string, CitationSummary[]>();
  void reviewIsContested;

  // Phase 1.5 — self-consistency split escalation. When the two Haiku
  // passes disagreed on a market, escalate that single market to Sonnet
  // (force-deep) for a tiebreaker. Sonnet's verdict replaces the placeholder
  // veto from intersectSelfConsistencyReviews. Both passes-rejected and
  // both-approved markets are NOT escalated (no disagreement to resolve).
  if (
    batchResult.selfConsistencySplits &&
    batchResult.selfConsistencySplits.size > 0 &&
    ENV.claudeHaikuSelfConsistencyEscalateOnSplit &&
    !batchResult.failed
  ) {
    const splitMarketIds = Array.from(batchResult.selfConsistencySplits);
    const splitSignals = signals.filter((s) => batchResult.selfConsistencySplits!.has(s.marketId));
    if (splitSignals.length > 0) {
      await Promise.all(
        splitSignals.map(async (signal) => {
          const market = marketsById.get(signal.marketId);
          if (!market) return;
          const singlePayload = getReviewPayload({
            markets: [market],
            signals: [signal],
            maxSignals: 1,
            persona,
          });
          const escalatedStakes: StakesContext = {
            ...stakes,
            highStakes: true,
          };
          const tiebreaker = await callReviewer(
            singlePayload,
            options,
            persona,
            escalatedStakes,
            logger,
            memorySnippet,
            true, // forceDeep — Sonnet with extended thinking
          );
          const tiebreakerReview = tiebreaker.reviewsByMarket.get(signal.marketId);
          if (tiebreaker.failed || !tiebreakerReview) {
            // Sonnet unreachable — leave the placeholder veto in place
            // (capital preservation: split was already a defensive veto).
            return;
          }
          batchResult.reviewsByMarket.set(signal.marketId, tiebreakerReview);
          if (tiebreaker.citations.length > 0) {
            escalationCitationsByMarket.set(signal.marketId, tiebreaker.citations);
          }
        }),
      );
      logger.warn?.(
        `[TradingReviewer] Self-consistency escalation: resolved ${splitMarketIds.length} split market(s) via Sonnet tiebreaker.`,
      );
    }
  }

  return signals
    .map((signal) => {
      const review = batchResult.reviewsByMarket.get(signal.marketId);
      if (!review) {
        logger.warn(
          `[TradingReviewer] AI review missing for marketId=${signal.marketId} (desk=${(persona as any)?.id ?? "default"}); dropping signal.`,
        );
        return null;
      }
      const citations =
        escalationCitationsByMarket.get(signal.marketId) ?? batchResult.citations;
      return combineApprovedSignal(signal, review, logger, (persona as any)?.label, citations);
    })
    .filter((signal): signal is KalshiSignal => Boolean(signal));
}

/**
 * Optional pre-filter: OpenRouter runs aggressively because the free model can
 * drop obvious junk before paid Claude/Grok review.  Anthropic Haiku triage is
 * still available as a fallback path but only fires on larger batches. Returns
 * the input unchanged on any failure (capital preservation > cost savings).
 */
async function applyTriageFilter(
  signals: KalshiSignal[],
  marketsById: Map<string, KalshiMarket>,
  options: TradingReviewerOptions,
  logger: Pick<Console, "warn" | "error">,
): Promise<KalshiSignal[]> {
  const useOpenRouter = isOpenRouterTriageConfigured();
  const useHaikuTriage = isTriageEnabled();
  if (!useOpenRouter && !useHaikuTriage) return signals;
  if (!isTradingReviewerConfigured(options)) return signals;

  const threshold = options.triageThresholdOverride
    ?? (useOpenRouter ? ENV.openRouterTriageThreshold : getTriageThreshold());
  if (signals.length <= threshold) return signals;

  const triageInput: TriageCandidate[] = signals.map((signal) => {
    const market = marketsById.get(signal.marketId);
    return {
      marketId: signal.marketId,
      title: market?.title ?? "",
      category: market?.category ?? "",
      signalType: signal.signalType,
      side: signal.side,
      confidence: signal.confidence,
      expectedValue: signal.expectedValue,
      impliedProbability: signal.impliedProbability,
    };
  });

  const keep = useOpenRouter
    ? await runOpenRouterTriage(triageInput, {
        timeoutMs: ENV.openRouterTimeoutMs,
        log: logger,
      })
    : await runHaikuTriage(
        (options.anthropicClient ?? createAnthropicClient(
          (options.anthropicApiKey ?? ENV.anthropicApiKey).trim(),
        )) as { messages: { create: (input: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }> } },
        triageInput,
        {
          timeoutMs: Math.min(options.anthropicTimeoutMs ?? ENV.claudeHaikuTimeoutMs, 8000),
          logger,
        },
      );
  if (options.telemetry) {
    options.telemetry.triageRan = true;
    options.telemetry.triageInputCount = signals.length;
    options.telemetry.triageKeptCount = keep ? Math.max(0, keep.size) : signals.length;
  }
  if (!keep) return signals;
  // Force-keep any candidate that is itself high-stakes — capital
  // preservation beats triage savings.  These always proceed to the deep
  // tier reviewer regardless of what Haiku's quick filter decided.
  for (const signal of signals) {
    if (isHighStakes(stakesForSignals([signal]))) {
      keep.add(signal.marketId);
    }
  }
  if (options.telemetry) {
    options.telemetry.triageKeptCount = keep.size;
  }
  const filtered = signals.filter((signal) => keep.has(signal.marketId));
  // Safety floor: if triage drops everything, fall back to the original list.
  return filtered.length > 0 ? filtered : signals;
}

/**
 * Load desk memory for the buckets that will be reviewed.  Caller passes a
 * pre-loaded map for tests; otherwise we hit the DB only if a userId is set.
 */
async function loadDeskMemoryForBuckets(
  buckets: Map<MarketCategory, KalshiSignal[]>,
  options: TradingReviewerOptions,
): Promise<Map<string, DeskMemoryRecord>> {
  if (options.deskMemoryByDeskId) return options.deskMemoryByDeskId;
  if (!ENV.enableAiDeskMemory) return new Map();
  if (!options.userId) return new Map();

  const deskIds = Array.from(buckets.keys()).map((category) => getCategoryPersona("kalshi", category).id);
  try {
    return await getDeskMemoryBatch(options.userId, "kalshi", deskIds);
  } catch (error) {
    options.logger?.warn?.(
      `[TradingReviewer] Failed to load desk memory: ${error instanceof Error ? error.message : String(error)}; continuing without memory.`,
    );
    return new Map();
  }
}

export async function reviewSignalsWithTrader(
  input: {
    markets: KalshiMarket[];
    signals: KalshiSignal[];
    maxSignals?: number;
  },
  options: TradingReviewerOptions = {}
): Promise<KalshiSignal[]> {
  if (input.signals.length === 0) return [];
  if (process.env.NODE_ENV === "test" && options.skipInTest !== false) {
    return input.signals;
  }

  const logger = options.logger ?? console;
  if (!isTradingReviewerConfigured(options)) {
    logger.error(
      "[TradingReviewer] AI reviewer not configured (ANTHROPIC_API_KEY missing); dropping all candidates.",
    );
    return [];
  }

  const cap = input.maxSignals ?? DEFAULT_MAX_SIGNALS;
  const cappedSignals = input.signals.slice(0, cap);
  const marketsById = new Map(input.markets.map((market) => [market.id, market]));

  // Optional Haiku pre-filter so large batches don't burn Sonnet/Opus tokens
  // on obvious junk.  Returns the input unchanged when the batch is small
  // enough or triage is disabled / fails.
  const triagedSignals = await applyTriageFilter(cappedSignals, marketsById, options, logger);

  // Profit-guardrail filter: applied AFTER the AI reviewer so an approved
  // candidate must ALSO meet hard EV/confidence thresholds before reaching
  // the order pipeline.  This is the high-leverage-wins-only enforcement.
  // Logs each rejection so the audit trail captures the reason.
  const filterByGuardrails = (signals: KalshiSignal[], context: string) =>
    signals.filter((s) => {
      // entryPrice MUST be the price of the side being bought (YES → yesPrice,
      // NO → 1 - yesPrice).  signal.impliedProbability is always the YES
      // probability by convention; passing it directly for a NO signal makes
      // the ROI gate and fee math wrong by a factor of yesPrice/(1-yesPrice).
      const yesProb = Number((s as { impliedProbability?: number }).impliedProbability ?? 0.5);
      const entry = s.side === "no" ? 1 - yesProb : yesProb;
      const check = checkProfitGuardrails({
        expectedValue: s.expectedValue,
        confidence: s.confidence,
        count: 1,
        entryPrice: entry,
        category: "other",
        // Forward the spread proxy computed by signal generation so the gate
        // subtracts real round-trip spread cost, not the 1¢ fallback floor.
        // Without this, markets with 4–12¢ spreads pass the EV floor on paper.
        spreadProxy: s.metadata?.spreadProxy,
      });
      if (!check.approved) {
        logger.warn?.(
          `[ProfitGuardrails] ${context} signal ${s.marketId} rejected: ${check.reason}`,
        );
      }
      return check.approved;
    });

  // When category routing is disabled, fall back to a single combined batch so
  // the public behavior still matches the original single-mandate reviewer.
  if (!ENV.enableAiCategoryRouting) {
    const reviewed = await runCategoryReview(
      triagedSignals,
      marketsById,
      options,
      undefined,
      stakesForSignals(triagedSignals),
      logger,
    );
    return filterByGuardrails(reviewed, "uncategorized");
  }

  const buckets = groupByCategory(triagedSignals, (signal) => {
    const market = marketsById.get(signal.marketId);
    return { category: market?.category, title: market?.title };
  });

  const memoryByDeskId = await loadDeskMemoryForBuckets(buckets, options);

  const batches = await Promise.all(
    Array.from(buckets.entries()).map(async ([category, batchSignals]) => {
      const persona = getCategoryPersona("kalshi", category);
      const stakes = stakesForSignals(batchSignals);
      const memorySnippet = formatDeskMemoryForPrompt(memoryByDeskId.get(persona.id) ?? null);
      const reviewed = await runCategoryReview(
        batchSignals,
        marketsById,
        options,
        persona,
        stakes,
        logger,
        memorySnippet,
      );
      return filterByGuardrails(reviewed, category);
    }),
  );

  // Preserve original signal ordering rather than category grouping order.
  const approved = new Map<string, KalshiSignal>();
  for (const batch of batches) {
    for (const signal of batch) {
      approved.set(signal.marketId, signal);
    }
  }
  return triagedSignals
    .map((signal) => approved.get(signal.marketId))
    .filter((signal): signal is KalshiSignal => Boolean(signal));
}

// Re-export the category helper for downstream use (tests, dashboards).
export { categoryOfSignal };
