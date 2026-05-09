/**
 * Polymarket Signal Reviewer — Claude-only (Phase 1).
 *
 * Topology:
 *   - Claude (per-category persona, prompt-cached, web_search-enabled, extended
 *     thinking on high-stakes) is the sole reviewer.
 *   - If Claude fails to return a review for a market, the signal is dropped
 *     per fail-closed logic.
 */

import { createAnthropicClient } from "./anthropicClient";
import type { PolymarketMarket } from "./polymarketAuth";
import type { PolymarketSignal } from "./polymarketSignals";
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
import { formatScoreboardForPrompt, getCachedScoreboard } from "./dailyScoreboard";
import {
  classifyMarketCategory,
  groupByCategory,
  type MarketCategory,
} from "./marketCategoryRouter";
import { getCategoryPersona, type CategoryPersona } from "./categoryPersonas";
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
 * expected value materially, escalate that single market to Opus.
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

export type PolymarketReviewerOptions = {
  skipInTest?: boolean;
  logger?: Pick<Console, "warn" | "error">;
  anthropicApiKey?: string;
  anthropicModel?: string;
  anthropicTimeoutMs?: number;
  anthropicClient?: AnthropicClient;
  userId?: number;
  deskMemoryByDeskId?: Map<string, DeskMemoryRecord>;
  triageThresholdOverride?: number;
  telemetry?: ReviewerTelemetry;
};

export type PolymarketReviewer = {
  reviewSignals(input: {
    markets: PolymarketMarket[];
    signals: PolymarketSignal[];
    maxSignals?: number;
  }): Promise<PolymarketSignal[]>;
};

export function createPolymarketReviewer(
  options: PolymarketReviewerOptions = {},
): PolymarketReviewer {
  return {
    reviewSignals(input) {
      return reviewPolymarketSignalsWithTrader(input, options);
    },
  };
}

/**
 * The reviewer is "configured" as long as Claude is available.
 */
export function isPolymarketReviewerConfigured(
  options: PolymarketReviewerOptions = {},
) {
  const apiKey = (options.anthropicApiKey ?? ENV.anthropicApiKey).trim();
  return apiKey.length > 0;
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
  const readableClip =
    wordBoundary > Math.floor((maxChars - 1) * 0.6)
      ? clipped.slice(0, wordBoundary).trimEnd()
      : clipped;

  return `${readableClip}…`;
}

function summarizeMarket(market: PolymarketMarket) {
  return {
    id: market.marketId,
    question: compactText(market.question, MAX_MARKET_SUMMARY_TITLE_CHARS),
    category: compactText(market.category, MAX_MARKET_SUMMARY_CATEGORY_CHARS),
    active: market.active,
    closed: market.closed,
    impliedProbabilityYes: market.impliedProbabilityYes,
    volume: market.volume,
    liquidity: market.liquidity,
  };
}

function summarizeSignal(signal: PolymarketSignal) {
  return {
    marketId: signal.marketId,
    signalType: signal.signalType,
    side: signal.side,
    confidence: signal.confidence,
    limitPrice: signal.limitPrice,
    impliedProbabilityYes: signal.impliedProbabilityYes,
    fairValueEstimate: signal.fairValueEstimate,
    expectedValue: signal.expectedValue,
    reasoning: compactText(signal.reasoning, MAX_SIGNAL_SUMMARY_REASONING_CHARS),
  };
}

function stakesForSignals(signals: PolymarketSignal[]): StakesContext {
  let topConfidence = 0;
  let topNotional = 0;
  let extremeImplied: number | undefined;
  for (const signal of signals) {
    if (signal.confidence > topConfidence) topConfidence = signal.confidence;
    // Phase 1.5: notional proxy `limitPrice × 10`. See tradingReviewer.ts
    // for rationale — was × 100 which made every signal high-stakes.
    const notional = Number(signal.limitPrice ?? 0) * 10;
    if (notional > topNotional) topNotional = notional;
    const implied = Number(signal.impliedProbabilityYes);
    if (Number.isFinite(implied)) {
      // Tail-probability detection is symmetric — implied=0.05 (YES long-shot)
      // and implied=0.95 (NO long-shot) are both tails of the same market.
      // We track whichever value is closer to 0 or 1, regardless of which
      // side this batch is betting; isHighStakes treats both extremes the same.
      if (extremeImplied === undefined) {
        extremeImplied = implied;
      } else {
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

function categoryOfPolymarketSignal(
  signal: PolymarketSignal,
  marketsById: Map<string, PolymarketMarket>,
): MarketCategory {
  const market = marketsById.get(signal.marketId);
  if (!market) return "other";
  return classifyMarketCategory({ category: market.category, question: market.question });
}

function getReviewPayload(input: {
  markets: PolymarketMarket[];
  signals: PolymarketSignal[];
  maxSignals: number;
  persona?: CategoryPersona;
}) {
  const signalsForReview = input.signals.slice(0, input.maxSignals);
  const marketById = new Map(input.markets.map((market) => [market.marketId, market]));

  return {
    mandate:
      "Review candidate Polymarket CLOB signals. Approve only if the trade has a clear reason, adequate liquidity, bounded binary-market downside, and no obvious wash-trading/thin-market issue. Veto vague, purely heuristic, low-EV, or weak-liquidity candidates. Watch for cluster-based wash-trading signals. Do not invent market facts beyond the payload.",
    desk: input.persona?.label ?? "Polymarket Generalist Desk",
    outputSchema:
      '{ reviews: Array<{marketId:string, approved:boolean, confidenceAdjustment:number between -0.25 and 0.15, expectedValueAdjustment:number between -0.1 and 0.1, reasoning:string <= 240 chars}> }',
    markets: signalsForReview.map((signal) => {
      const market = marketById.get(signal.marketId);
      return market ? summarizeMarket(market) : { id: signal.marketId };
    }),
    signals: signalsForReview.map(summarizeSignal),
  };
}

function buildReviewerBaseMandate(persona?: CategoryPersona): string {
  const desk = persona?.label ?? "Polymarket Generalist Desk";
  const personaMandate = persona?.systemMandate
    ? `\n\nDesk-specific mandate (${desk}):\n${persona.systemMandate}`
    : "";
  return (
    "You are an AI trading reviewer acting as a conservative Polymarket trading reviewer for one founder's small live account. You do not place trades directly. You only approve, veto, or modestly adjust signal confidence and expected value. Capital preservation, liquidity, bounded downside, avoiding weak heuristic trades, and detecting wash-trading patterns are mandatory. Respond with JSON only as {\"reviews\":[...]}." +
    personaMandate
  );
}

async function requestLLMReviews(
  reviewPayload: ReturnType<typeof getReviewPayload>,
  options: PolymarketReviewerOptions,
  persona?: CategoryPersona,
  stakes: StakesContext = {},
  memorySnippet: string | null = null,
  forceDeep = false,
  /** Phase 1.5 — explicit temperature override for self-consistency. */
  temperatureOverride?: number,
) {
  const client =
    options.anthropicClient ??
    createAnthropicClient((options.anthropicApiKey ?? ENV.anthropicApiKey).trim());

  const useDeepModel = forceDeep || isHighStakes(stakes);
  // Wider wall-clock budget for deep-tier calls.
  const timeoutMs = useDeepModel
    ? Math.max(options.anthropicTimeoutMs ?? 0, ENV.claudeOpusTimeoutMs)
    : options.anthropicTimeoutMs ?? ENV.claudeSonnetTimeoutMs;
  const tier = useDeepModel ? "deep" : "review";
  const model = selectAnthropicModel(tier, options.anthropicModel);
  const stakesForCall = forceDeep ? { ...stakes, highStakes: true } : stakes;
  const thinking = buildExtendedThinking(stakesForCall);
  const tools = buildToolList([], {
    allowWebSearch: true,
    maxWebSearchUses: useDeepModel ? 6 : 2,
  });

  const personaBlocks = ENV.enableAiPromptCache
    ? buildCachedSystemPrompt(buildReviewerBaseMandate(persona))
    : null;
  const memoryBlock = ENV.enableAiDeskMemory ? buildMemorySystemBlock(memorySnippet) : null;
  const scoreboardText = formatScoreboardForPrompt(getCachedScoreboard());
  const scoreboardBlock = buildScoreboardSystemBlock(scoreboardText);

  const messageInput: Record<string, unknown> = {
    model,
    // Deep tier uses adaptive extended thinking (effort=high), which lets
    // the model spend up to max_tokens on thinking + output.  8000 gives
    // room for substantial reasoning while leaving headroom for the JSON
    // review output.
    max_tokens: useDeepModel ? 8000 : 1800,
    messages: [{ role: "user", content: JSON.stringify(reviewPayload) }],
  };
  // Temperature is only set on non-thinking calls.  Anthropic's
  // extended-thinking modes are designed to run at the default temperature
  // (~1.0); setting temperature=0 alongside thinking is documented as
  // incompatible on some models and is suboptimal even where accepted
  // (constrains the reasoning chain).  Bulk Haiku review without thinking
  // keeps temperature=0 for determinism.
  if (!thinking) {
    // Phase 1.5: temperatureOverride honored on the non-thinking Haiku
    // path so self-consistency can run two passes at distinct temps.
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
  if (thinking) messageInput.thinking = thinking;
  if (tools) messageInput.tools = tools;

  const response = await callAnthropicWithTimeout(
    client as unknown as {
      messages: { create: (input: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }> };
    },
    messageInput,
    timeoutMs,
    "Anthropic Polymarket review",
  );

  if (options.telemetry) {
    recordAnthropicResponseTelemetry(options.telemetry, response as { content?: Array<unknown>; usage?: Record<string, unknown> }, {
      extendedThinkingUsed: Boolean(thinking),
    });
    if (persona && !options.telemetry.desks.includes(persona.id)) {
      options.telemetry.desks.push(persona.id);
    }
  }

  // Citations only meaningful with Anthropic web_search; mirror tradingReviewer's
  // current shape — return empty list to preserve the contract while the env
  // toggle stays unwired.
  const citations: ReturnType<typeof extractCitations> = [];
  void extractCitations; // keep import live

  return {
    provider: "anthropic" as const,
    reviews: parseTradingReviews(extractAnthropicText(response)),
    citations,
  };
}

function combineApprovedSignal(
  signal: PolymarketSignal,
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
  /** Phase 1.5 — markets where Tier-1 self-consistency passes disagreed. */
  selfConsistencySplits?: Set<string>;
};

/**
 * Phase 1.5 — same self-consistency intersection as Kalshi reviewer.
 *
 *   A approve + B approve → APPROVE with averaged adjustments
 *   A reject + B reject  → REJECT
 *   A ≠ B                 → SPLIT (escalate upstream)
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
        reasoning: a.reasoning ?? b.reasoning,
      });
    } else if (!a.approved && !b.approved) {
      reviewsByMarket.set(marketId, a);
    } else {
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
  options: PolymarketReviewerOptions,
  persona: CategoryPersona | undefined,
  stakes: StakesContext,
  logger: Pick<Console, "warn" | "error">,
  memorySnippet: string | null = null,
  forceDeep = false,
): Promise<ReviewBatchResult> {
  // Phase 1: Claude-only. Anthropic is the sole provider.
  // Phase 1.5: bulk Haiku batches use self-consistency unless deep tier.
  const useDeepModel = forceDeep || isHighStakes(stakes);
  const selfConsistencyActive =
    !useDeepModel && ENV.claudeHaikuSelfConsistencyEnabled;
  try {
    if (selfConsistencyActive) {
      const [respA, respB] = await Promise.all([
        requestLLMReviews(
          reviewPayload,
          options,
          persona,
          stakes,
          memorySnippet,
          forceDeep,
          ENV.claudeHaikuSelfConsistencyTemp1,
        ),
        requestLLMReviews(
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
    const claudeResp = await requestLLMReviews(
      reviewPayload,
      options,
      persona,
      stakes,
      memorySnippet,
      forceDeep,
    );
    const reviewsByMarket = new Map(
      claudeResp.reviews.map((r) => [r.marketId, r]),
    );
    return {
      reviewsByMarket,
      failed: false,
      citations: claudeResp.citations,
    };
  } catch (error) {
    if (options.telemetry) {
      options.telemetry.anthropicFailures += 1;
    }
    logger.warn(
      `[PolymarketReviewer] AI review failed for desk=${persona?.id ?? "default"}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { reviewsByMarket: new Map(), failed: true, citations: [] };
  }
}

async function runCategoryReview(
  signals: PolymarketSignal[],
  marketsById: Map<string, PolymarketMarket>,
  options: PolymarketReviewerOptions,
  persona: CategoryPersona | undefined,
  stakes: StakesContext,
  logger: Pick<Console, "warn" | "error">,
  memorySnippet: string | null = null,
): Promise<PolymarketSignal[]> {
  const markets = signals
    .map((signal) => marketsById.get(signal.marketId))
    .filter((market): market is PolymarketMarket => Boolean(market));

  const reviewPayload = getReviewPayload({
    markets,
    signals,
    maxSignals: signals.length,
    persona,
  });

  if (!isPolymarketReviewerConfigured(options)) {
    logger.error(
      "[PolymarketReviewer] AI reviewer not configured; dropping all candidates so autonomous trading fails closed.",
    );
    return [];
  }

  const batchResult = await callReviewer(reviewPayload, options, persona, stakes, logger, memorySnippet);

  const escalationCitationsByMarket = new Map<string, CitationSummary[]>();
  void reviewIsContested;

  // Phase 1.5 — self-consistency split escalation.  Mirrors Kalshi reviewer.
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
            true,
          );
          const tiebreakerReview = tiebreaker.reviewsByMarket.get(signal.marketId);
          if (tiebreaker.failed || !tiebreakerReview) {
            return;
          }
          batchResult.reviewsByMarket.set(signal.marketId, tiebreakerReview);
          if (tiebreaker.citations.length > 0) {
            escalationCitationsByMarket.set(signal.marketId, tiebreaker.citations);
          }
        }),
      );
      logger.warn?.(
        `[PolymarketReviewer] Self-consistency escalation: resolved ${splitMarketIds.length} split market(s) via Sonnet tiebreaker.`,
      );
    }
  }

  return signals
    .map((signal) => {
      const review = batchResult.reviewsByMarket.get(signal.marketId);
      if (!review) {
        logger.warn(
          `[PolymarketReviewer] AI review missing for marketId=${signal.marketId} (desk=${persona?.id ?? "default"}); dropping signal.`,
        );
        return null;
      }
      const citations =
        escalationCitationsByMarket.get(signal.marketId) ?? batchResult.citations;
      return combineApprovedSignal(signal, review, logger, persona?.label, citations);
    })
    .filter((signal): signal is PolymarketSignal => Boolean(signal));
}

async function applyTriageFilter(
  signals: PolymarketSignal[],
  marketsById: Map<string, PolymarketMarket>,
  options: PolymarketReviewerOptions,
  logger: Pick<Console, "warn" | "error">,
): Promise<PolymarketSignal[]> {
  if (!isTriageEnabled()) return signals;
  if (!isPolymarketReviewerConfigured(options)) return signals;

  const threshold = options.triageThresholdOverride ?? getTriageThreshold();
  if (signals.length <= threshold) return signals;

  const triageClient = options.anthropicClient ?? createAnthropicClient(
    (options.anthropicApiKey ?? ENV.anthropicApiKey).trim(),
  );

  const triageInput: TriageCandidate[] = signals.map((signal) => {
    const market = marketsById.get(signal.marketId);
    return {
      marketId: signal.marketId,
      title: market?.question ?? "",
      category: market?.category ?? "",
      signalType: signal.signalType,
      side: signal.side,
      confidence: signal.confidence,
      expectedValue: signal.expectedValue,
      impliedProbability: signal.impliedProbabilityYes,
    };
  });

  const keep = await runHaikuTriage(triageClient as { messages: { create: (input: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }> } }, triageInput, {
    timeoutMs: Math.min(options.anthropicTimeoutMs ?? ENV.claudeHaikuTimeoutMs, 8000),
    logger,
  });
  if (options.telemetry) {
    options.telemetry.triageRan = true;
    options.telemetry.triageInputCount = signals.length;
    options.telemetry.triageKeptCount = keep ? Math.max(0, keep.size) : signals.length;
  }
  if (!keep) return signals;
  // Force-keep any candidate that is itself high-stakes — capital
  // preservation beats triage savings.  These always proceed to deep review.
  for (const signal of signals) {
    if (isHighStakes(stakesForSignals([signal]))) {
      keep.add(signal.marketId);
    }
  }
  if (options.telemetry) {
    options.telemetry.triageKeptCount = keep.size;
  }
  const filtered = signals.filter((signal) => keep.has(signal.marketId));
  return filtered.length > 0 ? filtered : signals;
}

async function loadDeskMemoryForBuckets(
  buckets: Map<MarketCategory, PolymarketSignal[]>,
  options: PolymarketReviewerOptions,
): Promise<Map<string, DeskMemoryRecord>> {
  if (options.deskMemoryByDeskId) return options.deskMemoryByDeskId;
  if (!ENV.enableAiDeskMemory) return new Map();
  if (!options.userId) return new Map();

  const deskIds = Array.from(buckets.keys()).map((category) => getCategoryPersona("polymarket", category).id);
  try {
    return await getDeskMemoryBatch(options.userId, "polymarket", deskIds);
  } catch (error) {
    options.logger?.warn?.(
      `[PolymarketReviewer] Failed to load desk memory: ${error instanceof Error ? error.message : String(error)}; continuing without memory.`,
    );
    return new Map();
  }
}

export async function reviewPolymarketSignalsWithTrader(
  input: {
    markets: PolymarketMarket[];
    signals: PolymarketSignal[];
    maxSignals?: number;
  },
  options: PolymarketReviewerOptions = {},
): Promise<PolymarketSignal[]> {
  if (input.signals.length === 0) return [];
  if (process.env.NODE_ENV === "test" && options.skipInTest !== false) {
    return input.signals;
  }

  const logger = options.logger ?? console;
  if (!isPolymarketReviewerConfigured(options)) {
    logger.error(
      "[PolymarketReviewer] AI reviewer not configured (ANTHROPIC_API_KEY required); dropping all candidates.",
    );
    return [];
  }

  const cap = input.maxSignals ?? DEFAULT_MAX_SIGNALS;
  const cappedSignals = input.signals.slice(0, cap);
  const marketsById = new Map(input.markets.map((market) => [market.marketId, market]));

  const triagedSignals = await applyTriageFilter(cappedSignals, marketsById, options, logger);

  if (!ENV.enableAiCategoryRouting) {
    return runCategoryReview(
      triagedSignals,
      marketsById,
      options,
      undefined,
      stakesForSignals(triagedSignals),
      logger,
    );
  }

  const buckets = groupByCategory(triagedSignals, (signal) => {
    const market = marketsById.get(signal.marketId);
    return { category: market?.category, question: market?.question };
  });

  const memoryByDeskId = await loadDeskMemoryForBuckets(buckets, options);

  const batches = await Promise.all(
    Array.from(buckets.entries()).map(([category, batchSignals]) => {
      const persona = getCategoryPersona("polymarket", category);
      const stakes = stakesForSignals(batchSignals);
      const memorySnippet = formatDeskMemoryForPrompt(memoryByDeskId.get(persona.id) ?? null);
      return runCategoryReview(
        batchSignals,
        marketsById,
        options,
        persona,
        stakes,
        logger,
        memorySnippet,
      );
    }),
  );

  const approved = new Map<string, PolymarketSignal>();
  for (const batch of batches) {
    for (const signal of batch) {
      approved.set(signal.marketId, signal);
    }
  }
  return triagedSignals
    .map((signal) => approved.get(signal.marketId))
    .filter((signal): signal is PolymarketSignal => Boolean(signal));
}

export { categoryOfPolymarketSignal };
