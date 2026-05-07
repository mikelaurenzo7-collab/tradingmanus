import { createOpenRouterClient } from "./openrouterClient";
import { createGrokChatCompletion, extractGrokText } from "./grokClient";
import type { KalshiMarket } from "./kalshiMarketData";
import type { KalshiSignal } from "./kalshiSignals";
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
import { getGrokPersona, type GrokPersona } from "./grokPersonas";
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
  /** NEW: Force Grok solo mode (overrides ENV) */
  forceGrokSolo?: boolean;
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
 * The reviewer is "configured" as long as Claude or Grok is available.
 */
export function isTradingReviewerConfigured(options: TradingReviewerOptions = {}) {
  const hasClaude = (options.anthropicApiKey ?? ENV.openrouterApiKey).trim().length > 0;
  const hasGrok = ENV.xaiApiKey.trim().length > 0;
  return hasClaude || hasGrok;
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
  persona?: CategoryPersona | GrokPersona;
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
    const notional = Number(signal.marketPrice ?? 0) * 100;
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

function buildReviewerBaseMandate(persona?: CategoryPersona | GrokPersona): string {
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
) {
  const client = options.anthropicClient ?? createOpenRouterClient(
    (options.anthropicApiKey ?? ENV.openrouterApiKey).trim(),
  );

  const useDeepModel = forceDeep || isHighStakes(stakes);
  // Deep-tier calls (Opus + extended thinking + multiple web_search uses)
  // need a wider wall-clock budget; bulk Sonnet stays on the tight default
  // so missed cron ticks remain rare.
  const timeoutMs = useDeepModel
    ? Math.max(options.anthropicTimeoutMs ?? 0, ENV.anthropicDeepTimeoutMs)
    : options.anthropicTimeoutMs ?? ENV.anthropicTimeoutMs;
  const tier = useDeepModel ? "deep" : "review";
  const model = selectAnthropicModel(tier, options.anthropicModel);
  // When forcing deep review (intra-Claude escalation), promote the stakes
  // context so buildExtendedThinking actually fires regardless of the
  // original heuristic.
  const stakesForCall = forceDeep ? { ...stakes, highStakes: true } : stakes;
  const thinking = buildExtendedThinking(stakesForCall);
  // Bumped from 4 → 6 on deep tier.  Sports lineups, weather, news primaries,
  // and macro consensus often need multiple targeted queries to triangulate.
  const tools = buildToolList([], {
    allowWebSearch: true,
    maxWebSearchUses: useDeepModel ? 6 : 2,
  });

  // Build the system prompt as up to two cached blocks: persona mandate
  // (changes rarely) + desk memory (updates after every trade outcome).
  // Splitting them lets the persona block stay cache-warm even when memory
  // changes between runs.
  const personaBlocks = ENV.enableAiPromptCache
    ? buildCachedSystemPrompt(buildReviewerBaseMandate(persona))
    : null;
  const memoryBlock = ENV.enableAiDeskMemory ? buildMemorySystemBlock(memorySnippet) : null;

  const messageInput: Record<string, unknown> = {
    model,
    max_tokens: useDeepModel ? 3200 : 1800,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: JSON.stringify(reviewPayload),
      },
    ],
  };
  if (personaBlocks) {
    messageInput.system = memoryBlock ? [...personaBlocks, memoryBlock] : personaBlocks;
  } else {
    messageInput.system = memorySnippet
      ? `${buildReviewerBaseMandate(persona)}\n\n${memorySnippet}`
      : buildReviewerBaseMandate(persona);
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

  const citations = ENV.enableAiCitations
    ? extractCitations(response as { content: Array<unknown> })
    : [];

  return {
    provider: "anthropic" as const,
    reviews: parseTradingReviews(extractAnthropicText(response)),
    citations,
  };
}

// NEW: Grok review request (simpler, no prompt cache / extended thinking / web_search for v1)
async function requestGrokReviews(
  reviewPayload: ReturnType<typeof getReviewPayload>,
  options: TradingReviewerOptions,
  persona?: GrokPersona,
  stakes: StakesContext = {},
  memorySnippet: string | null = null,
) {
  if (!ENV.xaiApiKey) {
    throw new Error("XAI_API_KEY required for Grok review");
  }

  const systemPrompt = buildReviewerBaseMandate(persona) + (memorySnippet ? `\n\n${memorySnippet}` : "");
  const userContent = JSON.stringify(reviewPayload);

  const completion = await createGrokChatCompletion(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    {
      model: ENV.grokModel,
      temperature: 0,
      max_tokens: 3200,
      timeoutMs: ENV.grokTimeoutMs,
    }
  );

  const text = extractGrokText(completion);
  const reviews = parseTradingReviews(text);

  if (options.telemetry) {
    options.telemetry.grokCalls = (options.telemetry.grokCalls ?? 0) + 1;
    if (persona && !options.telemetry.desks.includes(persona.id)) {
      options.telemetry.desks.push(persona.id);
    }
  }

  return {
    provider: "grok" as const,
    reviews,
    citations: [], // Grok v1 doesn't return citations in the same format
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
};

async function callReviewer(
  reviewPayload: ReturnType<typeof getReviewPayload>,
  options: TradingReviewerOptions,
  persona: CategoryPersona | GrokPersona | undefined,
  stakes: StakesContext,
  logger: Pick<Console, "warn" | "error">,
  memorySnippet: string | null = null,
  forceDeep = false,
): Promise<ReviewBatchResult> {
  try {
    // NEW: Route to Grok if solo mode or team mode with Grok persona
    const useGrok = options.forceGrokSolo || ENV.enableGrokSolo || (ENV.enableGrokTeam && persona && (persona as any).id?.startsWith("grok."));

    if (useGrok && ENV.xaiApiKey) {
      const response = await requestGrokReviews(
        reviewPayload,
        options,
        persona as GrokPersona | undefined,
        stakes,
        memorySnippet,
      );
      return {
        reviewsByMarket: new Map(response.reviews.map((review) => [review.marketId, review])),
        failed: false,
        citations: response.citations,
      };
    }

    // Default: Claude path
    const response = await requestAnthropicReviews(
      reviewPayload,
      options,
      persona as CategoryPersona | undefined,
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
      if ((options.forceGrokSolo || ENV.enableGrokSolo) && ENV.xaiApiKey) {
        options.telemetry.grokFailures = (options.telemetry.grokFailures ?? 0) + 1;
      } else {
        options.telemetry.anthropicFailures += 1;
      }
    }
    logger.warn(
      `[TradingReviewer] AI review failed for desk=${(persona as any)?.id ?? "default"}: ${error instanceof Error ? error.message : String(error)}`,
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
  persona: CategoryPersona | GrokPersona | undefined,
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

  // Intra-Claude second opinion: when the bulk Sonnet pass approves a
  // non-high-stakes trade but materially tugged confidence down or moved EV,
  // run a single-market Opus second pass.  Both must agree to keep the trade;
  // disagreement (or a failed second pass) drops the trade per fail-closed
  // semantics.  This recreates the OpenAI second-opinion behavior we removed,
  // entirely within Claude and only on contested mid-stakes candidates.
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
            // Fail-closed: drop the contested signal if Opus didn't return
            // a clean second opinion.
            batchResult.reviewsByMarket.set(signal.marketId, {
              marketId: signal.marketId,
              approved: false,
              reasoning: "Intra-model second opinion unavailable; capital preservation veto.",
            });
            return;
          }
          if (!deepReview.approved) {
            // Disagreement → drop.
            batchResult.reviewsByMarket.set(signal.marketId, deepReview);
            return;
          }
          // Both Sonnet and Opus approved: keep the deep-tier review (it has
          // the more considered confidence/EV adjustments) and surface its
          // citations on the trade.
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
 * Optional Haiku pre-filter: when the candidate batch is large, drop obvious
 * junk before paying Sonnet/Opus prices.  Returns the input unchanged (capital preservation > cost).
 */
async function applyTriageFilter(
  signals: KalshiSignal[],
  marketsById: Map<string, KalshiMarket>,
  options: TradingReviewerOptions,
  logger: Pick<Console, "warn" | "error">,
): Promise<KalshiSignal[]> {
  if (!isTriageEnabled()) return signals;
  if (!isTradingReviewerConfigured(options)) return signals;

  const threshold = options.triageThresholdOverride ?? getTriageThreshold();
  if (signals.length <= threshold) return signals;

  const triageClient = options.anthropicClient ?? createOpenRouterClient(
    (options.anthropicApiKey ?? ENV.openrouterApiKey).trim(),
  );

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
      "[TradingReviewer] AI reviewer not configured (need OPENROUTER_API_KEY or XAI_API_KEY); dropping all candidates.",
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

  // NEW: Solo Grok mode - bypass category routing and use Grok for everything
  if (options.forceGrokSolo || ENV.enableGrokSolo) {
    if (!ENV.xaiApiKey) {
      logger.error("[TradingReviewer] ENABLE_GROK_SOLO true but no XAI_API_KEY; falling back to Claude.");
    } else {
      const grokPersona = getGrokPersona("kalshi", "other"); // generalist for solo
      const stakes = stakesForSignals(triagedSignals);
      const memorySnippet = options.userId ? formatDeskMemoryForPrompt((await loadDeskMemoryForBuckets(new Map([["other", triagedSignals]]), options)).get(grokPersona.id) ?? null) : null;
      return runCategoryReview(
        triagedSignals,
        marketsById,
        options,
        grokPersona,
        stakes,
        logger,
        memorySnippet,
      );
    }
  }

  // When category routing is disabled, fall back to a single combined batch so
  // the public behavior still matches the original single-mandate reviewer.
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
    return { category: market?.category, title: market?.title };
  });

  const memoryByDeskId = await loadDeskMemoryForBuckets(buckets, options);

  const batches = await Promise.all(
    Array.from(buckets.entries()).map(([category, batchSignals]) => {
      const persona = getCategoryPersona("kalshi", category);
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
