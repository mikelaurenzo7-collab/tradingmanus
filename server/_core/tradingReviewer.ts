import Anthropic from "@anthropic-ai/sdk";
import type { KalshiMarket } from "./kalshiMarketData";
import type { KalshiSignal } from "./kalshiSignals";
import { ENV } from "./env";
import { z } from "zod";

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

type ProviderReviewResponse = {
  provider: ProviderName;
  reviews: TradingSignalReview[];
};

const DEFAULT_OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MAX_SIGNALS = 12;

const reviewSchema = z.object({
  marketId: z.string().min(1),
  approved: z.boolean(),
  confidenceAdjustment: z.number().finite().optional(),
  expectedValueAdjustment: z.number().finite().optional(),
  reasoning: z.string().trim().max(240).optional(),
});

const reviewResponseSchema = z.union([
  z.object({
    reviews: z.array(reviewSchema),
  }),
  z.array(reviewSchema),
]);

export type TradingReviewerOptions = {
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

export function isTradingReviewerConfigured(options: TradingReviewerOptions = {}) {
  return getActiveProviders(options).length > 0;
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

function summarizeMarket(market: KalshiMarket) {
  return {
    id: market.id,
    title: market.title,
    category: market.category,
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
    reasoning: signal.reasoning,
    liquidityScore: signal.metadata?.liquidityScore ?? null,
    spreadProxy: signal.metadata?.spreadProxy ?? null,
    totalVolume: signal.metadata?.totalVolume ?? null,
  };
}

function getActiveProviders(options: TradingReviewerOptions) {
  const requestedProviders = options.providers ?? ["openai", "anthropic"];

  return requestedProviders.filter((provider) => {
    if (provider === "openai") {
      return (options.openaiApiKey ?? ENV.openaiApiKey).trim().length > 0;
    }

    return (options.anthropicApiKey ?? ENV.anthropicApiKey).trim().length > 0;
  });
}

function getReviewPayload(input: {
  markets: KalshiMarket[];
  signals: KalshiSignal[];
  maxSignals: number;
}) {
  const signalsForReview = input.signals.slice(0, input.maxSignals);
  const marketById = new Map(input.markets.map((market) => [market.id, market]));

  return {
    mandate:
      "Review candidate Kalshi signals. Approve only if the trade has a clear reason, adequate liquidity, bounded binary-market downside, and no obvious stale/thin-market issue. Veto vague, purely heuristic, low-EV, or weak-liquidity candidates. Do not invent market facts beyond the payload.",
    outputSchema:
      "{ reviews: Array<{marketId:string, approved:boolean, confidenceAdjustment:number between -0.25 and 0.15, expectedValueAdjustment:number between -0.1 and 0.1, reasoning:string <= 240 chars}> }",
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

function getAnthropicText(payload: Awaited<ReturnType<AnthropicClient["messages"]["create"]>>) {
  return payload.content
    .map((block) => (block.type === "text" ? block.text ?? "" : ""))
    .join("\n")
    .trim();
}

async function requestOpenAiReviews(
  reviewPayload: ReturnType<typeof getReviewPayload>,
  options: TradingReviewerOptions
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
            {
              role: "system",
              content:
                "You are OpenAI acting as a conservative Kalshi trading reviewer for one founder's small live account. You never place trades directly. You only approve, veto, or modestly adjust signal confidence and expected value. Capital preservation, liquidity, bounded downside, and avoiding weak heuristic trades are mandatory. Respond with a JSON object shaped as {\"reviews\":[...]} and nothing else.",
            },
            {
              role: "user",
              content: JSON.stringify(reviewPayload),
            },
          ],
        }),
        signal: controller.signal,
      }
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
  options: TradingReviewerOptions
) {
  const timeoutMs = options.anthropicTimeoutMs ?? ENV.anthropicTimeoutMs;
  const client = options.anthropicClient ?? new Anthropic({
    apiKey: (options.anthropicApiKey ?? ENV.anthropicApiKey).trim(),
  });

  const response = await Promise.race([
    client.messages.create({
      model: options.anthropicModel ?? ENV.anthropicModel,
      max_tokens: 1800,
      temperature: 0,
      system:
        "You are Claude acting as a conservative Kalshi trading reviewer for one founder's small live account. You do not place trades directly. You only approve, veto, or modestly adjust signal confidence and expected value. Capital preservation, liquidity, bounded downside, and avoiding weak heuristic trades are mandatory. Respond with JSON only as {\"reviews\":[...]}.",
      messages: [
        {
          role: "user",
          content: JSON.stringify(reviewPayload),
        },
      ],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Anthropic review timed out")), timeoutMs)
    ),
  ]);

  return {
    provider: "anthropic" as const,
    reviews: parseTradingReviews(getAnthropicText(response)),
  };
}

function combineApprovedSignal(
  signal: KalshiSignal,
  providerReviews: Array<{ provider: ProviderName; review: TradingSignalReview }>,
  logger: Pick<Console, "warn" | "error">
) {
  if (providerReviews.length === 0) {
    logger.warn(
      `[TradingReviewer] No provider approvals for marketId=${signal.marketId}; dropping signal.`
    );
    return null;
  }

  for (const providerReview of providerReviews) {
    if (!providerReview.review.approved) {
      return null;
    }
  }

  const confidenceAdjustment = providerReviews.reduce(
    (total, providerReview) =>
      total + clamp(Number(providerReview.review.confidenceAdjustment ?? 0), -0.25, 0.15),
    0
  ) / providerReviews.length;

  const expectedValueAdjustment = providerReviews.reduce(
    (total, providerReview) =>
      total + clamp(Number(providerReview.review.expectedValueAdjustment ?? 0), -0.1, 0.1),
    0
  ) / providerReviews.length;

  const reviewerReasoning = providerReviews
    .map(({ provider, review }) => {
      const prefix = provider === "openai" ? "OpenAI" : "Claude";
      const text = review.reasoning?.trim().slice(0, 240) || `${prefix} approved after conservative review.`;
      return `${prefix}: ${text}`;
    })
    .join(" | ");

  return {
    ...signal,
    confidence: clamp(signal.confidence + confidenceAdjustment, 0.01, 0.99),
    expectedValue: Math.max(0, signal.expectedValue + expectedValueAdjustment),
    reasoning: `${signal.reasoning} | AI trader duo: ${reviewerReasoning}`,
  };
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
  const activeProviders = getActiveProviders(options);
  if (activeProviders.length === 0) {
    logger.error(
      "[TradingReviewer] No AI trader providers are configured; dropping all candidates so autonomous trading fails closed."
    );
    return [];
  }

  const reviewPayload = getReviewPayload({
    markets: input.markets,
    signals: input.signals,
    maxSignals: input.maxSignals ?? DEFAULT_MAX_SIGNALS,
  });

  try {
    const responses = await Promise.all(
      activeProviders.map((provider) =>
        provider === "openai"
          ? requestOpenAiReviews(reviewPayload, options)
          : requestAnthropicReviews(reviewPayload, options)
      )
    );

    const reviewsByProvider = new Map<ProviderName, Map<string, TradingSignalReview>>();
    for (const response of responses) {
      reviewsByProvider.set(
        response.provider,
        new Map(response.reviews.map((review) => [review.marketId, review]))
      );
    }

    return input.signals
      .map((signal) => {
        const providerReviews = activeProviders.map((provider) => {
          const review = reviewsByProvider.get(provider)?.get(signal.marketId);
          if (!review) {
            logger.warn(
              `[TradingReviewer] ${provider} did not return a review for marketId=${signal.marketId}; dropping signal.`
            );
            return null;
          }

          return { provider, review };
        });

        if (providerReviews.some((review) => review === null)) {
          return null;
        }

        return combineApprovedSignal(
          signal,
          providerReviews.filter(
            (review): review is { provider: ProviderName; review: TradingSignalReview } =>
              Boolean(review)
          ),
          logger
        );
      })
      .filter((signal): signal is KalshiSignal => Boolean(signal));
  } catch (error) {
    logger.error(
      "[TradingReviewer] Duo AI review failed; dropping all candidates (no autonomous execution without explicit OpenAI + Claude approval):",
      error
    );
    return [];
  }
}
