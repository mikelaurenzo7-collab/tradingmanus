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
