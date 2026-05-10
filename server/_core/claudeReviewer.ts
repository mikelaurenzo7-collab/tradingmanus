import { logAuditEvent } from "../db";
import { recordAiCallCost } from "./aiCostBudget";
import { getCategoryPersona } from "./categoryPersonas";
import { ENV } from "./env";
import { logger } from "./logger";
import type { MarketCategory } from "./marketCategoryRouter";
import { createOpenRouterClient } from "./openRouterClient";

export interface ClaudeReviewInput {
  marketId: string;
  ticker: string;
  category: MarketCategory;
  side: "yes" | "no";
  count: number;
  entryPrice: number;
  grossEvFraction: number;
  confidence: number;
  resolutionPrimary: string | null;
  resolutionSecondary: string | null;
  priorVerdict: {
    approved: boolean;
    impliedProbability: number;
    confidenceAdjustment: number;
    expectedValueAdjustment: number;
    reasoning: string;
  };
  notionalUsd: number;
}

export interface ClaudeReviewVerdict {
  reviewerId:
    | "claude.sonnet-4-6"
    | "claude.opus-4-7"
    | "openrouter.quant"
    | "openrouter.executioner";
  approved: boolean;
  confidenceAdjustment: number;
  expectedValueAdjustment: number;
  impliedProbability: number;
  reasoning: string;
  ambiguityFlag: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  thinkingSummary?: string;
  durationMs: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

function extractJson(text: string) {
  const candidate = text.trim().match(/\{[\s\S]*\}/)?.[0] ?? text.trim();
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildSystemPrompt(category: MarketCategory) {
  const persona = getCategoryPersona("kalshi", category);
  return [
    persona.systemMandate,
    "You are the deep reviewer in a Kalshi-only trading team.",
    "Prioritize true winners with a clear statistical edge.",
    "Veto ambiguous markets, weak pricing edges, and moonshot-style gambles.",
    "Output JSON only with keys: approved, confidenceAdjustment, expectedValueAdjustment, impliedProbability, reasoning, ambiguityFlag.",
  ].join("\n\n");
}

function buildUserPrompt(input: ClaudeReviewInput) {
  const rulesBlock = [input.resolutionPrimary, input.resolutionSecondary]
    .filter(Boolean)
    .join("\n\n") || "(no resolution rules supplied)";

  return JSON.stringify({
    mandate:
      "Re-evaluate this Kalshi trade with a strict true-winner bar. Preserve capital. Reject anything ambiguous or low edge.",
    market: {
      marketId: input.marketId,
      ticker: input.ticker,
      category: input.category,
      side: input.side,
      count: input.count,
      entryPrice: input.entryPrice,
      notionalUsd: input.notionalUsd,
      grossEvFraction: input.grossEvFraction,
      confidence: input.confidence,
    },
    resolutionRules: rulesBlock,
    priorVerdict: input.priorVerdict,
  });
}

async function runDeepReview(
  input: ClaudeReviewInput,
  options: {
    reviewerId: ClaudeReviewVerdict["reviewerId"];
    model: string;
    timeoutMs: number;
  },
): Promise<ClaudeReviewVerdict> {
  const startedAt = Date.now();
  const client = createOpenRouterClient({ apiKey: ENV.openRouterApiKey, logger });

  try {
    const response = await client.chat({
      model: options.model,
      responseFormat: "json_object",
      maxTokens: 700,
      timeoutMs: options.timeoutMs,
      messages: [
        { role: "system", content: buildSystemPrompt(input.category) },
        { role: "user", content: buildUserPrompt(input) },
      ],
    });

    const parsed = extractJson(response.content) ?? {};
    const approved = Boolean(parsed.approved) && !Boolean(parsed.ambiguityFlag);
    const verdict: ClaudeReviewVerdict = {
      reviewerId: options.reviewerId,
      approved,
      confidenceAdjustment: clamp(Number(parsed.confidenceAdjustment ?? 0), -0.25, 0.15),
      expectedValueAdjustment: clamp(Number(parsed.expectedValueAdjustment ?? 0), -0.1, 0.1),
      impliedProbability: clamp(Number(parsed.impliedProbability ?? input.priorVerdict.impliedProbability), 0.01, 0.99),
      reasoning:
        typeof parsed.reasoning === "string" && parsed.reasoning.trim().length > 0
          ? parsed.reasoning.trim().slice(0, 240)
          : approved
            ? "Deep review approved the trade as a true winner."
            : "Deep review vetoed the trade as ambiguous or weak-edge.",
      ambiguityFlag: Boolean(parsed.ambiguityFlag),
      costUsd: 0,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      durationMs: Date.now() - startedAt,
    };

    verdict.costUsd = recordAiCallCost(
      response.model,
      {
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
      },
      { provider: "openrouter", reviewer: options.reviewerId },
    );

    await logAuditEvent(
      "openrouter_deep_review_completed",
      JSON.stringify({
        marketId: input.marketId,
        reviewerId: options.reviewerId,
        approved: verdict.approved,
        ambiguityFlag: verdict.ambiguityFlag,
        impliedProbability: verdict.impliedProbability,
        costUsd: verdict.costUsd,
        durationMs: verdict.durationMs,
      }),
      "system",
    ).catch(() => {});

    return verdict;
  } catch (error) {
    logger.warn(
      { err: error, marketId: input.marketId, reviewerId: options.reviewerId },
      "[OpenRouterDeepReviewer] request failed; failing closed",
    );
    await logAuditEvent(
      "openrouter_deep_review_failed",
      JSON.stringify({
        marketId: input.marketId,
        reviewerId: options.reviewerId,
        error: error instanceof Error ? error.message : String(error),
      }),
      "system",
    ).catch(() => {});

    return {
      reviewerId: options.reviewerId,
      approved: false,
      confidenceAdjustment: 0,
      expectedValueAdjustment: 0,
      impliedProbability: clamp(input.priorVerdict.impliedProbability, 0.01, 0.99),
      reasoning: `Deep review failed (fail-closed): ${error instanceof Error ? error.message : String(error)}`.slice(0, 240),
      ambiguityFlag: true,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      durationMs: Date.now() - startedAt,
    };
  }
}

export async function reviewWithSonnet(
  input: ClaudeReviewInput,
): Promise<ClaudeReviewVerdict> {
  return runDeepReview(input, {
    reviewerId: "claude.sonnet-4-6",
    model: ENV.claudeSonnetModel,
    timeoutMs: ENV.claudeSonnetTimeoutMs,
  });
}

export async function reviewWithOpus(
  input: ClaudeReviewInput,
): Promise<ClaudeReviewVerdict> {
  return runDeepReview(input, {
    reviewerId: "claude.opus-4-7",
    model: ENV.claudeOpusModel,
    timeoutMs: ENV.claudeOpusTimeoutMs,
  });
}