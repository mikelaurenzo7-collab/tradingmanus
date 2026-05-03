/**
 * Shared Claude API toolbelt for the prediction-market trading bots.
 *
 * Centralizes the Anthropic-side capabilities used by both the Kalshi reviewer
 * (`tradingReviewer.ts`) and the Polymarket reviewer (`polymarketSignalReviewer.ts`):
 *
 *   - Prompt caching (cache_control: ephemeral) on the static system mandate
 *     so high-cadence autonomy runs only pay full input price for the dynamic
 *     payload.  See https://docs.anthropic.com/claude/docs/prompt-caching
 *
 *   - Tiered model selection: Haiku for cheap triage (large candidate sets,
 *     low stakes), Sonnet for the duo review on real candidates, Opus for
 *     high-stakes trades that warrant the deepest reasoning.
 *
 *   - Extended thinking on high-stakes trades (large notional, near
 *     resolution, or otherwise tagged) so Claude reasons before answering
 *     instead of producing a snap JSON.
 *
 *   - Anthropic-hosted web_search tool so the reviewer can pull fresh news
 *     context for fast-moving markets (sports lineups, crypto news, election
 *     headlines) without us shipping our own scraping pipeline.
 *
 * Every helper is pure and side-effect free; the reviewers wire in their
 * own Anthropic client and logger.  Behavior is gated by env so that the
 * existing duo review still works exactly as before when toggles are off.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { ENV } from "./env";

export type ModelTier = "triage" | "review" | "deep";

export type StakesContext = {
  /** Notional dollars at risk on the proposed trade. */
  orderNotional?: number;
  /** Hours until the underlying market resolves. */
  hoursToResolution?: number;
  /** Caller-supplied confidence (0-1) in the trade thesis. */
  confidence?: number;
  /** True when the signal has been flagged as exceptionally high stakes. */
  highStakes?: boolean;
};

const HIGH_STAKES_NOTIONAL_USD = 25;
const HIGH_STAKES_HOURS_TO_RESOLUTION = 24;
const HIGH_STAKES_CONFIDENCE = 0.9;

export function isHighStakes(context: StakesContext): boolean {
  if (context.highStakes) return true;
  if ((context.orderNotional ?? 0) >= HIGH_STAKES_NOTIONAL_USD) return true;
  if (
    typeof context.hoursToResolution === "number" &&
    context.hoursToResolution > 0 &&
    context.hoursToResolution <= HIGH_STAKES_HOURS_TO_RESOLUTION
  ) {
    return true;
  }
  if ((context.confidence ?? 0) >= HIGH_STAKES_CONFIDENCE) return true;
  return false;
}

/**
 * Pick the right Claude model for the given tier, honoring per-tier env
 * overrides so operators can dial in cost vs depth without code changes.
 */
export function selectAnthropicModel(tier: ModelTier, override?: string): string {
  if (override && override.trim()) return override.trim();
  switch (tier) {
    case "triage":
      return ENV.anthropicTriageModel || "claude-haiku-4-5";
    case "deep":
      return ENV.anthropicDeepModel || ENV.anthropicModel || "claude-opus-4-5";
    case "review":
    default:
      return ENV.anthropicModel || "claude-sonnet-4-5";
  }
}

/**
 * Anthropic-hosted web search tool definition.  Bots can opt-in via
 * ENABLE_AI_WEB_SEARCH=true once the account has access enabled.
 *
 * Reference: https://docs.anthropic.com/claude/docs/tool-use-web-search
 */
export type WebSearchTool = {
  type: "web_search_20250305";
  name: "web_search";
  max_uses?: number;
  allowed_domains?: string[];
  blocked_domains?: string[];
};

export function buildWebSearchTool(maxUses = 3): WebSearchTool {
  return {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: Math.max(1, Math.min(8, Math.floor(maxUses))),
  };
}

export function isWebSearchEnabled(): boolean {
  return ENV.enableAiWebSearch === true;
}

export function isExtendedThinkingEnabled(): boolean {
  return ENV.enableAiExtendedThinking === true;
}

/**
 * Build a system prompt block list that places the static mandate behind a
 * cache_control breakpoint so subsequent calls within ~5 minutes are billed
 * at the cached rate.  Anthropic returns an array of `{type:"text", text, ...}`
 * blocks, which is exactly what `messages.create` accepts as `system`.
 */
export type SystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

export function buildCachedSystemPrompt(staticMandate: string, dynamicPreamble?: string): SystemBlock[] {
  const blocks: SystemBlock[] = [
    {
      type: "text",
      text: staticMandate.trim(),
      cache_control: { type: "ephemeral" },
    },
  ];
  const trimmedPreamble = dynamicPreamble?.trim();
  if (trimmedPreamble) {
    blocks.push({ type: "text", text: trimmedPreamble });
  }
  return blocks;
}

export type ExtendedThinkingConfig =
  | { type: "enabled"; budget_tokens: number }
  | undefined;

/**
 * Conservative extended-thinking budget: enough to let Claude reason about a
 * single contested trade (a few hundred tokens of plan + draft) without
 * blowing latency budgets the autonomy loop tolerates.
 */
export function buildExtendedThinking(stakes: StakesContext): ExtendedThinkingConfig {
  if (!isExtendedThinkingEnabled()) return undefined;
  if (!isHighStakes(stakes)) return undefined;
  return { type: "enabled", budget_tokens: 2048 };
}

/**
 * Extract concatenated text from an Anthropic response, ignoring tool_use
 * blocks (web_search server-side tool calls) and other non-text content.
 */
export function extractAnthropicText(
  response: { content: Array<{ type: string; text?: string }> }
): string {
  return response.content
    .filter((block) => block.type === "text" && (block.text ?? "").length > 0)
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
}

/**
 * Run an Anthropic messages call with a hard timeout race.  Centralized so
 * both reviewers share identical timeout/abort semantics.
 */
export async function callAnthropicWithTimeout<TInput, TOutput>(
  client: { messages: { create: (input: TInput) => Promise<TOutput> } },
  input: TInput,
  timeoutMs: number,
  label: string,
): Promise<TOutput> {
  return Promise.race([
    client.messages.create(input),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

/**
 * Combine the optional web_search tool with any caller-provided tools.
 * Returns undefined when no tools should be sent (avoids the API-level
 * "tools cannot be empty" error).
 */
export function buildToolList<T extends { name: string }>(
  extraTools: T[] = [],
  options: { allowWebSearch?: boolean; maxWebSearchUses?: number } = {},
): Array<T | WebSearchTool> | undefined {
  const tools: Array<T | WebSearchTool> = [...extraTools];
  if (options.allowWebSearch && isWebSearchEnabled()) {
    tools.push(buildWebSearchTool(options.maxWebSearchUses ?? 3));
  }
  return tools.length > 0 ? tools : undefined;
}

/**
 * Per-run telemetry — operators want to know how the AI toolbelt is actually
 * performing in production: cache hit ratio, web search invocations, triage
 * drop counts, extended-thinking invocations, etc.  Reviewers populate this
 * struct over a single run and the caller can serialize it into an audit log
 * entry without coupling to specific provider response shapes.
 */
export type ReviewerTelemetry = {
  desks: string[];
  // Anthropic prompt-cache stats (sum across all calls in a run).
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  // Tool / feature usage counts.
  webSearchInvocations: number;
  extendedThinkingInvocations: number;
  // Triage stats.
  triageRan: boolean;
  triageInputCount: number;
  triageKeptCount: number;
  // Provider call counts.
  anthropicCalls: number;
  anthropicFailures: number;
};

export function newReviewerTelemetry(): ReviewerTelemetry {
  return {
    desks: [],
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    webSearchInvocations: 0,
    extendedThinkingInvocations: 0,
    triageRan: false,
    triageInputCount: 0,
    triageKeptCount: 0,
    anthropicCalls: 0,
    anthropicFailures: 0,
  };
}

/**
 * Update telemetry from an Anthropic response.  Reads `usage` (where the
 * cache stats live) and counts `web_search_tool_result` blocks.  Fail-safe
 * for stub responses that don't include `usage`.
 */
export function recordAnthropicResponseTelemetry(
  telemetry: ReviewerTelemetry,
  response: { content?: Array<unknown>; usage?: Record<string, unknown> },
  flags: { extendedThinkingUsed?: boolean } = {},
): void {
  telemetry.anthropicCalls += 1;
  const usage = response.usage ?? {};
  telemetry.cacheCreationInputTokens += Number(usage.cache_creation_input_tokens ?? 0) || 0;
  telemetry.cacheReadInputTokens += Number(usage.cache_read_input_tokens ?? 0) || 0;
  telemetry.inputTokens += Number(usage.input_tokens ?? 0) || 0;
  telemetry.outputTokens += Number(usage.output_tokens ?? 0) || 0;
  if (Array.isArray(response.content)) {
    for (const block of response.content) {
      if (typeof block === "object" && block !== null && (block as any).type === "web_search_tool_result") {
        telemetry.webSearchInvocations += 1;
      }
    }
  }
  if (flags.extendedThinkingUsed) {
    telemetry.extendedThinkingInvocations += 1;
  }
}

/**
 * Cache-hit ratio across all Anthropic calls captured in this run.  Returns
 * 0 when no input tokens have been observed yet.
 */
export function getCacheHitRatio(telemetry: ReviewerTelemetry): number {
  const totalCacheable = telemetry.cacheReadInputTokens + telemetry.cacheCreationInputTokens;
  if (totalCacheable === 0) return 0;
  return telemetry.cacheReadInputTokens / totalCacheable;
}

/**
 * Memory injection helper.  Wraps the caller-formatted desk-memory string in
 * a separately-cacheable system block.  We split it from the persona block so
 * that updating the tape only invalidates this single block instead of busting
 * the whole prompt cache.
 */
export function buildMemorySystemBlock(memorySnippet: string | null): SystemBlock | null {
  if (!memorySnippet) return null;
  return {
    type: "text",
    text: memorySnippet.trim(),
    cache_control: { type: "ephemeral" },
  };
}

/**
 * Citation extraction.  Anthropic's web_search tool emits two relevant block
 * types in the message content:
 *   - `web_search_tool_result` blocks: contain { content: [{ url, title, ... }] }
 *   - `text` blocks: may contain a `citations` array referencing earlier results
 * We dedupe by URL and return short, audit-log-friendly citation summaries.
 */
export type CitationSummary = {
  url: string;
  title: string;
};

const MAX_CITATIONS = 8;

export function extractCitations(response: { content: Array<unknown> }): CitationSummary[] {
  const out: CitationSummary[] = [];
  const seen = new Set<string>();

  const pushIfNew = (url: unknown, title: unknown) => {
    if (typeof url !== "string" || url.length === 0) return;
    if (seen.has(url)) return;
    seen.add(url);
    out.push({
      url,
      title: typeof title === "string" && title.length > 0 ? title.slice(0, 120) : url,
    });
  };

  for (const block of response.content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const item of b.content as Array<Record<string, unknown>>) {
        pushIfNew(item.url, item.title);
      }
    }
    if (b.type === "text" && Array.isArray(b.citations)) {
      for (const cite of b.citations as Array<Record<string, unknown>>) {
        pushIfNew(cite.url, cite.title);
      }
    }
    if (out.length >= MAX_CITATIONS) break;
  }

  return out.slice(0, MAX_CITATIONS);
}

export function formatCitationsForReasoning(citations: CitationSummary[]): string {
  if (citations.length === 0) return "";
  const sources = citations
    .map((c) => {
      try {
        return new URL(c.url).hostname.replace(/^www\./, "");
      } catch {
        return c.title;
      }
    })
    .filter((value, index, arr) => value && arr.indexOf(value) === index)
    .slice(0, 4);
  return sources.length > 0 ? ` [cites: ${sources.join(", ")}]` : "";
}

/**
 * Haiku triage: when the candidate batch is large, run a single cheap Haiku
 * call to drop obvious junk before paying Sonnet/Opus prices.  Returns the set
 * of marketIds to KEEP for full review.  On failure, returns null so callers
 * fall through to reviewing everything (capital preservation > cost).
 */
export const TRIAGE_THRESHOLD_DEFAULT = 12;

export function isTriageEnabled(): boolean {
  return ENV.enableAiTriage === true;
}

export function getTriageThreshold(): number {
  return ENV.aiTriageThreshold > 0 ? ENV.aiTriageThreshold : TRIAGE_THRESHOLD_DEFAULT;
}

export type TriageCandidate = {
  marketId: string;
  title: string;
  category: string;
  signalType: string;
  side: "yes" | "no";
  confidence: number;
  expectedValue: number;
  impliedProbability: number;
};

export type AnthropicTriageClient = {
  messages: {
    create: (input: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
};

export async function runHaikuTriage(
  client: AnthropicTriageClient,
  candidates: TriageCandidate[],
  options: { timeoutMs: number; logger?: Pick<Console, "warn"> } = { timeoutMs: 8000 },
): Promise<Set<string> | null> {
  if (candidates.length === 0) return new Set();
  try {
    const triageInput = {
      task: "Drop obviously bad candidates before deeper review.",
      keepIfAny: [
        "Liquidity looks healthy AND confidence>=0.6 AND |EV|>=0.05",
        "Implied probability sits between 0.05 and 0.95",
        "Signal type is not pure heuristic momentum on a stale market",
      ],
      dropIfAny: [
        "Confidence below 0.5 with no clear catalyst",
        "Implied probability outside 0.03..0.97",
        "Expected value at or near zero",
      ],
      candidates,
    };

    const response = await Promise.race([
      client.messages.create({
        model: selectAnthropicModel("triage"),
        max_tokens: 600,
        temperature: 0,
        system: [
          {
            type: "text",
            text: "You are a fast Kalshi/Polymarket pre-filter. Output JSON only: {\"keep\":[marketId,...]} listing only marketIds that survive triage. Be aggressive — when in doubt, drop.",
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: JSON.stringify(triageInput) }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("triage timed out")), options.timeoutMs),
      ),
    ]);

    const text = extractAnthropicText(response);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { keep?: unknown };
    if (!Array.isArray(parsed.keep)) return null;
    const keep = new Set<string>();
    for (const id of parsed.keep) {
      if (typeof id === "string" && id.length > 0) keep.add(id);
    }
    return keep;
  } catch (error) {
    options.logger?.warn(
      `[aiToolbelt] Haiku triage failed: ${error instanceof Error ? error.message : String(error)}; falling back to full review.`,
    );
    return null;
  }
}
