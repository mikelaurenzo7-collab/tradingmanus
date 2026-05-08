/**
 * Cross-Platform Arbitrage AI Reviewer (Claude-only).
 *
 * The deterministic scanner in `crossPlatformArbitrage.ts` finds Kalshi ↔
 * Polymarket pairs whose YES prices diverge by enough that an arbitrage is
 * theoretically profitable.  But naive matches blow up in real life: the
 * questions look similar but resolve differently, one side has stale data,
 * or the liquidity floor evaporates the moment you size up.
 *
 * This reviewer dispatches those candidates to a domain-expert "arbitrage
 * desk" persona that has to:
 *   - Confirm the two markets actually resolve on the same underlying event.
 *   - Sanity-check that the price gap reflects real edge, not stale data
 *     on one side.
 *   - Veto when liquidity / fees / settlement risk would eat the edge.
 *
 * Topology:
 *   - Claude is the sole reviewer (these are inherently complex multi-leg
 *     trades that benefit from extended thinking and deep reasoning).
 *   - Prompt caching, web_search, and extended thinking are always on for
 *     this desk because every approval is high-stakes by definition.
 */

import { createAnthropicClient } from "./anthropicClient";
import { z } from "zod";
import { ENV } from "./env";
import {
  buildCachedSystemPrompt,
  callAnthropicWithTimeout,
  extractAnthropicText,
  extractCitations,
  formatCitationsForReasoning,
  buildToolList,
  type CitationSummary,
  type SystemBlock,
} from "./aiToolbelt";
import type { CrossPlatformArbitrageOpportunity } from "./crossPlatformArbitrage";

const ARB_REVIEWER_MAX_OPPORTUNITIES = 8;
// Must exceed the inline `thinking.budget_tokens: 3000` extended-thinking
// budget below — Anthropic rejects requests where budget >= max_tokens.
// 6000 leaves ~3000 tokens for the actual JSON review output.
const ARB_REVIEWER_MAX_TOKENS = 6000;
const ARB_REVIEWER_REASONING_CHARS = 320;

const ARBITRAGE_DESK_MANDATE = [
  "You are the cross-platform arbitrage desk reviewer for one founder's small live account.",
  "Each candidate is a Kalshi market paired with a Polymarket market that the deterministic scanner believes resolve on the same underlying event.",
  "",
  "Approve only when ALL are true:",
  "  1. The two markets resolve on the SAME real-world event with the SAME criteria — not merely similar wording.",
  "  2. The price gap is large enough to survive both legs' fees, slippage, and settlement risk.",
  "  3. Liquidity on BOTH sides is sufficient to fill the proposed leg without moving the price.",
  "  4. Neither side is showing a price that is obviously stale (e.g., one venue closed, halted, or pre-event).",
  "  5. There is no settlement-asymmetry risk (one venue resolves earlier, on a different oracle, or with a different tie-breaker).",
  "",
  "Veto when in doubt. Capital preservation > maximizing edge.",
  "Output JSON only, exactly: {\"reviews\":[{\"pairId\":string, \"approved\":boolean, \"sizeFraction\":number between 0.0 and 0.5, \"reasoning\":string <= 320 chars}]}.",
  "  - sizeFraction is the fraction of the suggested per-trade budget to deploy (0.0 = veto, 0.5 = full size; only approve full size for unambiguous cases with deep two-sided liquidity).",
  "  - One review per candidate. Omitting a candidate is treated as a veto.",
].join("\n");

const reviewSchema = z.object({
  pairId: z.string().min(1),
  approved: z.boolean(),
  sizeFraction: z.number().finite().min(0).max(1).optional(),
  reasoning: z.string().trim().max(ARB_REVIEWER_REASONING_CHARS).optional(),
});

const reviewResponseSchema = z.union([
  z.object({ reviews: z.array(reviewSchema) }),
  z.array(reviewSchema),
]);

export type ArbReviewerOptions = {
  skipInTest?: boolean;
  logger?: Pick<Console, "warn" | "error">;
  anthropicApiKey?: string;
  anthropicModel?: string;
  anthropicTimeoutMs?: number;
  anthropicClient?: {
    messages: { create: (input: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }> };
  };
};

export type ReviewedArbitrageOpportunity = CrossPlatformArbitrageOpportunity & {
  /** Pair identity used by the AI reviewer (kalshi:polymarket). */
  pairId: string;
  /** Suggested fraction of the per-trade budget to deploy [0..1]. */
  sizeFraction: number;
  /** Human-readable AI reviewer reasoning, with optional [cites: ...] tag. */
  reviewerReasoning: string;
  citations: CitationSummary[];
};

function pairIdFor(opp: CrossPlatformArbitrageOpportunity): string {
  return `${opp.kalshiMarketId}::${opp.polymarketMarketId}`;
}

export function isArbReviewerConfigured(options: ArbReviewerOptions = {}) {
  return ((options.anthropicApiKey ?? ENV.anthropicApiKey).trim().length > 0);
}

function summarizeOpportunityForPayload(opp: CrossPlatformArbitrageOpportunity) {
  return {
    pairId: pairIdFor(opp),
    type: opp.type,
    kalshi: {
      marketId: opp.kalshiMarketId,
      title: opp.kalshiTitle.slice(0, 200),
      yesPrice: opp.kalshiYesPrice,
    },
    polymarket: {
      marketId: opp.polymarketMarketId,
      question: opp.polymarketQuestion.slice(0, 200),
      yesPrice: opp.polymarketYesPrice,
    },
    spread: opp.spread,
    netEdge: opp.netEdge,
    minLiquidity: opp.minLiquidity,
    buyPlatform: opp.buyPlatform,
    sellPlatform: opp.sellPlatform,
    scannerConfidence: opp.confidence,
    scannerReasoning: opp.reasoning?.slice(0, 320) ?? "",
  };
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

type ParsedReview = {
  pairId: string;
  approved: boolean;
  sizeFraction?: number;
  reasoning?: string;
};

function parseReviews(text: string): ParsedReview[] {
  const parsed = extractJson(text);
  if (!parsed) return [];
  const result = reviewResponseSchema.safeParse(parsed);
  if (!result.success) return [];
  return Array.isArray(result.data) ? result.data : result.data.reviews;
}

/**
 * Review a list of deterministic-scanner arbitrage opportunities and return
 * only the ones the AI reviewer approves, annotated with a sizeFraction.
 *
 * The caller's risk-budget layer should multiply its normal arbitrage budget
 * by sizeFraction before sizing the legs.  A sizeFraction of 0 means veto.
 */
export async function reviewArbitrageOpportunities(
  opportunities: CrossPlatformArbitrageOpportunity[],
  options: ArbReviewerOptions = {},
): Promise<ReviewedArbitrageOpportunity[]> {
  if (opportunities.length === 0) return [];
  if (process.env.NODE_ENV === "test" && options.skipInTest !== false) {
    return opportunities.map((opp) => ({
      ...opp,
      pairId: pairIdFor(opp),
      sizeFraction: 0.5,
      reviewerReasoning: "[test mode] AI review skipped",
      citations: [],
    }));
  }

  const logger = options.logger ?? console;
  if (!isArbReviewerConfigured(options)) {
    logger.error(
      "[ArbReviewer] ANTHROPIC_API_KEY missing; dropping all arbitrage candidates so we never auto-execute multi-leg trades without AI sign-off.",
    );
    return [];
  }

  const capped = opportunities.slice(0, ARB_REVIEWER_MAX_OPPORTUNITIES);
  const payload = {
    desk: "Cross-Platform Arbitrage Desk (Kalshi ↔ Polymarket)",
    candidates: capped.map(summarizeOpportunityForPayload),
  };

  const cachedSystem: SystemBlock[] = ENV.enableAiPromptCache
    ? buildCachedSystemPrompt(ARBITRAGE_DESK_MANDATE)
    : [{ type: "text", text: ARBITRAGE_DESK_MANDATE }];

  const tools = buildToolList([], { allowWebSearch: true, maxWebSearchUses: 4 });
  const client =
    options.anthropicClient ??
    createAnthropicClient((options.anthropicApiKey ?? ENV.anthropicApiKey).trim());

  const messageInput: Record<string, unknown> = {
    // Always use the deep model — multi-leg cross-platform arbitrage is
    // by definition high-stakes; we want depth over speed.
    model: options.anthropicModel ?? ENV.anthropicDeepModel,
    max_tokens: ARB_REVIEWER_MAX_TOKENS,
    temperature: 0,
    system: cachedSystem,
    messages: [{ role: "user", content: JSON.stringify(payload) }],
  };
  if (ENV.enableAiExtendedThinking) {
    messageInput.thinking = { type: "enabled", budget_tokens: 3000 };
  }
  if (tools) messageInput.tools = tools;

  let parsedReviews: ParsedReview[] = [];
  let citations: CitationSummary[] = [];
  try {
    const response = await callAnthropicWithTimeout(
      client as unknown as {
        messages: { create: (input: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }> };
      },
      messageInput,
      options.anthropicTimeoutMs ?? ENV.anthropicTimeoutMs,
      "ArbReviewer",
    );
    parsedReviews = parseReviews(extractAnthropicText(response));
    if (ENV.enableAiCitations) {
      citations = extractCitations(response as { content: Array<unknown> });
    }
  } catch (error) {
    logger.error(
      `[ArbReviewer] AI review failed: ${error instanceof Error ? error.message : String(error)}; dropping all arbitrage candidates.`,
    );
    return [];
  }

  const reviewByPairId = new Map(parsedReviews.map((review) => [review.pairId, review]));
  const citationLabel = formatCitationsForReasoning(citations);

  return capped
    .map((opp) => {
      const review = reviewByPairId.get(pairIdFor(opp));
      if (!review || !review.approved) return null;

      const sizeFraction = Math.max(0, Math.min(1, Number(review.sizeFraction ?? 0.25)));
      if (sizeFraction <= 0) return null;

      const reasoning = (review.reasoning ?? "Approved by arbitrage desk after review.").slice(
        0,
        ARB_REVIEWER_REASONING_CHARS,
      );

      return {
        ...opp,
        pairId: pairIdFor(opp),
        sizeFraction,
        reviewerReasoning: `${reasoning}${citationLabel}`,
        citations,
      } satisfies ReviewedArbitrageOpportunity;
    })
    .filter((opp): opp is ReviewedArbitrageOpportunity => Boolean(opp));
}
