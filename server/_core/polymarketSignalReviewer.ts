/**
 * Polymarket Signal Reviewer — dual-bot consensus (Claude + Grok).
 *
 * Topology:
 *   - Claude (per-category persona, prompt-cached, web_search-enabled, extended
 *     thinking on high-stakes) is the primary reviewer.
 *   - Grok (xAI) runs in parallel when ENABLE_GROK_TEAM=true and XAI_API_KEY
 *     is set.  Both must approve the trade for it to pass; either-side veto
 *     drops the signal (fail-closed dual-bot consensus).
 *   - When XAI_API_KEY is unset, Grok is skipped silently and Claude reviews
 *     alone — the audit log records `grokSkipped:true` so the operator can
 *     see consensus periods vs. solo periods.
 *   - If Claude fails to return a review for a market, the signal is dropped
 *     per fail-closed logic.
 */

import { createAnthropicClient } from "./anthropicClient";
import { createGrokChatCompletion, extractGrokText } from "./grokClient";
import type { PolymarketMarket } from "./polymarketAuth";
import type { PolymarketSignal } from "./polymarketSignals";
import { ENV } from "./env";
import { z } from "zod";
import {
  buildCachedSystemPrompt,
  buildExtendedThinking,
  buildMemorySystemBlock,
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

type ProviderName = "anthropic" | "grok";

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
    const notional = Number(signal.limitPrice ?? 0) * 100;
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
) {
  const client =
    options.anthropicClient ??
    createAnthropicClient((options.anthropicApiKey ?? ENV.anthropicApiKey).trim());

  const useDeepModel = forceDeep || isHighStakes(stakes);
  // Wider wall-clock budget for deep-tier calls.
  const timeoutMs = useDeepModel
    ? Math.max(options.anthropicTimeoutMs ?? 0, ENV.anthropicDeepTimeoutMs)
    : options.anthropicTimeoutMs ?? ENV.anthropicTimeoutMs;
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

  const messageInput: Record<string, unknown> = {
    model,
    max_tokens: useDeepModel ? 3200 : 1800,
    temperature: 0,
    messages: [{ role: "user", content: JSON.stringify(reviewPayload) }],
  };
  if (personaBlocks) {
    messageInput.system = memoryBlock ? [...personaBlocks, memoryBlock] : personaBlocks;
  } else {
    messageInput.system = memorySnippet
      ? `${buildReviewerBaseMandate(persona)}\n\n${memorySnippet}`
      : buildReviewerBaseMandate(persona);
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

  const citations = ENV.enableAiCitations
    ? extractCitations(response as { content: Array<unknown> })
    : [];

  return {
    provider: "anthropic" as const,
    reviews: parseTradingReviews(extractAnthropicText(response)),
    citations,
  };
}

/**
 * Grok parallel review on a Polymarket batch.  Identical input/output shape to
 * the Anthropic path so callers can intersect approvals trivially.  Returns
 * an empty review list if XAI_API_KEY is unset; the caller decides what to
 * do (skip-grok-but-keep-claude or drop).
 */
async function requestGrokPolymarketReviews(
  reviewPayload: ReturnType<typeof getReviewPayload>,
  options: PolymarketReviewerOptions,
  persona?: CategoryPersona,
  memorySnippet: string | null = null,
): Promise<{ reviews: TradingSignalReview[]; failed: boolean }> {
  if (!ENV.xaiApiKey) {
    return { reviews: [], failed: false };
  }

  const systemPrompt =
    buildReviewerBaseMandate(persona) +
    (memorySnippet ? `\n\n${memorySnippet}` : "");

  try {
    const completion = await createGrokChatCompletion(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(reviewPayload) },
      ],
      {
        model: ENV.grokModel,
        temperature: 0,
        max_tokens: 3200,
        timeoutMs: ENV.grokTimeoutMs,
      },
    );

    const text = extractGrokText(completion);
    const reviews = parseTradingReviews(text);

    if (options.telemetry) {
      options.telemetry.grokCalls = (options.telemetry.grokCalls ?? 0) + 1;
    }

    return { reviews, failed: false };
  } catch (error) {
    if (options.telemetry) {
      options.telemetry.grokFailures = (options.telemetry.grokFailures ?? 0) + 1;
    }
    options.logger?.warn?.(
      `[PolymarketReviewer] Grok review failed: ${error instanceof Error ? error.message : String(error)}; falling back to Claude-only consensus on this batch.`,
    );
    return { reviews: [], failed: true };
  }
}

/**
 * Intersect Claude + Grok reviews into a single map keyed by marketId.  A
 * trade is "approved" only if BOTH bots return approved=true (true dual-bot
 * consensus).  When Grok is unavailable (no XAI_API_KEY or runtime failure),
 * Claude's verdict carries the trade — graceful degradation rather than
 * fail-closed, since the user opted into "Claude-only fallback" semantics.
 *
 * Confidence/EV adjustments take the more conservative of the two when both
 * approve: min of confidenceAdjustments, min of expectedValueAdjustments.
 */
function intersectReviews(
  claudeReviewsByMarket: Map<string, TradingSignalReview>,
  grokReviews: TradingSignalReview[],
): Map<string, TradingSignalReview> {
  if (grokReviews.length === 0) {
    return claudeReviewsByMarket;
  }
  const grokByMarket = new Map(grokReviews.map((r) => [r.marketId, r]));
  const merged = new Map<string, TradingSignalReview>();
  for (const [marketId, claudeReview] of claudeReviewsByMarket) {
    const grokReview = grokByMarket.get(marketId);
    if (!grokReview) {
      // Grok had no opinion on this market — keep Claude's verdict.
      merged.set(marketId, claudeReview);
      continue;
    }
    if (!claudeReview.approved || !grokReview.approved) {
      merged.set(marketId, {
        marketId,
        approved: false,
        reasoning: claudeReview.approved
          ? `Grok dissent: ${grokReview.reasoning ?? "(no reason)"}`
          : claudeReview.reasoning,
      });
      continue;
    }
    // Both approved — take the more conservative adjustments.
    const claudeConf = Number(claudeReview.confidenceAdjustment ?? 0);
    const grokConf = Number(grokReview.confidenceAdjustment ?? 0);
    const claudeEv = Number(claudeReview.expectedValueAdjustment ?? 0);
    const grokEv = Number(grokReview.expectedValueAdjustment ?? 0);
    merged.set(marketId, {
      marketId,
      approved: true,
      confidenceAdjustment: Math.min(claudeConf, grokConf),
      expectedValueAdjustment: Math.min(claudeEv, grokEv),
      reasoning: claudeReview.reasoning,
    });
  }
  return merged;
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
};

async function callReviewer(
  reviewPayload: ReturnType<typeof getReviewPayload>,
  options: PolymarketReviewerOptions,
  persona: CategoryPersona | undefined,
  stakes: StakesContext,
  logger: Pick<Console, "warn" | "error">,
  memorySnippet: string | null = null,
  forceDeep = false,
): Promise<ReviewBatchResult> {
  // Run Claude (primary) and Grok (parallel consensus) concurrently when team
  // mode is enabled and Grok is configured.  Both must approve for the trade
  // to pass; either-side veto drops the signal.  If Grok is missing or fails
  // at runtime, Claude's verdict carries (graceful degradation).
  const grokInTeam = ENV.enableGrokTeam && ENV.xaiApiKey.length > 0;
  try {
    const [claudeResp, grokResp] = await Promise.all([
      requestLLMReviews(reviewPayload, options, persona, stakes, memorySnippet, forceDeep),
      grokInTeam
        ? requestGrokPolymarketReviews(reviewPayload, options, persona, memorySnippet)
        : Promise.resolve({ reviews: [], failed: false }),
    ]);
    const claudeMap = new Map(claudeResp.reviews.map((r) => [r.marketId, r]));
    const merged = grokInTeam ? intersectReviews(claudeMap, grokResp.reviews) : claudeMap;
    return {
      reviewsByMarket: merged,
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

  // Intra-Claude second opinion on contested mid-stakes approvals.  See
  // tradingReviewer.ts for the full rationale; the polymarket pipeline uses
  // identical thresholds and fail-closed semantics.
  const escalationCitationsByMarket = new Map<string, CitationSummary[]>();
  if (
    ENV.enableAiIntraEscalation &&
    !isHighStakes(stakes) &&
    !batchResult.failed
  ) {
    const contestedSignals = signals.filter((signal) => {
      const review = batchResult.reviewsByMarket.get(signal.marketId);
      return review ? reviewIsContested(review) : false;
    });
    if (contestedSignals.length > 0) {
      await Promise.all(
        contestedSignals.map(async (signal) => {
          const market = marketsById.get(signal.marketId);
          if (!market) return;
          const singlePayload = getReviewPayload({
            markets: [market],
            signals: [signal],
            maxSignals: 1,
            persona,
          });
          const singleStakes: StakesContext = {
            ...stakesForSignals([signal]),
            highStakes: true,
          };
          const deepResult = await callReviewer(
            singlePayload,
            options,
            persona,
            singleStakes,
            logger,
            memorySnippet,
            true,
          );
          const deepReview = deepResult.reviewsByMarket.get(signal.marketId);
          if (deepResult.failed || !deepReview) {
            batchResult.reviewsByMarket.set(signal.marketId, {
              marketId: signal.marketId,
              approved: false,
              reasoning: "Intra-model second opinion unavailable; capital preservation veto.",
            });
            return;
          }
          if (!deepReview.approved) {
            batchResult.reviewsByMarket.set(signal.marketId, deepReview);
            return;
          }
          batchResult.reviewsByMarket.set(signal.marketId, deepReview);
          if (deepResult.citations.length > 0) {
            escalationCitationsByMarket.set(signal.marketId, deepResult.citations);
          }
        }),
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
    timeoutMs: Math.min(options.anthropicTimeoutMs ?? ENV.anthropicTimeoutMs, 8000),
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
