/**
 * Grok 4 reviewer — real-time information specialist for Kalshi prediction markets.
 *
 * Uses xAI's grok-4-latest via native fetch to api.x.ai/v1/chat/completions with:
 *   - Native X search via search_parameters.mode="on" (no separate API key)
 *   - Native web search via the same mechanism
 *   - NOAA/NHC real API for official hurricane/storm data (free, no auth)
 *   - Kalshi order book from our local DB cache
 *
 * Fires ONLY on breaking-news niches where live info = genuine edge:
 *   - Weather (≤72h to resolution): NOAA ensemble vs market price
 *   - Sports (≤72h): injury/lineup news on X before odds adjust
 *   - Economics (≤72h): Fed-watcher X sentiment pre-release
 *
 * All other categories → Claude Opus (reasoning depth > real-time speed).
 */

import { ENV } from "./env";
import { logger } from "./logger";
import { recordAiCallCost, type CostUsage } from "./aiCostBudget";
import { logAuditEvent } from "../db";
import type { MarketCategory } from "./marketCategoryRouter";
import {
  buildNoaaWeatherTool,
  buildOrderBookTool,
  type GrokToolDefinition,
  type ToolCall,
  type ToolResult,
} from "./grokTools";

// ── xAI API types (OpenAI-compatible) ────────────────────────────────────────

interface XaiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: XaiToolCall[];
  tool_call_id?: string;
}

interface XaiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface XaiCompletionRequest {
  model: string;
  messages: XaiMessage[];
  tools?: GrokToolDefinition[];
  tool_choice?: "auto" | "none";
  /** xAI extension: enables native X + web search during inference */
  search_parameters?: { mode: "on" | "off" };
  response_format?: { type: "json_object" };
  temperature?: number;
  max_tokens?: number;
}

interface XaiCompletionResponse {
  choices: Array<{
    message: XaiMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

async function callXai(
  request: XaiCompletionRequest,
  signal?: AbortSignal,
): Promise<XaiCompletionResponse> {
  const key = ENV.xaiApiKey;
  if (!key) throw new Error("XAI_API_KEY is required for Grok reviewer");

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`xAI API ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json() as Promise<XaiCompletionResponse>;
}

// ── Input / Output types ──────────────────────────────────────────────────────

export interface GrokReviewInput {
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
  /** Tier-1 Haiku verdict for Grok to challenge / refine */
  priorVerdict: {
    approved: boolean;
    impliedProbability: number;
    confidenceAdjustment: number;
    expectedValueAdjustment: number;
    reasoning: string;
  };
  notionalUsd: number;
  /** Hours until market resolves — drives tool selection urgency */
  hoursToResolution: number | null;
}

export interface GrokReviewVerdict {
  reviewerId: "grok-4-latest";
  approved: boolean;
  confidenceAdjustment: number;
  expectedValueAdjustment: number;
  impliedProbability: number;
  reasoning: string;
  ambiguityFlag: boolean;
  toolCallsSummary: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  toolCallsMade: ToolCall[];
}

// ── System prompts per category ───────────────────────────────────────────────

function buildGrokSystemPrompt(category: MarketCategory): string {
  const nicheGuidance: Partial<Record<MarketCategory, string>> = {
    weather: `You are the Real-Time Weather Specialist for a Kalshi prediction market trading desk.

EDGE: NOAA/NHC official data vs retail overreaction to headlines. You have live X search and a direct NOAA tool.

Mandate:
- Call noaa_weather to get the latest NHC advisory for any active storm.
- Use your native X search to find recent tweets from @NHC_Atlantic, @NWSNHC, and professional meteorologists.
- ONLY approve when NOAA ensemble probability materially differs from market price (≥5% gap after fees).
- SKIP if resolution rules are ambiguous (e.g., "major hurricane" without Saffir-Simpson category specified).
- Weight NHC official advisories 3× more than social commentary.
- Cite sources with timestamps: "NHC 5pm advisory: 65% landfall prob vs 52% market."`,

    sports: `You are the Real-Time Sports News Specialist for a Kalshi prediction market trading desk.

EDGE: Injury/lineup news breaks on X 15-60 min before odds adjust.

Mandate:
- Use your native X search to find the last 4 hours of tweets from verified beat writers and team accounts.
- ONLY approve when verified news materially changes win probability (≥3% after fees).
- SKIP if no breaking injury/roster news in the last 4 hours — markets are already priced in.
- For player status: only count "out" / "questionable" / "limited" from official sources, not fan speculation.
- Cite sources with timestamps: "Per @AdamSchefter 2:14pm: QB1 ruled out."`,

    economics: `You are the Real-Time Economics Specialist for a Kalshi prediction market trading desk.

EDGE: Fed-watcher X sentiment + positioning in the 30-90 min window before scheduled data releases.

Mandate:
- Use your native X search to find recent tweets from verified economists (@LHSummers, @JustinWolfers, @ModeledBehavior).
- ONLY trade scheduled releases (CPI, NFP, PPI, FOMC) with a known exact time.
- SKIP if release is >4 hours away or already happened.
- Look for order-book imbalances (call order_book) to check if smart money already positioned.
- Cite: "Per @LHSummers 11:42am: expects CPI upside. Market at 68% in-range, should be 55%."`,
  };

  const guidance =
    nicheGuidance[category] ??
    `You are a market reviewer for a Kalshi prediction market trading desk. This category (${category}) is outside your primary breaking-news specialisation. Apply conservative standards — only approve with a clear, verifiable edge.`;

  return `${guidance}

SELF-CONSISTENCY CHECK: Before writing your verdict, state your P(YES) estimate once, then re-state it. If the number changed, you don't have edge — veto.

After using tools, produce a ≤240-character reasoning string citing all sources used with timestamps.

OUTPUT: Valid JSON object only. No prose outside the JSON.`;
}

function buildGrokUserPrompt(input: GrokReviewInput): string {
  const resText =
    input.resolutionPrimary ?? input.resolutionSecondary ?? "(no resolution text)";
  const hrsText =
    input.hoursToResolution !== null
      ? `${input.hoursToResolution.toFixed(1)}h`
      : "unknown";

  return `Market: ${input.ticker} (${input.marketId})
Category: ${input.category}
Resolves in: ${hrsText}
Resolution rule: "${resText}"

Proposed trade: ${input.side.toUpperCase()} × ${input.count} @ $${input.entryPrice.toFixed(2)}
Notional: $${input.notionalUsd.toFixed(2)}
Gross EV (after fees): ${(input.grossEvFraction * 100).toFixed(1)}%
Initial confidence: ${(input.confidence * 100).toFixed(0)}%

Tier-1 (Claude Haiku) verdict:
  Approved: ${input.priorVerdict.approved}
  Implied P(YES): ${(input.priorVerdict.impliedProbability * 100).toFixed(0)}%
  Reasoning: "${input.priorVerdict.reasoning}"

Your job: Use your real-time tools to validate or challenge the Tier-1 verdict.
Focus on breaking news, verified sources, and live data Haiku couldn't access.
Do NOT blindly approve. Demand a clear information edge backed by timestamped sources.

Respond with JSON:
{
  "approved": boolean,
  "confidenceAdjustment": number,   // [-0.25, 0.15]
  "expectedValueAdjustment": number, // [-0.10, 0.10]
  "impliedProbability": number,      // [0, 1]
  "reasoning": string,               // ≤240 chars, cite sources
  "ambiguityFlag": boolean,
  "toolCallsSummary": string         // one-liner of what tools found
}`;
}

// ── Main review function ──────────────────────────────────────────────────────

export async function reviewWithGrok(
  input: GrokReviewInput,
): Promise<GrokReviewVerdict> {
  const startMs = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENV.grokTimeoutMs);

  let tokensIn = 0;
  let tokensOut = 0;
  const toolCallsMade: ToolCall[] = [];

  try {
    // Only include real server-side tools (X + web handled natively via search_parameters)
    const tools: GrokToolDefinition[] = [];
    if (input.category === "weather") tools.push(buildNoaaWeatherTool());
    if (["weather", "sports", "economics"].includes(input.category)) {
      tools.push(buildOrderBookTool());
    }

    const messages: XaiMessage[] = [
      { role: "system", content: buildGrokSystemPrompt(input.category) },
      { role: "user", content: buildGrokUserPrompt(input) },
    ];

    const initialReq: XaiCompletionRequest = {
      model: ENV.grokModel,
      messages,
      ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
      search_parameters: { mode: "on" }, // native X + web search
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 2048,
    };

    let response = await callXai(initialReq, controller.signal);
    tokensIn += response.usage?.prompt_tokens ?? 0;
    tokensOut += response.usage?.completion_tokens ?? 0;

    const firstMsg = response.choices[0]?.message;
    if (!firstMsg) throw new Error("xAI returned empty response");

    let finalContent = firstMsg.content ?? "{}";

    // Handle explicit tool calls (NOAA, order book)
    if (firstMsg.tool_calls && firstMsg.tool_calls.length > 0) {
      const toolMessages: XaiMessage[] = [
        {
          role: "assistant",
          content: firstMsg.content,
          tool_calls: firstMsg.tool_calls,
        },
      ];

      for (const tc of firstMsg.tool_calls) {
        toolCallsMade.push({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });

        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          // malformed args — pass empty object, tool will handle it
        }

        const result = await executeGrokTool(tc.function.name, parsedArgs, input);
        toolMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }

      // Synthesis pass with tool results
      const synthRes = await callXai(
        {
          model: ENV.grokModel,
          messages: [...messages, ...toolMessages],
          search_parameters: { mode: "on" },
          response_format: { type: "json_object" },
          temperature: 0.3,
          max_tokens: 1024,
        },
        controller.signal,
      );
      tokensIn += synthRes.usage?.prompt_tokens ?? 0;
      tokensOut += synthRes.usage?.completion_tokens ?? 0;
      finalContent = synthRes.choices[0]?.message?.content ?? "{}";
    }

    // Parse verdict
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(finalContent) as Record<string, unknown>;
    } catch {
      throw new Error(`Grok returned non-JSON: ${finalContent.slice(0, 200)}`);
    }

    const verdict: GrokReviewVerdict = {
      reviewerId: "grok-4-latest",
      approved: Boolean(parsed.approved),
      confidenceAdjustment: Math.max(-0.25, Math.min(0.15, Number(parsed.confidenceAdjustment) || 0)),
      expectedValueAdjustment: Math.max(-0.1, Math.min(0.1, Number(parsed.expectedValueAdjustment) || 0)),
      impliedProbability: Math.max(0, Math.min(1, Number(parsed.impliedProbability) || 0.5)),
      reasoning: String(parsed.reasoning || "No reasoning provided").slice(0, 240),
      ambiguityFlag: Boolean(parsed.ambiguityFlag),
      toolCallsSummary: String(parsed.toolCallsSummary || "No tools used"),
      costUsd: estimateGrokCost(tokensIn, tokensOut),
      tokensIn,
      tokensOut,
      latencyMs: Date.now() - startMs,
      toolCallsMade,
    };

    // Hard veto on ambiguous resolution
    if (verdict.ambiguityFlag) {
      verdict.approved = false;
    }

    recordAiCallCost(ENV.grokModel, { inputTokens: tokensIn, outputTokens: tokensOut } satisfies CostUsage);

    await logAuditEvent("grok_review_completed", JSON.stringify({
      marketId: input.marketId,
      category: input.category,
      approved: verdict.approved,
      reasoning: verdict.reasoning,
      costUsd: verdict.costUsd,
      tokensIn,
      tokensOut,
      latencyMs: verdict.latencyMs,
      toolCallCount: toolCallsMade.length,
      toolCallsSummary: verdict.toolCallsSummary,
    }), "system");

    logger.info(
      {
        marketId: input.marketId,
        category: input.category,
        approved: verdict.approved,
        costUsd: verdict.costUsd,
        toolsCalled: toolCallsMade.length,
      },
      "[GrokReviewer] Review complete",
    );

    return verdict;
  } catch (err) {
    const latencyMs = Date.now() - startMs;
    logger.error(
      { err, marketId: input.marketId, category: input.category, latencyMs },
      "[GrokReviewer] Review failed — failing closed",
    );

    await logAuditEvent("grok_review_failed", JSON.stringify({
      marketId: input.marketId,
      category: input.category,
      error: err instanceof Error ? err.message : String(err),
      latencyMs,
    }), "system").catch(() => undefined); // don't mask the original error

    return {
      reviewerId: "grok-4-latest",
      approved: false,
      confidenceAdjustment: -0.25,
      expectedValueAdjustment: -0.1,
      impliedProbability: 0.5,
      reasoning: `Grok review failed (fail-closed): ${err instanceof Error ? err.message : "unknown error"}`,
      ambiguityFlag: true,
      toolCallsSummary: "Error during review",
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs,
      toolCallsMade: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeGrokTool(
  toolName: string,
  args: Record<string, unknown>,
  input: GrokReviewInput,
): Promise<ToolResult> {
  const tools = await import("./grokTools");

  switch (toolName) {
    case "noaa_weather":
      return tools.executeNoaaWeather(args);
    case "order_book":
      return tools.executeOrderBook(args, input.marketId);
    default:
      return { success: false, error: `Unknown tool: ${toolName}`, data: null };
  }
}

// ── Cost estimation ───────────────────────────────────────────────────────────

function estimateGrokCost(tokensIn: number, tokensOut: number): number {
  // grok-4-latest pricing (xAI): ~$3/M input, ~$15/M output (similar to GPT-4o tier)
  return (tokensIn / 1_000_000) * 3.0 + (tokensOut / 1_000_000) * 15.0;
}

// ── Gate function ─────────────────────────────────────────────────────────────

/**
 * Should Grok review this signal?
 * True only for breaking-news niches where real-time data = genuine edge.
 */
export function shouldUseGrokReviewer(
  category: MarketCategory,
  hoursToResolution: number | null,
): boolean {
  if (!ENV.grokReviewerEnabled) return false;
  if (!["weather", "sports", "economics"].includes(category)) return false;
  if (hoursToResolution === null || hoursToResolution > 72) return false;
  return true;
}
