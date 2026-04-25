import type { KalshiMarket } from "./kalshiMarketData";
import type { KalshiSignal } from "./kalshiSignals";
import { ENV } from "./env";

type SignalReview = {
  marketId: string;
  approved: boolean;
  confidenceAdjustment?: number;
  expectedValueAdjustment?: number;
  reasoning?: string;
};

type OpenAiChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export function isOpenAiTraderConfigured() {
  return ENV.openAiApiKey.length > 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

function parseReviews(text: string): SignalReview[] {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
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

async function createOpenAiSignalReviews(payload: {
  markets: Array<Record<string, unknown>>;
  signals: Array<Record<string, unknown>>;
}) {
  const timeoutMs = 15_000;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENV.openAiApiKey}`,
      },
      signal: abortController.signal,
      body: JSON.stringify({
        model: ENV.openAiModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are an OpenAI trading risk reviewer for Kalshi signals. You do not place trades directly. You only approve, veto, or modestly adjust signal confidence. Capital preservation, liquidity, bounded downside, and avoiding weak heuristic trades are mandatory.",
          },
          {
            role: "user",
            content: JSON.stringify({
              mandate:
                "Review candidate Kalshi signals. Approve only if the trade has a clear reason, adequate liquidity, bounded binary-market downside, and no obvious stale/thin-market issue. Veto vague, purely heuristic, low-EV, or weak-liquidity candidates. Do not invent market facts beyond the payload.",
              outputSchema:
                "JSON object with key 'reviews' that is Array<{marketId:string, approved:boolean, confidenceAdjustment:number between -0.25 and 0.15, expectedValueAdjustment:number between -0.1 and 0.1, reasoning:string <= 240 chars}>",
              markets: payload.markets,
              signals: payload.signals,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI request failed with status ${response.status}: ${body.slice(0, 400)}`);
    }

    const data = (await response.json()) as OpenAiChatResponse;
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`OpenAI request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function reviewSignalsWithOpenAi(input: {
  markets: KalshiMarket[];
  signals: KalshiSignal[];
  maxSignals?: number;
}): Promise<KalshiSignal[]> {
  if (input.signals.length === 0) return [];
  if (!isOpenAiTraderConfigured() || process.env.NODE_ENV === "test") {
    return input.signals;
  }

  const signalsForReview = input.signals.slice(0, input.maxSignals ?? 12);
  const marketById = new Map(input.markets.map((market) => [market.id, market]));

  try {
    const text = await createOpenAiSignalReviews({
      markets: signalsForReview.map((signal) => {
        const market = marketById.get(signal.marketId);
        return market ? summarizeMarket(market) : { id: signal.marketId };
      }),
      signals: signalsForReview.map(summarizeSignal),
    });

    const payload = text ? JSON.parse(text) : { reviews: [] };
    const reviews = Array.isArray(payload?.reviews)
      ? (payload.reviews as SignalReview[])
      : parseReviews(text);

    const reviewByMarket = new Map(
      reviews
        .filter((review) => typeof review?.marketId === "string")
        .map((review) => [review.marketId, review])
    );

    return input.signals
      .map((signal) => {
        const review = reviewByMarket.get(signal.marketId);
        if (!review) {
          console.warn(`[OpenAITrader] No review entry for marketId=${signal.marketId}; dropping signal.`);
          return null;
        }
        if (!review.approved) {
          return null;
        }

        const confidenceAdjustment = clamp(Number(review.confidenceAdjustment ?? 0), -0.25, 0.15);
        const expectedValueAdjustment = clamp(Number(review.expectedValueAdjustment ?? 0), -0.1, 0.1);
        const aiReasoning = typeof review.reasoning === "string" && review.reasoning.trim()
          ? review.reasoning.trim().slice(0, 240)
          : "OpenAI approved after conservative review.";

        return {
          ...signal,
          confidence: clamp(signal.confidence + confidenceAdjustment, 0.01, 0.99),
          expectedValue: Math.max(0, signal.expectedValue + expectedValueAdjustment),
          reasoning: `${signal.reasoning} | OpenAI trader: ${aiReasoning}`,
        };
      })
      .filter((signal): signal is KalshiSignal => Boolean(signal));
  } catch (error) {
    console.error(
      "[OpenAITrader] Signal review failed; dropping all candidates (no autonomous execution without explicit AI approval):",
      error
    );
    return [];
  }
}
