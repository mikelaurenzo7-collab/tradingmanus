/**
 * Polymarket Signal Reviewer — Claude-primary, OpenAI optional fallback / escalation.
 *
 * Topology:
 *   - Claude (per-category persona, prompt-cached, web_search-enabled, extended
 *     thinking on high-stakes) is the primary reviewer and the gate for normal
 *     trades.
 *   - OpenAI is optional. When configured it serves two roles:
 *       (a) automatic fallback for any market Claude failed to review
 *       (b) second-opinion escalation for high-stakes trades (both must approve)
 *   - When neither provider has an approval for a market, the signal is dropped.
 */

import Anthropic from "@anthropic-ai/sdk";
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
  runHaikuTriage,
  selectAnthropicModel,
  type CitationSummary,
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

type ProviderName = "openai" | "anthropic";

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

const DEFAULT_OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MAX_SIGNALS = 12;
const MAX_REASONING_CHARS = 240;
export const MAX_MARKET_SUMMARY_TITLE_CHARS = 160;
export const MAX_MARKET_SUMMARY_CATEGORY_CHARS = 80;
export const MAX_SIGNAL_SUMMARY_REASONING_CHARS = 320;

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
  providers?: ProviderName[];
  skipInTest?: boolean;
  logger?: Pick<Console, "warn" | "error">;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiTimeoutMs?: number;
  openaiEndpoint?: string;
  openaiFetchImpl?: typeof fetch;
  anthropicApiKey?: string;
  anthropicModel?: string;
  anthropicTimeoutMs?: number;
  anthropicClient?: AnthropicClient;
  userId?: number;
  deskMemoryByDeskId?: Map<string, DeskMemoryRecord>;
  triageThresholdOverride?: number;
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
 * The reviewer is "configured" as long as Claude (the primary reviewer) is
 * available.  OpenAI is optional and only used as a fallback / escalation.
 */
export function isPolymarketReviewerConfigured(
  options: PolymarketReviewerOptions = {},
) {
  return getActiveProviders(options).includes("anthropic");
}

export function isPolymarketOpenAiFallbackConfigured(
  options: PolymarketReviewerOptions = {},
) {
  return getActiveProviders(options).includes("openai");
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

const ALL_PROVIDERS: ProviderName[] = ["anthropic", "openai"];

function getActiveProviders(options: PolymarketReviewerOptions) {
  const requestedProviders = options.providers ?? ALL_PROVIDERS;
  return requestedProviders.filter((provider) => {
    if (provider === "openai") {
      return (options.openaiApiKey ?? ENV.openaiApiKey).trim().length > 0;
    }
    return (options.anthropicApiKey ?? ENV.anthropicApiKey).trim().length > 0;
  });
}

function stakesForSignals(signals: PolymarketSignal[]): StakesContext {
  let topConfidence = 0;
  let topNotional = 0;
  for (const signal of signals) {
    if (signal.confidence > topConfidence) topConfidence = signal.confidence;
    const notional = Number(signal.limitPrice ?? 0) * 100;
    if (notional > topNotional) topNotional = notional;
  }
  return { confidence: topConfidence, orderNotional: topNotional };
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

function getOpenAiText(payload: unknown) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "choices" in payload &&
    Array.isArray(payload.choices)
  ) {
    const content = payload.choices[0]?.message?.content;
    if (typeof content === "string") {
      return content.trim();
    }
  }
  throw new Error("OpenAI response did not include JSON message content");
}

function buildOpenAiSystemPrompt(persona?: CategoryPersona): string {
  const desk = persona?.label ?? "Polymarket Generalist Desk";
  const personaMandate = persona?.systemMandate
    ? `\n\nDesk-specific mandate (${desk}):\n${persona.systemMandate}`
    : "";
  return (
    "You are OpenAI acting as a conservative Polymarket trading reviewer for one founder's small live account. You never place trades directly. You only approve, veto, or modestly adjust signal confidence and expected value. Capital preservation, liquidity, bounded downside, avoiding weak heuristic trades, and detecting wash-trading patterns are mandatory. Respond with a JSON object shaped as {\"reviews\":[...]} and nothing else." +
    personaMandate
  );
}

function buildAnthropicBaseMandate(persona?: CategoryPersona): string {
  const desk = persona?.label ?? "Polymarket Generalist Desk";
  const personaMandate = persona?.systemMandate
    ? `\n\nDesk-specific mandate (${desk}):\n${persona.systemMandate}`
    : "";
  return (
    "You are Claude acting as a conservative Polymarket trading reviewer for one founder's small live account. You do not place trades directly. You only approve, veto, or modestly adjust signal confidence and expected value. Capital preservation, liquidity, bounded downside, avoiding weak heuristic trades, and detecting wash-trading patterns are mandatory. Respond with JSON only as {\"reviews\":[...]}." +
    personaMandate
  );
}

async function requestOpenAiReviews(
  reviewPayload: ReturnType<typeof getReviewPayload>,
  options: PolymarketReviewerOptions,
  persona?: CategoryPersona,
) {
  const controller = new AbortController();
  const timeoutMs = options.openaiTimeoutMs ?? ENV.openaiTimeoutMs;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await (options.openaiFetchImpl ?? fetch)(
      options.openaiEndpoint ?? DEFAULT_OPENAI_ENDPOINT,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${(options.openaiApiKey ?? ENV.openaiApiKey).trim()}`,
        },
        body: JSON.stringify({
          model: options.openaiModel ?? ENV.openaiModel,
          temperature: 0,
          max_tokens: 1400,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: buildOpenAiSystemPrompt(persona) },
            { role: "user", content: JSON.stringify(reviewPayload) },
          ],
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`OpenAI request failed with status ${response.status}`);
    }

    return {
      provider: "openai" as const,
      reviews: parseTradingReviews(getOpenAiText(await response.json())),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestAnthropicReviews(
  reviewPayload: ReturnType<typeof getReviewPayload>,
  options: PolymarketReviewerOptions,
  persona?: CategoryPersona,
  stakes: StakesContext = {},
  memorySnippet: string | null = null,
) {
  const timeoutMs = options.anthropicTimeoutMs ?? ENV.anthropicTimeoutMs;
  const client =
    options.anthropicClient ??
    new Anthropic({ apiKey: (options.anthropicApiKey ?? ENV.anthropicApiKey).trim() });

  const useDeepModel = isHighStakes(stakes);
  const tier = useDeepModel ? "deep" : "review";
  const model = selectAnthropicModel(tier, options.anthropicModel);
  const thinking = buildExtendedThinking(stakes);
  const tools = buildToolList([], {
    allowWebSearch: true,
    maxWebSearchUses: useDeepModel ? 4 : 2,
  });

  const personaBlocks = ENV.enableAiPromptCache
    ? buildCachedSystemPrompt(buildAnthropicBaseMandate(persona))
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
      ? `${buildAnthropicBaseMandate(persona)}\n\n${memorySnippet}`
      : buildAnthropicBaseMandate(persona);
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

  const citations = ENV.enableAiCitations
    ? extractCitations(response as { content: Array<unknown> })
    : [];

  return {
    provider: "anthropic" as const,
    reviews: parseTradingReviews(extractAnthropicText(response)),
    citations,
  };
}

function combineApprovedSignal(
  signal: PolymarketSignal,
  providerReviews: Array<{ provider: ProviderName; review: TradingSignalReview }>,
  logger: Pick<Console, "warn" | "error">,
  desk?: string,
  citations: CitationSummary[] = [],
) {
  if (providerReviews.length === 0) {
    logger.warn(
      `[PolymarketReviewer] No provider approvals for marketId=${signal.marketId} (desk=${desk ?? "default"}); dropping signal.`,
    );
    return null;
  }

  for (const providerReview of providerReviews) {
    if (!providerReview.review.approved) return null;
  }

  const confidenceAdjustment =
    providerReviews.reduce(
      (total, providerReview) =>
        total + clamp(Number(providerReview.review.confidenceAdjustment ?? 0), -0.25, 0.15),
      0,
    ) / providerReviews.length;

  const expectedValueAdjustment =
    providerReviews.reduce(
      (total, providerReview) =>
        total + clamp(Number(providerReview.review.expectedValueAdjustment ?? 0), -0.1, 0.1),
      0,
    ) / providerReviews.length;

  const reviewerReasoning = providerReviews
    .map(({ provider, review }) => {
      const prefix = provider === "openai" ? "OpenAI" : "Claude";
      const text =
        review.reasoning?.trim().slice(0, MAX_REASONING_CHARS) ||
        prefix.concat(" approved after conservative review.");
      return `${prefix}: ${text}`;
    })
    .join(" | ");

  const ledger = providerReviews.length === 1
    ? `${providerReviews[0]?.provider === "anthropic" ? "Claude" : "OpenAI"} solo review`
    : "AI trader duo";
  const deskLabel = desk ? ` [${desk}]` : "";
  const citationLabel = formatCitationsForReasoning(citations);

  return {
    ...signal,
    confidence: clamp(signal.confidence + confidenceAdjustment, 0.01, 0.99),
    expectedValue: Math.max(0, signal.expectedValue + expectedValueAdjustment),
    reasoning: `${signal.reasoning} | ${ledger}${deskLabel}: ${reviewerReasoning}${citationLabel}`,
  };
}

type ProviderBatchResult = {
  provider: ProviderName;
  reviewsByMarket: Map<string, TradingSignalReview>;
  failed: boolean;
  citations: CitationSummary[];
};

async function callProvider(
  provider: ProviderName,
  reviewPayload: ReturnType<typeof getReviewPayload>,
  options: PolymarketReviewerOptions,
  persona: CategoryPersona | undefined,
  stakes: StakesContext,
  logger: Pick<Console, "warn" | "error">,
  memorySnippet: string | null = null,
): Promise<ProviderBatchResult> {
  try {
    const response =
      provider === "openai"
        ? await requestOpenAiReviews(reviewPayload, options, persona)
        : await requestAnthropicReviews(reviewPayload, options, persona, stakes, memorySnippet);
    return {
      provider,
      reviewsByMarket: new Map(response.reviews.map((review) => [review.marketId, review])),
      failed: false,
      citations: "citations" in response ? response.citations : [],
    };
  } catch (error) {
    logger.warn(
      `[PolymarketReviewer] ${provider} review failed for desk=${persona?.id ?? "default"}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { provider, reviewsByMarket: new Map(), failed: true, citations: [] };
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

  const claudeConfigured = isPolymarketReviewerConfigured(options);
  const openaiConfigured = isPolymarketOpenAiFallbackConfigured(options);
  const escalateToOpenAi = isHighStakes(stakes) && openaiConfigured;

  if (!claudeConfigured && !openaiConfigured) {
    logger.error(
      "[PolymarketReviewer] No reviewer providers configured; dropping all candidates so autonomous trading fails closed.",
    );
    return [];
  }

  const providerCalls: Promise<ProviderBatchResult>[] = [];
  if (claudeConfigured) {
    providerCalls.push(
      callProvider("anthropic", reviewPayload, options, persona, stakes, logger, memorySnippet),
    );
  }
  if (openaiConfigured) {
    providerCalls.push(callProvider("openai", reviewPayload, options, persona, stakes, logger));
  }

  const batchResults = await Promise.all(providerCalls);
  const byProvider = new Map<ProviderName, ProviderBatchResult>(
    batchResults.map((result) => [result.provider, result]),
  );
  const claudeBatch = byProvider.get("anthropic");
  const openaiBatch = byProvider.get("openai");
  const claudeCitations = claudeBatch?.citations ?? [];

  return signals
    .map((signal) => {
      const claudeReview = claudeBatch?.reviewsByMarket.get(signal.marketId);
      const openaiReview = openaiBatch?.reviewsByMarket.get(signal.marketId);

      if (claudeReview) {
        if (!claudeReview.approved) return null;
        if (escalateToOpenAi) {
          if (!openaiReview) {
            logger.warn(
              `[PolymarketReviewer] OpenAI second-opinion missing for high-stakes marketId=${signal.marketId}; dropping for safety.`,
            );
            return null;
          }
          if (!openaiReview.approved) return null;
          return combineApprovedSignal(
            signal,
            [
              { provider: "anthropic", review: claudeReview },
              { provider: "openai", review: openaiReview },
            ],
            logger,
            persona?.label,
            claudeCitations,
          );
        }
        return combineApprovedSignal(
          signal,
          [{ provider: "anthropic", review: claudeReview }],
          logger,
          persona?.label,
          claudeCitations,
        );
      }

      if (!openaiReview) {
        logger.warn(
          `[PolymarketReviewer] Both providers missing review for marketId=${signal.marketId} (desk=${persona?.id ?? "default"}); dropping signal.`,
        );
        return null;
      }
      if (!openaiReview.approved) return null;
      return combineApprovedSignal(
        signal,
        [{ provider: "openai", review: openaiReview }],
        logger,
        persona?.label,
      );
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

  const triageClient = options.anthropicClient ?? new Anthropic({
    apiKey: (options.anthropicApiKey ?? ENV.anthropicApiKey).trim(),
  });

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
  if (!keep) return signals;
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
  if (!isPolymarketReviewerConfigured(options) && !isPolymarketOpenAiFallbackConfigured(options)) {
    logger.error(
      "[PolymarketReviewer] No reviewer provider configured (need ANTHROPIC_API_KEY at minimum, OPENAI_API_KEY optional fallback); dropping all candidates.",
    );
    return [];
  }
  if (!isPolymarketReviewerConfigured(options)) {
    logger.warn(
      "[PolymarketReviewer] ANTHROPIC_API_KEY missing; running OpenAI-only fallback mode. This is a degraded configuration.",
    );
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
