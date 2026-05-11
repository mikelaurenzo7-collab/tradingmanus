import { recordAiCallCost } from "./aiCostBudget";
import type { ReviewerTelemetry } from "./aiToolbelt";
import { ENV } from "./env";
import { reviewWithGrok, shouldUseGrokReviewer } from "./grokReviewer";
import type { KalshiMarket } from "./kalshiMarketData";
import type { KalshiSignal } from "./kalshiSignals";
import { fetchLiveNewsSummary } from "./kalshiSentiment";
import {
  classifyMarketCategory,
  type MarketCategory,
} from "./marketCategoryRouter";
import {
  createOpenRouterClient,
  type OpenRouterChatResult,
  type OpenRouterClient,
} from "./openRouterClient";

const DEFAULT_RESEARCHER_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
const DEFAULT_QUANT_MODEL = "deepseek/deepseek-r1:free";
const DEFAULT_EXECUTIONER_MODEL = "qwen/qwen-2.5-coder-32b-instruct:free";
const MAX_SUMMARY_CHARS = 280;
const MAX_REASONING_CHARS = 240;
const MAX_HEADLINES = 3;

export type ResearcherVerdict = {
  summary: string;
  estimatedYesProbability: number;
  confidence: number;
  catalysts: string[];
  risks: string[];
  ambiguityFlag: boolean;
};

export type QuantVerdict = {
  approved: boolean;
  side: "yes" | "no";
  sideWinProbability: number;
  marketPrice: number;
  edgeFraction: number;
  roiFraction: number;
  confidenceAdjustment: number;
  expectedValueAdjustment: number;
  reasoning: string;
  ambiguityFlag: boolean;
};

export type KalshiOrderPayload = {
  ticker: string;
  action: "buy";
  side: "yes" | "no";
  count: number;
  type: "limit";
  time_in_force: "good_till_cancelled";
  yes_price?: number;
  no_price?: number;
};

export type KalshiTeamReview = {
  approved: boolean;
  confidenceAdjustment: number;
  expectedValueAdjustment: number;
  impliedProbability: number;
  reasoning: string;
  researcher: ResearcherVerdict;
  quant: QuantVerdict;
  executionPrototype: KalshiOrderPayload;
  grokReasoning?: string;
};

type LoggerLike = {
  warn: (...args: unknown[]) => void;
};

type TeamOptions = {
  client?: OpenRouterClient;
  telemetry?: ReviewerTelemetry;
  logger?: LoggerLike;
};

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.max(minimum, Math.min(maximum, value));
}

function compactText(value: string | undefined, maxChars: number) {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function normalizeProbabilityPercent(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const percent = numeric <= 1 ? numeric * 100 : numeric;
  return clamp(percent, 0, 100);
}

function normalizeUnit(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return clamp(numeric, 0, 1);
}

function extractJson<T>(text: string): T | null {
  const trimmed = text.trim();
  const candidate = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0] ?? trimmed;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? compactText(entry, 120) : ""))
    .filter(Boolean)
    .slice(0, 4);
}

function updateTelemetry(
  telemetry: ReviewerTelemetry | undefined,
  result: OpenRouterChatResult,
  reviewerLabel: string,
) {
  if (!telemetry) {
    return;
  }
  telemetry.inputTokens += result.inputTokens;
  telemetry.outputTokens += result.outputTokens;
  telemetry.anthropicCalls += 1;
  if (!telemetry.desks.includes(reviewerLabel)) {
    telemetry.desks.push(reviewerLabel);
  }
  recordAiCallCost(
    result.model,
    {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
    { provider: "openrouter", reviewer: reviewerLabel },
  );
}

function researcherModel() {
  return ENV.openRouterResearcherModel || DEFAULT_RESEARCHER_MODEL;
}

function quantModel(category?: string) {
  // Crypto lane uses Claude Sonnet 4.6 as the Quant (final decision-maker)
  // so it can reason against the Binance-derived technical prior that the
  // Researcher cannot see.  Every other category stays on the free model.
  if (category === "crypto") {
    return ENV.openRouterCryptoReviewerModel;
  }
  return ENV.openRouterQuantModel || DEFAULT_QUANT_MODEL;
}

function executionerModel() {
  return ENV.openRouterExecutionerModel || DEFAULT_EXECUTIONER_MODEL;
}

function summarizeNewsContext(headlines: Awaited<ReturnType<typeof fetchLiveNewsSummary>>) {
  if (!headlines || headlines.headlines.length === 0) {
    return null;
  }

  return {
    query: headlines.query,
    derivedSentiment: headlines.derivedSentiment,
    articleCount: headlines.articleCount,
    fetchedAt: headlines.fetchedAt.toISOString(),
    headlines: headlines.headlines.slice(0, MAX_HEADLINES).map((headline) => ({
      title: compactText(headline.title, 140),
      source: headline.source,
      publishedAt: headline.publishedAt.toISOString(),
    })),
  };
}

async function maybeLoadFreshNews(market: KalshiMarket) {
  const normalizedCategory = market.category.toLowerCase();
  const shouldFetch =
    Boolean(ENV.gnewsApiKey) &&
    /econom|sport|weather|politic|tech|crypto/.test(normalizedCategory);
  if (!shouldFetch) {
    return null;
  }

  return fetchLiveNewsSummary(compactText(market.title, 96));
}

function buildResearcherSystemPrompt(category: MarketCategory) {
  return [
    "You are the Researcher in a Kalshi-only trading team.",
    "Your job is factual synthesis, not trade approval.",
    "Estimate the real-world probability that YES resolves true.",
    "Prefer high-probability, statistically grounded outcomes. Avoid moonshot framing.",
    `Category focus: ${category}.`,
    "Output JSON only with keys: summary, estimatedYesProbability, confidence, catalysts, risks, ambiguityFlag.",
  ].join(" ");
}

function buildResearcherPayload(
  market: KalshiMarket,
  signal: KalshiSignal,
  category: MarketCategory,
  liveNews: Awaited<ReturnType<typeof maybeLoadFreshNews>>,
) {
  return {
    todayUtc: new Date().toISOString(),
    mandate: "Return a short factual summary plus a calibrated YES probability from 0 to 100.",
    category,
    market: {
      id: market.id,
      title: compactText(market.title, 220),
      description: compactText(market.description, 600),
      resolutionDate: market.resolutionDate,
      status: market.status,
      yesPrice: market.yesPrice,
      noPrice: market.noPrice,
      yesVolume: market.yesVolume,
      noVolume: market.noVolume,
      impliedProbability: market.impliedProbability,
    },
    candidateSignal: {
      side: signal.side,
      signalType: signal.signalType,
      confidence: signal.confidence,
      expectedValue: signal.expectedValue,
      reasoning: compactText(signal.reasoning, 400),
    },
    freshNews: summarizeNewsContext(liveNews),
  };
}

function parseResearcherVerdict(text: string): ResearcherVerdict {
  const parsed = extractJson<Record<string, unknown>>(text) ?? {};
  return {
    summary: compactText(
      typeof parsed.summary === "string" ? parsed.summary : "Insufficient research context returned.",
      MAX_SUMMARY_CHARS,
    ),
    estimatedYesProbability: normalizeProbabilityPercent(parsed.estimatedYesProbability, 50),
    confidence: normalizeUnit(parsed.confidence, 0.5),
    catalysts: asStringArray(parsed.catalysts),
    risks: asStringArray(parsed.risks),
    ambiguityFlag: Boolean(parsed.ambiguityFlag),
  };
}

function buildQuantSystemPrompt() {
  return [
    "You are the Quant in a Kalshi-only trading team.",
    "Reject any trade that is not a true winner.",
    `A true winner must clear all three thresholds: sideWinProbability >= ${ENV.trueWinnerMinSideProbability.toFixed(2)}, edgeFraction >= ${ENV.trueWinnerMinEdgeFraction.toFixed(2)}, roiFraction >= ${ENV.trueWinnerMinRoiFraction.toFixed(2)}.`,
    "You may veto for ambiguity, weak edge, bad price, or low-confidence research.",
    "Output JSON only with keys: approved, reasoning, confidenceAdjustment, expectedValueAdjustment, ambiguityFlag.",
  ].join(" ");
}

function buildQuantPayload(
  market: KalshiMarket,
  signal: KalshiSignal,
  researcher: ResearcherVerdict,
) {
  const yesProbability = researcher.estimatedYesProbability / 100;
  const sideWinProbability = signal.side === "yes"
    ? yesProbability
    : 1 - yesProbability;
  const marketPrice = signal.side === "yes" ? market.yesPrice : market.noPrice;
  const edgeFraction = sideWinProbability - marketPrice;
  const roiFraction = marketPrice > 0 ? edgeFraction / marketPrice : 0;

  return {
    thresholds: {
      trueWinnerMinSideProbability: ENV.trueWinnerMinSideProbability,
      trueWinnerMinEdgeFraction: ENV.trueWinnerMinEdgeFraction,
      trueWinnerMinRoiFraction: ENV.trueWinnerMinRoiFraction,
    },
    market: {
      id: market.id,
      title: compactText(market.title, 200),
      yesPrice: market.yesPrice,
      noPrice: market.noPrice,
      impliedProbability: market.impliedProbability,
    },
    candidateSignal: {
      side: signal.side,
      signalType: signal.signalType,
      confidence: signal.confidence,
      expectedValue: signal.expectedValue,
    },
    researcher: {
      summary: researcher.summary,
      estimatedYesProbability: researcher.estimatedYesProbability,
      confidence: researcher.confidence,
      ambiguityFlag: researcher.ambiguityFlag,
    },
    derived: {
      sideWinProbability,
      marketPrice,
      edgeFraction,
      roiFraction,
    },
  };
}

function parseQuantVerdict(
  text: string,
  signal: KalshiSignal,
  market: KalshiMarket,
  researcher: ResearcherVerdict,
): QuantVerdict {
  const parsed = extractJson<Record<string, unknown>>(text) ?? {};
  const yesProbability = researcher.estimatedYesProbability / 100;
  const sideWinProbability = signal.side === "yes"
    ? yesProbability
    : 1 - yesProbability;
  const marketPrice = signal.side === "yes" ? market.yesPrice : market.noPrice;
  const edgeFraction = sideWinProbability - marketPrice;
  const roiFraction = marketPrice > 0 ? edgeFraction / marketPrice : 0;
  const modelApproved = Boolean(parsed.approved);
  const confidenceAdjustment = clamp(
    Number(parsed.confidenceAdjustment ?? sideWinProbability - signal.confidence) * 0.35,
    -0.25,
    0.15,
  );
  const expectedValueAdjustment = clamp(
    Number(parsed.expectedValueAdjustment ?? edgeFraction - signal.expectedValue),
    -0.1,
    0.1,
  );

  const approved =
    modelApproved &&
    !researcher.ambiguityFlag &&
    !Boolean(parsed.ambiguityFlag) &&
    researcher.confidence >= 0.55 &&
    sideWinProbability >= ENV.trueWinnerMinSideProbability &&
    edgeFraction >= ENV.trueWinnerMinEdgeFraction &&
    roiFraction >= ENV.trueWinnerMinRoiFraction;

  return {
    approved,
    side: signal.side,
    sideWinProbability,
    marketPrice,
    edgeFraction,
    roiFraction,
    confidenceAdjustment,
    expectedValueAdjustment,
    reasoning: compactText(
      typeof parsed.reasoning === "string"
        ? parsed.reasoning
        : approved
          ? "Quant approved a high-probability edge after comparing real-world probability to the live contract price."
          : "Quant rejected the setup because it did not clear the true-winner thresholds.",
      MAX_REASONING_CHARS,
    ),
    ambiguityFlag: Boolean(parsed.ambiguityFlag) || researcher.ambiguityFlag,
  };
}

function buildDeterministicPayload(
  ticker: string,
  side: "yes" | "no",
  count: number,
  limitPrice: number,
): KalshiOrderPayload {
  const cents = Math.max(1, Math.min(99, Math.round(limitPrice * 100)));
  return {
    ticker,
    action: "buy",
    side,
    count,
    type: "limit",
    time_in_force: "good_till_cancelled",
    yes_price: side === "yes" ? cents : undefined,
    no_price: side === "no" ? cents : undefined,
  };
}

function parseExecutionerPayload(
  text: string,
  fallback: KalshiOrderPayload,
): KalshiOrderPayload {
  const parsed = extractJson<Record<string, unknown>>(text);
  if (!parsed) {
    return fallback;
  }

  const ticker = typeof parsed.ticker === "string" ? parsed.ticker.trim() : fallback.ticker;
  const side = parsed.side === "no" ? "no" : parsed.side === "yes" ? "yes" : fallback.side;
  if (ticker !== fallback.ticker || side !== fallback.side) {
    return fallback;
  }

  // The executioner is formatting-only. Size and price stay pinned to the
  // already risk-checked fallback payload.
  return fallback;
}

function shouldEscalateToGrok(
  category: MarketCategory,
  market: KalshiMarket,
  quant: QuantVerdict,
  confidence: number,
) {
  if (!ENV.grokReviewerEnabled || !ENV.xaiApiKey) {
    return false;
  }

  const hoursToResolution = Number.isFinite(new Date(market.resolutionDate).getTime())
    ? (new Date(market.resolutionDate).getTime() - Date.now()) / (1000 * 60 * 60)
    : null;

  return (
    quant.approved &&
    shouldUseGrokReviewer({
      category,
      hoursToResolution,
      sideWinProbability: quant.sideWinProbability,
      edgeFraction: quant.edgeFraction,
      roiFraction: quant.roiFraction,
      confidence,
    })
  );
}

export async function reviewSignalWithOpenRouterKalshiTeam(
  market: KalshiMarket,
  signal: KalshiSignal,
  options: TeamOptions = {},
): Promise<KalshiTeamReview> {
  const client = options.client ?? createOpenRouterClient();
  const category = classifyMarketCategory({ category: market.category, title: market.title });
  const liveNews = await maybeLoadFreshNews(market);

  const researcherResponse = await client.chat({
    model: researcherModel(),
    responseFormat: "json_object",
    maxTokens: 800,
    messages: [
      { role: "system", content: buildResearcherSystemPrompt(category) },
      {
        role: "user",
        content: JSON.stringify(buildResearcherPayload(market, signal, category, liveNews)),
      },
    ],
  });
  updateTelemetry(options.telemetry, researcherResponse, `researcher:${category}`);
  const researcher = parseResearcherVerdict(researcherResponse.content);

  const quantResponse = await client.chat({
    model: quantModel(category),
    responseFormat: "json_object",
    maxTokens: 700,
    messages: [
      { role: "system", content: buildQuantSystemPrompt() },
      {
        role: "user",
        content: JSON.stringify(buildQuantPayload(market, signal, researcher)),
      },
    ],
  });
  updateTelemetry(options.telemetry, quantResponse, `quant:${category}`);
  const quant = parseQuantVerdict(quantResponse.content, signal, market, researcher);

  let approved = quant.approved;
  let reasoning = `${researcher.summary} | Quant: ${quant.reasoning}`;
  let confidenceAdjustment = quant.confidenceAdjustment;
  let expectedValueAdjustment = quant.expectedValueAdjustment;
  let grokReasoning: string | undefined;

  if (shouldEscalateToGrok(category, market, quant, signal.confidence)) {
    try {
      const hoursToResolution = Number.isFinite(new Date(market.resolutionDate).getTime())
        ? (new Date(market.resolutionDate).getTime() - Date.now()) / (1000 * 60 * 60)
        : null;
      const grok = await reviewWithGrok({
        marketId: market.id,
        ticker: market.id,
        category,
        side: signal.side,
        count: 1,
        entryPrice: quant.marketPrice,
        roiFraction: quant.roiFraction,
        confidence: signal.confidence,
        resolutionPrimary: market.description,
        resolutionSecondary: null,
        priorVerdict: {
          approved,
          impliedProbability: researcher.estimatedYesProbability / 100,
          confidenceAdjustment,
          expectedValueAdjustment,
          reasoning: reasoning.slice(0, MAX_REASONING_CHARS),
        },
        notionalUsd: quant.marketPrice,
        hoursToResolution,
      });
      grokReasoning = grok.reasoning;
      if (!grok.approved || grok.ambiguityFlag) {
        approved = false;
      } else {
        confidenceAdjustment = clamp(
          (confidenceAdjustment + grok.confidenceAdjustment) / 2,
          -0.25,
          0.15,
        );
        expectedValueAdjustment = clamp(
          (expectedValueAdjustment + grok.expectedValueAdjustment) / 2,
          -0.1,
          0.1,
        );
      }
      reasoning = compactText(`${reasoning} | Grok: ${grok.reasoning}`, MAX_SUMMARY_CHARS + 80);
    } catch (error) {
      options.logger?.warn?.(
        `[OpenRouterKalshiTeam] Grok escalation failed for marketId=${market.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      approved = false;
      reasoning = compactText(`${reasoning} | Grok escalation failed; vetoing to preserve capital.`, MAX_SUMMARY_CHARS + 80);
    }
  }

  const executionPrototype = buildDeterministicPayload(
    market.id,
    signal.side,
    1,
    quant.marketPrice,
  );

  return {
    approved,
    confidenceAdjustment,
    expectedValueAdjustment,
    impliedProbability: researcher.estimatedYesProbability / 100,
    reasoning: compactText(reasoning, MAX_SUMMARY_CHARS + 80),
    researcher,
    quant,
    executionPrototype,
    grokReasoning,
  };
}

export async function buildExecutionPayloadWithExecutioner(input: {
  ticker: string;
  side: "yes" | "no";
  count: number;
  limitPrice: number;
  client?: OpenRouterClient;
  telemetry?: ReviewerTelemetry;
}) {
  const fallback = buildDeterministicPayload(
    input.ticker,
    input.side,
    input.count,
    input.limitPrice,
  );

  try {
    const client = input.client ?? createOpenRouterClient();
    const response = await client.chat({
      model: executionerModel(),
      responseFormat: "json_object",
      maxTokens: 500,
      messages: [
        {
          role: "system",
          content:
            "You are the Executioner in a Kalshi-only trading team. Return the exact Kalshi limit-order JSON payload. Do not change any supplied values. Output JSON only.",
        },
        {
          role: "user",
          content: JSON.stringify({
            payload: fallback,
            rule: "Preserve ticker, side, count, and price fields exactly. Do not add commentary.",
          }),
        },
      ],
    });

    updateTelemetry(input.telemetry, response, "executioner");
    return parseExecutionerPayload(response.content, fallback);
  } catch {
    return fallback;
  }
}