/**
 * Claude reviewer — Tier 2 / Tier 3 deep-review entry point.
 *
 * Tier 2: Claude Sonnet 4.6 — adaptive thinking + prompt caching on the
 *         persona mandate. Used for high-stakes signals (large notional,
 *         near-resolution, contested mid-stakes).
 *
 * Tier 3: Claude Opus 4.7 — adaptive thinking with `display: "summarized"`
 *         so the reasoning is captured in audit logs. Used for catastrophic
 *         bets (≥ CATASTROPHIC_PCT_OF_CAPITAL of bankroll) and for
 *         intra-Claude tiebreaks.
 *
 * Both tiers use:
 *   - `cache_control: {type: "ephemeral"}` on the persona system block
 *     (≥1k tokens of mandate prose stay cached for 5min)
 *   - `output_config.format: json_schema` to constrain the verdict
 *   - `thinking: {type: "adaptive"}` — Claude decides how deep to go
 *
 * Phase 1: dual-bot consensus removed. Tier 1 is also Claude (Haiku) now —
 * see tradingReviewer.ts. The `priorVerdict` field below carries the
 * Tier 1 result for the deep tier to challenge.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "./env";
import { logger } from "./logger";
import { getCategoryPersona } from "./categoryPersonas";
import { logAuditEvent } from "../db";
import type { MarketCategory } from "./marketCategoryRouter";

// Lazy-init the client so module import never throws when ANTHROPIC_API_KEY
// is unset (tests, headless CLI, etc).
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  const key = ENV.anthropicApiKey;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for Tier 2/3 ensemble review",
    );
  }
  _client = new Anthropic({ apiKey: key });
  return _client;
}

// JSON schema the reviewer must return. Shape is shared with the Tier-1
// reviewer so downstream guardrail code can treat verdicts uniformly.
const REVIEW_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    approved: {
      type: "boolean",
      description: "true to allow the trade, false to veto",
    },
    confidenceAdjustment: {
      type: "number",
      description: "Adjustment to original confidence in [-0.25, 0.15]",
    },
    expectedValueAdjustment: {
      type: "number",
      description:
        "Adjustment to gross EV (post-fee, post-AI-cost) in [-0.10, 0.10]",
    },
    impliedProbability: {
      type: "number",
      description: "Reviewer's point estimate of P(YES) in [0, 1]",
    },
    reasoning: {
      type: "string",
      description: "≤240 chars. Why approved or vetoed.",
    },
    ambiguityFlag: {
      type: "boolean",
      description:
        "true if the resolution rules are ambiguous (auto-veto regardless of approved)",
    },
  },
  required: [
    "approved",
    "confidenceAdjustment",
    "expectedValueAdjustment",
    "impliedProbability",
    "reasoning",
    "ambiguityFlag",
  ],
  additionalProperties: false,
} as const;

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
  /** Tier-1 verdict, surfaced so the deep reviewer can challenge it explicitly. */
  priorVerdict: {
    approved: boolean;
    impliedProbability: number;
    confidenceAdjustment: number;
    expectedValueAdjustment: number;
    reasoning: string;
  };
  /** Notional in USD; used to set effort tier on Opus. */
  notionalUsd: number;
}

export interface ClaudeReviewVerdict {
  reviewerId: "claude.sonnet-4-6" | "claude.opus-4-7";
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

// Per-million-token prices (USD). Pulled from claude-api skill cache 2026-04-29.
// Update when Anthropic publishes a new schedule; small enough that the
// amortized error is negligible vs Tier-1 Haiku's per-review baseline.
const PRICING = {
  "claude-sonnet-4-6": { in: 3.0, out: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-opus-4-7": { in: 5.0, out: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
} as const;

function buildPersonaSystemBlock(category: MarketCategory): {
  type: "text";
  text: string;
  cache_control: { type: "ephemeral" };
} {
  // Single Claude-native persona (Profit Reviewer) — niche priority +
  // verbatim-rules + skip-on-ambiguity discipline shared with the Tier-1
  // reviewer in tradingReviewer.ts.
  const persona = getCategoryPersona("kalshi", category);
  return {
    type: "text",
    text: persona.systemMandate,
    cache_control: { type: "ephemeral" },
  };
}

function buildUserPrompt(input: ClaudeReviewInput): string {
  const rulesPrimary = (input.resolutionPrimary ?? "").trim();
  const rulesSecondary = (input.resolutionSecondary ?? "").trim();
  const rulesBlock =
    [rulesPrimary, rulesSecondary].filter(Boolean).join("\n\n") ||
    "(no resolution rules supplied — TREAT AS AMBIGUOUS AND VETO)";

  return [
    `Market: ${input.ticker}`,
    `Category: ${input.category}`,
    `Side: ${input.side.toUpperCase()}`,
    `Entry price: ${input.entryPrice.toFixed(3)} (≈${(input.entryPrice * 100).toFixed(1)}¢)`,
    `Contracts: ${input.count}`,
    `Notional: $${input.notionalUsd.toFixed(2)}`,
    `Confidence (pre-review): ${(input.confidence * 100).toFixed(1)}%`,
    `Gross EV (model edge): ${(input.grossEvFraction * 100).toFixed(2)}%`,
    "",
    "── Resolution rules (verbatim) ─────────────────────────────────",
    rulesBlock,
    "── Tier-1 verdict to challenge ─────────────────────────────────",
    `Approved: ${input.priorVerdict.approved}`,
    `Implied P(YES): ${(input.priorVerdict.impliedProbability * 100).toFixed(1)}%`,
    `EV adjust: ${(input.priorVerdict.expectedValueAdjustment * 100).toFixed(2)}%`,
    `Conf adjust: ${(input.priorVerdict.confidenceAdjustment * 100).toFixed(1)}%`,
    `Tier-1 reasoning: ${input.priorVerdict.reasoning}`,
    "",
    "Your job: independently review this trade. Apply the same niche-priority + skip-on-ambiguity rules.",
    "If you disagree with the Tier-1 verdict, say so explicitly in `reasoning`.",
    "If the resolution rules are ambiguous, set `ambiguityFlag: true` and `approved: false`.",
    "If your implied P(YES) differs from Tier-1's by > 0.08, that is meaningful — flag it.",
  ].join("\n");
}

/**
 * Call Claude Sonnet — fast cross-family second opinion. Model id comes from
 * ENV.claudeSonnetModel (default `claude-sonnet-4-6`); override per-tier via
 * the CLAUDE_SONNET_MODEL env var.
 */
export async function reviewWithSonnet(
  input: ClaudeReviewInput,
): Promise<ClaudeReviewVerdict> {
  return runClaudeReview(input, {
    model: ENV.claudeSonnetModel,
    pricingKey: "claude-sonnet-4-6",
    effort: "medium",
    reviewerId: "claude.sonnet-4-6",
    enableThinkingDisplay: false,
    timeoutMs: ENV.claudeSonnetTimeoutMs,
  });
}

/**
 * Call Claude Opus — intra-Claude tiebreaker when Sonnet contests Tier-1, OR
 * when the position is a catastrophic-bet (≥ CATASTROPHIC_PCT_OF_CAPITAL).
 * Adaptive thinking with summarized display so the reasoning is captured
 * in audit logs. Model id comes from ENV.claudeOpusModel (default
 * `claude-opus-4-7`); override via CLAUDE_OPUS_MODEL.
 */
export async function reviewWithOpus(
  input: ClaudeReviewInput,
): Promise<ClaudeReviewVerdict> {
  return runClaudeReview(input, {
    model: ENV.claudeOpusModel,
    pricingKey: "claude-opus-4-7",
    effort: "high",
    reviewerId: "claude.opus-4-7",
    enableThinkingDisplay: true,
    timeoutMs: ENV.claudeOpusTimeoutMs,
  });
}

async function runClaudeReview(
  input: ClaudeReviewInput,
  opts: {
    /** Actual model id sent to the API — taken from env. */
    model: string;
    /** Pricing-table key, used to compute cost. We pin this to the model
     *  family the operator selected (sonnet vs opus); pricing is rough at
     *  the family level so a snapshot version inside the same family is
     *  fine to bill against the same row. */
    pricingKey: keyof typeof PRICING;
    effort: "low" | "medium" | "high" | "xhigh" | "max";
    reviewerId: ClaudeReviewVerdict["reviewerId"];
    enableThinkingDisplay: boolean;
    timeoutMs: number;
  },
): Promise<ClaudeReviewVerdict> {
  const startedAt = Date.now();
  const client = getClient();

  // System block: persona mandate + verbatim rules. Cache the persona
  // (stable across markets in the same category); rules go in the user
  // turn (vary per market — would invalidate the prefix).
  const personaBlock = buildPersonaSystemBlock(input.category);

  // Resolution rules are injected into the user prompt (vary per market) —
  // keeping the persona stable in the system slot lets prompt caching
  // hit across all markets in the same category.

  const userPrompt = buildUserPrompt(input);

  // Adaptive thinking. On the Opus tier we set display:summarized so we can
  // surface the reasoning in audit logs. On Sonnet, leave it default
  // (omitted) — the reasoning we want is in `reasoning` of the JSON output.
  const thinking =
    opts.pricingKey === "claude-opus-4-7"
      ? ({
          type: "adaptive",
          display: opts.enableThinkingDisplay ? "summarized" : "omitted",
        } as const)
      : ({ type: "adaptive" } as const);

  const requestBody = {
    model: opts.model,
    max_tokens: 4096,
    thinking,
    output_config: {
      effort: opts.effort,
      format: {
        type: "json_schema" as const,
        schema: REVIEW_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    system: [personaBlock],
    messages: [{ role: "user" as const, content: userPrompt }],
  };

  // The non-streaming overload returns `Anthropic.Message`; the union with
  // `Stream<...>` only fires when `stream: true` is set. We never set it, so
  // narrow with a type assertion to avoid the "could be a Stream" path.
  // Use the SDK's native `timeout` request option (not Promise.race) so the
  // in-flight HTTP request is actually cancelled on timeout — Promise.race
  // only rejects the local await; the SDK keeps streaming + billing.
  let response: Anthropic.Message;
  try {
    response = (await client.messages.create(
      requestBody as unknown as Anthropic.MessageCreateParamsNonStreaming,
      { timeout: opts.timeoutMs },
    )) as Anthropic.Message;
  } catch (err) {
    logger.warn(
      { err, model: opts.model, ticker: input.ticker },
      "[ClaudeReviewer] request failed; failing closed (veto)",
    );
    // Audit-log per repo convention: every AI reviewer failure goes to the
    // audit stream so calibration / alerting can spot model outages.
    void logAuditEvent(
      "ai_reviewer_failure",
      JSON.stringify({
        reviewerId: opts.reviewerId,
        model: opts.model,
        ticker: input.ticker,
        marketId: input.marketId,
        category: input.category,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
        phase: "transport_error",
      }),
      `kalshi_market:${input.marketId}`,
    ).catch(() => {});
    return {
      reviewerId: opts.reviewerId,
      approved: false,
      confidenceAdjustment: -0.1,
      expectedValueAdjustment: -0.05,
      impliedProbability: input.entryPrice,
      reasoning: `Claude ${opts.model} unreachable — fail-closed veto`,
      ambiguityFlag: false,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  // Extract the JSON output. Output_config.format guarantees structure.
  let parsed: {
    approved: boolean;
    confidenceAdjustment: number;
    expectedValueAdjustment: number;
    impliedProbability: number;
    reasoning: string;
    ambiguityFlag: boolean;
  } | null = null;

  let thinkingSummary: string | undefined;
  for (const block of response.content) {
    if (block.type === "text") {
      try {
        parsed = JSON.parse(block.text);
      } catch (err) {
        logger.warn(
          { err, body: block.text.slice(0, 240) },
          "[ClaudeReviewer] JSON parse failed",
        );
      }
    } else if (block.type === "thinking") {
      // SDK narrows `block` to ThinkingBlock here; `.thinking` is a
      // required string on that type.
      thinkingSummary = block.thinking;
    }
  }

  if (!parsed) {
    const usage = response.usage;
    // Audit-log the malformed-verdict path. Spend already happened, so
    // costUsd reflects real usage — under-reporting it would let cost
    // telemetry drift exactly on the failure path that needs the most
    // monitoring.
    void logAuditEvent(
      "ai_reviewer_failure",
      JSON.stringify({
        reviewerId: opts.reviewerId,
        model: opts.model,
        ticker: input.ticker,
        marketId: input.marketId,
        category: input.category,
        phase: "malformed_verdict",
        usage: {
          input_tokens: usage?.input_tokens ?? 0,
          output_tokens: usage?.output_tokens ?? 0,
          cache_read_input_tokens: usage?.cache_read_input_tokens ?? 0,
          cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? 0,
        },
        durationMs: Date.now() - startedAt,
      }),
      `kalshi_market:${input.marketId}`,
    ).catch(() => {});
    return {
      reviewerId: opts.reviewerId,
      approved: false,
      confidenceAdjustment: -0.1,
      expectedValueAdjustment: -0.05,
      impliedProbability: input.entryPrice,
      reasoning: `Claude ${opts.model} returned malformed verdict — fail-closed veto`,
      ambiguityFlag: false,
      costUsd: computeCost(opts.pricingKey, {
        input: usage?.input_tokens ?? 0,
        output: usage?.output_tokens ?? 0,
        cacheRead: usage?.cache_read_input_tokens ?? 0,
        cacheWrite: usage?.cache_creation_input_tokens ?? 0,
      }),
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const usage = response.usage;
  const costUsd = computeCost(opts.pricingKey, {
    input: usage?.input_tokens ?? 0,
    output: usage?.output_tokens ?? 0,
    cacheRead: usage?.cache_read_input_tokens ?? 0,
    cacheWrite: usage?.cache_creation_input_tokens ?? 0,
  });

  return {
    reviewerId: opts.reviewerId,
    approved: parsed.approved && !parsed.ambiguityFlag,
    confidenceAdjustment: clamp(parsed.confidenceAdjustment, -0.25, 0.15),
    expectedValueAdjustment: clamp(parsed.expectedValueAdjustment, -0.1, 0.1),
    impliedProbability: clamp(parsed.impliedProbability, 0, 1),
    reasoning: parsed.reasoning.slice(0, 240),
    ambiguityFlag: parsed.ambiguityFlag,
    costUsd,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? 0,
    thinkingSummary,
    durationMs: Date.now() - startedAt,
  };
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function computeCost(
  model: keyof typeof PRICING,
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  },
): number {
  const p = PRICING[model];
  return (
    (tokens.input * p.in +
      tokens.output * p.out +
      tokens.cacheRead * p.cacheRead +
      tokens.cacheWrite * p.cacheWrite) /
    1_000_000
  );
}
