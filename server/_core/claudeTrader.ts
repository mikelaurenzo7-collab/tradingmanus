import Anthropic from "@anthropic-ai/sdk";
import type { KalshiMarket } from "./kalshiMarketData";
import type { KalshiSignal } from "./kalshiSignals";
import { ENV } from "./env";

type ClaudeSignalReview = {
  marketId: string;
  approved: boolean;
  confidenceAdjustment?: number;
  expectedValueAdjustment?: number;
  reasoning?: string;
};

export function isClaudeTraderConfigured() {
  return ENV.anthropicApiKey.length > 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

function getTextFromResponse(response: Anthropic.Message) {
  return response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n")
    .trim();
}

function parseClaudeReviews(text: string): ClaudeSignalReview[] {
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

export async function reviewSignalsWithClaude(input: {
  markets: KalshiMarket[];
  signals: KalshiSignal[];
  maxSignals?: number;
}): Promise<KalshiSignal[]> {
  if (input.signals.length === 0) return [];
  if (!isClaudeTraderConfigured() || process.env.NODE_ENV === "test") {
    return input.signals;
  }

  const signalsForReview = input.signals.slice(0, input.maxSignals ?? 12);
  const marketById = new Map(input.markets.map((market) => [market.id, market]));
  const anthropic = new Anthropic({ apiKey: ENV.anthropicApiKey });

  try {
    const response = await anthropic.messages.create({
      model: ENV.anthropicModel,
      max_tokens: 1800,
      temperature: 0,
      system:
        "You are Claude acting as a conservative Kalshi trading analyst for one founder's small live account. You do not place trades directly. You only approve, veto, or modestly adjust signal confidence. Capital preservation, liquidity, bounded downside, and avoiding weak heuristic trades are mandatory. Respond with JSON only.",
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            mandate:
              "Review candidate Kalshi signals. Approve only if the trade has a clear reason, adequate liquidity, bounded binary-market downside, and no obvious stale/thin-market issue. Veto vague, purely heuristic, low-EV, or weak-liquidity candidates. Do not invent market facts beyond the payload.",
            outputSchema:
              "Array<{marketId:string, approved:boolean, confidenceAdjustment:number between -0.25 and 0.15, expectedValueAdjustment:number between -0.1 and 0.1, reasoning:string <= 240 chars}>",
            markets: signalsForReview.map((signal) => {
              const market = marketById.get(signal.marketId);
              return market ? summarizeMarket(market) : { id: signal.marketId };
            }),
            signals: signalsForReview.map(summarizeSignal),
          }),
        },
      ],
    }) as Anthropic.Message;

    const reviews = parseClaudeReviews(getTextFromResponse(response));
    const reviewByMarket = new Map(
      reviews
        .filter((review) => typeof review?.marketId === "string")
        .map((review) => [review.marketId, review])
    );

    return input.signals
      .map((signal) => {
        const review = reviewByMarket.get(signal.marketId);
        // Safe-by-default: any signal Claude did not explicitly approve is dropped.
        // This protects autonomous execution from silent passthrough when Claude's
        // response is truncated, malformed, or omits a marketId.
        if (!review) {
          console.warn(
            `[ClaudeTrader] No review entry for marketId=${signal.marketId}; dropping signal.`
          );
          return null;
        }
        if (!review.approved) {
          return null;
        }

        const confidenceAdjustment = clamp(Number(review.confidenceAdjustment ?? 0), -0.25, 0.15);
        const expectedValueAdjustment = clamp(Number(review.expectedValueAdjustment ?? 0), -0.1, 0.1);
        const claudeReasoning = typeof review.reasoning === "string" && review.reasoning.trim()
          ? review.reasoning.trim().slice(0, 240)
          : "Claude approved after conservative review.";

        return {
          ...signal,
          confidence: clamp(signal.confidence + confidenceAdjustment, 0.01, 0.99),
          expectedValue: Math.max(0, signal.expectedValue + expectedValueAdjustment),
          reasoning: `${signal.reasoning} | Claude trader: ${claudeReasoning}`,
        };
      })
      .filter((signal): signal is KalshiSignal => Boolean(signal));
  } catch (error) {
    console.error("[ClaudeTrader] Signal review failed; dropping all candidates (no autonomous execution without Claude approval):", error);
    return [];
  }
}
