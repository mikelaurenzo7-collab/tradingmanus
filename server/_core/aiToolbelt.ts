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
 *   - Tiered model selection: Haiku 4.5 for cheap triage + bulk review on
 *     normal-stakes candidates, Opus 4.7 for high-stakes trades (large
 *     notional, near resolution, contested mid-stakes) that warrant the
 *     deepest reasoning.  Override per-tier via CLAUDE_TRIAGE_MODEL /
 *     CLAUDE_MODEL / CLAUDE_DEEP_MODEL.
 *
 *   - Extended thinking on high-stakes trades so Claude reasons before
 *     answering instead of producing a snap JSON.  Toggleable via
 *     ENABLE_AI_EXTENDED_THINKING (default ON).
 *
 *   - Anthropic-hosted web_search tool so the reviewer can pull fresh news
 *     context for fast-moving markets (sports lineups, crypto news, election
 *     headlines) without us shipping our own scraping pipeline.  Toggleable
 *     via ENABLE_AI_WEB_SEARCH (default ON).
 *
 * Every helper is pure and side-effect free; the reviewers wire in their
 * own Anthropic client and logger.  Behavior is gated by env so that the
 * existing duo review still works exactly as before when toggles are off.
 */

import { ENV } from "./env";
import { recordAiCallCost } from "./aiCostBudget";

export type ModelTier = "triage" | "review" | "deep";

export type StakesContext = {
  /** Notional dollars at risk on the proposed trade. */
  orderNotional?: number;
  /** Hours until the underlying market resolves. */
  hoursToResolution?: number;
  /** Caller-supplied confidence (0-1) in the trade thesis. */
  confidence?: number;
  /**
   * Implied market probability (0-1) for the side being traded.  Extreme-tail
   * markets are precisely the "free-money or toxic" trades where Opus
   * reasoning pays for itself, so we promote them to the deep tier.
   */
  impliedProbability?: number;
  /** True when the signal has been flagged as exceptionally high stakes. */
  highStakes?: boolean;
};

// Lowered notional threshold: with small live capital, $10+ trades are
// already material and deserve Opus-tier review.
const HIGH_STAKES_NOTIONAL_USD = 10;
// Raised resolution-window threshold: near-resolution is where mispricing
// collapses fastest, so we want Opus reasoning for the full last ~2 days.
const HIGH_STAKES_HOURS_TO_RESOLUTION = 48;
// Lowered confidence threshold: high-conviction signals deserve the deeper
// pass *before* committing capital.
const HIGH_STAKES_CONFIDENCE = 0.8;
// Tail-probability triggers: implied probability outside [0.1, 0.9] is
// either obvious mispricing or toxic — Opus reasoning is the right venue.
const HIGH_STAKES_TAIL_LOW = 0.1;
const HIGH_STAKES_TAIL_HIGH = 0.9;

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
  if (
    typeof context.impliedProbability === "number" &&
    Number.isFinite(context.impliedProbability) &&
    (context.impliedProbability <= HIGH_STAKES_TAIL_LOW ||
      context.impliedProbability >= HIGH_STAKES_TAIL_HIGH)
  ) {
    return true;
  }
  return false;
}

/**
 * Pick the right model for the given tier.  Returns the configured
 * tier-specific model env var, or the override if provided.
 *   - triage → ENV.anthropicTriageModel (Haiku — cheap pre-filter)
 *   - review → ENV.anthropicModel       (Haiku by default — bulk reviewer)
 *   - deep   → ENV.anthropicDeepModel   (Opus by default — high stakes)
 */
export function selectAnthropicModel(tier: ModelTier, override?: string): string {
  if (override && override.trim()) return override.trim();
  if (tier === "triage") return ENV.anthropicTriageModel;
  if (tier === "deep") return ENV.anthropicDeepModel;
  return ENV.anthropicModel;
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
  // Anthropic-hosted web_search tool.  Toggleable via ENABLE_AI_WEB_SEARCH.
  return ENV.enableAiWebSearch;
}

export function isExtendedThinkingEnabled(): boolean {
  // Anthropic extended-thinking budget.  Toggleable via ENABLE_AI_EXTENDED_THINKING.
  return ENV.enableAiExtendedThinking;
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
  | { type: "adaptive"; effort: "low" | "medium" | "high" }
  | { type: "enabled"; budget_tokens: number }
  | undefined;

/**
 * Adaptive extended thinking on the deep tier.  Opus 4.7 (and later) rejects
 * the legacy manual mode (`{type:"enabled", budget_tokens}`) with a 400 and
 * requires `{type:"adaptive", effort}` — see Anthropic docs at
 * https://docs.claude.com/en/docs/build-with-claude/adaptive-thinking
 *
 * Adaptive lets the model decide how much thinking to spend per call up to
 * `max_tokens`.  We pin `effort: "high"` because this only fires on
 * high-stakes trades (large notional, near-resolution, contested mid-stakes)
 * where capital preservation outweighs thinking-token cost.  Sonnet/Haiku do
 * not benefit proportionally on this task, so adaptive only fires on the
 * deep tier (which currently maps to Opus by default).
 */
export function buildExtendedThinking(stakes: StakesContext): ExtendedThinkingConfig {
  if (!isExtendedThinkingEnabled()) return undefined;
  if (!isHighStakes(stakes)) return undefined;
  return { type: "adaptive", effort: "high" };
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
  // Grok provider call counts (used when ENABLE_GROK_SOLO or ENABLE_GROK_TEAM).
  grokCalls: number;
  grokFailures: number;
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
    grokCalls: 0,
    grokFailures: 0,
  };
}

/**
 * Update telemetry from an Anthropic response.  Reads `usage` (where the
 * cache stats live), counts `web_search_tool_result` blocks, and bills the
 * call against the daily AI cost budget so the throttler can act on
 * actual spend.  Fail-safe for stub responses that don't include `usage`.
 */
export function recordAnthropicResponseTelemetry(
  telemetry: ReviewerTelemetry,
  response: { content?: Array<unknown>; usage?: Record<string, unknown>; model?: unknown },
  flags: { extendedThinkingUsed?: boolean; reviewer?: string; userId?: number } = {},
): void {
  telemetry.anthropicCalls += 1;
  const usage = response.usage ?? {};
  const inputTokens = Number(usage.input_tokens ?? 0) || 0;
  const outputTokens = Number(usage.output_tokens ?? 0) || 0;
  const cacheCreationInputTokens = Number(usage.cache_creation_input_tokens ?? 0) || 0;
  const cacheReadInputTokens = Number(usage.cache_read_input_tokens ?? 0) || 0;
  telemetry.cacheCreationInputTokens += cacheCreationInputTokens;
  telemetry.cacheReadInputTokens += cacheReadInputTokens;
  telemetry.inputTokens += inputTokens;
  telemetry.outputTokens += outputTokens;
  // Bill against daily budget — no-op when AI_DAILY_BUDGET_USD is unset.
  const model = typeof response.model === "string" ? response.model : ENV.anthropicModel;
  recordAiCallCost(
    model,
    {
      inputTokens,
      outputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
    },
    {
      provider: "anthropic",
      reviewer: flags.reviewer,
      userId: flags.userId,
    },
  );
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
 * Pay-for-yourself scoreboard injection helper.  The scoreboard text is
 * dynamic (changes every tick as P&L / AI cost / fees update), so this
 * block is intentionally NOT cached — caching would defeat the purpose
 * of giving the reviewer a live view of today's running net.
 */
export function buildScoreboardSystemBlock(scoreboardText: string | null): SystemBlock | null {
  if (!scoreboardText || scoreboardText.trim().length === 0) return null;
  return {
    type: "text",
    text: scoreboardText.trim(),
    // No cache_control — this changes every tick.
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
/**
 * Lowered triage threshold (was 12).  Firing Haiku on 6+ candidate batches
 * is essentially free and improves Sonnet's hit rate by dropping obvious
 * junk before paying review-tier prices.  Callers should still force-keep
 * any candidate that is `isHighStakes` so that capital preservation beats
 * triage savings on the trades that matter most.
 */
export const TRIAGE_THRESHOLD_DEFAULT = 6;

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
