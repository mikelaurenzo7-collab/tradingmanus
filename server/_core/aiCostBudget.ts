/**
 * AI cost budget + auto-throttle.
 *
 * Tracks USD spend on Anthropic calls for the current UTC day and
 * exposes a throttle factor the schedulers consult before kicking off
 * an autonomy run.  When AI_DAILY_BUDGET_USD is unset (or 0), this
 * module is a no-op and every run proceeds normally.
 *
 * Design notes
 *
 *  - The counter is process-local and resets at UTC midnight.  Container
 *    restarts reset the counter mid-day, which is conservative
 *    (re-arms the budget) — not the scary direction.
 *
 *  - Pricing is hardcoded per model.  Anthropic publishes list
 *    pricing in USD per million tokens; we encode it here so the
 *    budget reflects actual spend without runtime lookups.  Update
 *    when prices change.
 *
 *  - Binary on/off semantics (single-tenant).  Either the day is OK
 *    (profitable, or losing less than the cap) and the bot runs at
 *    full speed, or the day has burned more than the cap on
 *    AI-overhead-relative-to-PnL and the run skips entirely until UTC
 *    rollover.  No progressive throttle — the bot never performs
 *    "slightly worse" near the cap.
 *
 *  - Audit events: every recordCost() call also writes an
 *    `ai_cost_recorded` audit event with model + tokens + USD so the
 *    operator can reconcile actual spend from the audit log.  We do
 *    NOT block on the audit write (fire-and-forget) so cost recording
 *    cannot delay or fail an autonomy cycle.
 */

import { logger } from "./logger";

/** Per-million-token list pricing in USD. */
type ModelPricing = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  /**
   * When > 0, requests using this model and a `cache_read_input_tokens` >
   * 0 share will be billed at this rate for the cached portion.  Default
   * is the same as inputUsdPerMillion when unset.
   */
  cacheReadUsdPerMillion?: number;
  /**
   * Cache-write surcharge (write-through to ephemeral cache).
   */
  cacheWriteUsdPerMillion?: number;
};

/**
 * List prices as of 2026-05.  Update when Anthropic publishes new
 * tiers.  Values that are not exactly matched fall through to the
 * conservative DEFAULT_PRICING below so an unknown model still bills
 * approximately right (slight over-billing biases toward earlier
 * throttle, which is the safe direction).
 */
const HAIKU_45_PRICING: ModelPricing = Object.freeze({
  inputUsdPerMillion: 0.8,
  outputUsdPerMillion: 4.0,
  cacheReadUsdPerMillion: 0.08,
  cacheWriteUsdPerMillion: 1.0,
});

const PRICE_TABLE: Record<string, ModelPricing> = {
  // Anthropic Claude 4.5 / 4.6 / 4.7
  // Both the bare alias and the dated snapshot map to the same Haiku 4.5
  // pricing — `selectAnthropicModel` returns CLAUDE_HAIKU_MODEL which
  // defaults to the alias `claude-haiku-4-5`, but Anthropic responses
  // also echo the dated snapshot in some cases. Without both keys the
  // alias falls through to DEFAULT_PRICING and over-bills, throttling
  // AI_DAILY_BUDGET_USD and post-cost EV gates earlier than intended.
  // Single shared constant prevents drift on the next price update.
  "claude-haiku-4-5": HAIKU_45_PRICING,
  "claude-haiku-4-5-20251001": HAIKU_45_PRICING,
  "claude-sonnet-4-6": {
    inputUsdPerMillion: 3.0,
    outputUsdPerMillion: 15.0,
    cacheReadUsdPerMillion: 0.3,
    cacheWriteUsdPerMillion: 3.75,
  },
  "claude-opus-4-7": {
    inputUsdPerMillion: 15.0,
    outputUsdPerMillion: 75.0,
    cacheReadUsdPerMillion: 1.5,
    cacheWriteUsdPerMillion: 18.75,
  },
};

/** Conservative fallback for unknown / future models. */
const DEFAULT_PRICING: ModelPricing = {
  inputUsdPerMillion: 5.0,
  outputUsdPerMillion: 25.0,
};

function priceFor(model: string): ModelPricing {
  return PRICE_TABLE[model] ?? DEFAULT_PRICING;
}

export type CostUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
};

/**
 * Compute the USD cost of one model call given the usage block returned
 * by Anthropic.
 *
 * Anthropic billing contract for prompt caching:
 *   - `input_tokens`              = non-cached, non-cache-created input
 *                                   (already net of cache reads/writes;
 *                                   billed at the base input rate)
 *   - `cache_creation_input_tokens` = tokens written to cache
 *                                   (billed at the cache-write surcharge)
 *   - `cache_read_input_tokens`   = tokens served from cache
 *                                   (billed at the cache-read discount)
 *
 * Total input = input_tokens + cache_creation + cache_read.  Each part
 * has its own rate, so we sum them directly without subtraction.
 */
export function computeCallCostUsd(model: string, usage: CostUsage): number {
  const p = priceFor(model);
  const baseInput = Number(usage.inputTokens ?? 0) || 0;
  const output = Number(usage.outputTokens ?? 0) || 0;
  const cacheRead = Number(usage.cacheReadInputTokens ?? 0) || 0;
  const cacheWrite = Number(usage.cacheCreationInputTokens ?? 0) || 0;

  const cacheReadRate = p.cacheReadUsdPerMillion ?? p.inputUsdPerMillion;
  const cacheWriteRate = p.cacheWriteUsdPerMillion ?? p.inputUsdPerMillion;

  return (
    (baseInput * p.inputUsdPerMillion +
      output * p.outputUsdPerMillion +
      cacheRead * cacheReadRate +
      cacheWrite * cacheWriteRate) /
    1_000_000
  );
}

// ── Process-local daily counter ────────────────────────────────────────────

type BudgetState = {
  /** Spent USD since the current UTC day boundary. */
  spentUsd: number;
  /** UTC day epoch (start of day in ms) for the current bucket. */
  dayBucketMs: number;
};

function utcDayBucketMs(now: number = Date.now()): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

const STATE: BudgetState = {
  spentUsd: 0,
  dayBucketMs: utcDayBucketMs(),
};

/**
 * Public read of today's AI spend in USD.  Used by dailyScoreboard to
 * combine with realized P&L + fees into the running net.  Rolls with
 * UTC midnight automatically.
 */
export function getSpentUsdToday(now: number = Date.now()): number {
  maybeRoll(now);
  return STATE.spentUsd;
}

function maybeRoll(now: number = Date.now()): void {
  const bucket = utcDayBucketMs(now);
  if (bucket !== STATE.dayBucketMs) {
    if (STATE.spentUsd > 0) {
      logger.info(
        {
          previousDayBucketMs: STATE.dayBucketMs,
          spentUsd: Number(STATE.spentUsd.toFixed(4)),
        },
        "[aiCostBudget] daily AI spend rolling over",
      );
    }
    STATE.spentUsd = 0;
    STATE.dayBucketMs = bucket;
  }
}

/**
 * Record one model call against the daily budget.  Computes USD from the
 * usage block, accumulates into the day's spend, and emits a
 * fire-and-forget audit event so the operator can reconcile actuals.
 */
// note: budget-gating has moved to dailyScoreboard.isDailyLossLimitExceeded()
export function recordAiCallCost(
  model: string,
  usage: CostUsage,
  context?: { provider?: "anthropic"; reviewer?: string; userId?: number },
): number {
  const usd = computeCallCostUsd(model, usage);
  if (!Number.isFinite(usd) || usd < 0) return 0;

  maybeRoll();
  STATE.spentUsd += usd;

  // Best-effort audit log (don't block or fail the call).
  if (usd > 0) {
    void writeAuditEvent({ model, usage, usd, context }).catch(() => {});
  }

  return usd;
}

async function writeAuditEvent(input: {
  model: string;
  usage: CostUsage;
  usd: number;
  context?: { provider?: "anthropic"; reviewer?: string; userId?: number };
}): Promise<void> {
  try {
    const db = await import("../db");
    await db.logAuditEvent(
      "ai_cost_recorded",
      JSON.stringify({
        model: input.model,
        provider: input.context?.provider,
        reviewer: input.context?.reviewer,
        usd: Number(input.usd.toFixed(6)),
        inputTokens: input.usage.inputTokens ?? 0,
        outputTokens: input.usage.outputTokens ?? 0,
        cacheReadInputTokens: input.usage.cacheReadInputTokens ?? 0,
        cacheCreationInputTokens: input.usage.cacheCreationInputTokens ?? 0,
        spentUsdToday: Number(STATE.spentUsd.toFixed(4)),
      }),
      input.context?.userId ? String(input.context.userId) : "system",
    );
  } catch {
    // Swallow — auditing AI cost is best-effort.
  }
}

// ── Test-only helpers ─────────────────────────────────────────────────────

export const __TEST_ONLY__ = {
  /** Reset the in-memory counter. */
  reset(): void {
    STATE.spentUsd = 0;
    STATE.dayBucketMs = utcDayBucketMs();
  },
  /** Forcibly set spent USD for deterministic tests. */
  setSpentUsd(usd: number): void {
    STATE.spentUsd = usd;
  },
  getState(): Readonly<BudgetState> {
    return { ...STATE };
  },
  PRICE_TABLE,
  DEFAULT_PRICING,
};
