/**
 * AI cost budget + auto-throttle.
 *
 * Tracks USD spend on Anthropic + xAI calls for the current UTC day and
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
 *  - Pricing is hardcoded per model.  Anthropic + xAI publish list
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
// Top-level import is safe even though dailyScoreboard imports back from us:
// both ends export function declarations (hoisted), so neither side observes
// an undefined binding during module init.
import { getCachedScoreboard, getColdStartAiUsd } from "./dailyScoreboard";

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
 * List prices as of 2026-05.  Update when Anthropic / xAI publish new
 * tiers.  Values that are not exactly matched fall through to the
 * conservative DEFAULT_PRICING below so an unknown model still bills
 * approximately right (slight over-billing biases toward earlier
 * throttle, which is the safe direction).
 */
const PRICE_TABLE: Record<string, ModelPricing> = {
  // Anthropic Claude 4.5 / 4.6 / 4.7
  "claude-haiku-4-5-20251001": {
    inputUsdPerMillion: 0.8,
    outputUsdPerMillion: 4.0,
    cacheReadUsdPerMillion: 0.08,
    cacheWriteUsdPerMillion: 1.0,
  },
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
  // xAI Grok 3 (list price as of launch).
  "grok-3-latest": {
    inputUsdPerMillion: 3.0,
    outputUsdPerMillion: 15.0,
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
 * by Anthropic (or our normalised Grok counterpart).
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
  /** Configured cap in USD (0 = unlimited / disabled). */
  capUsd: number;
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

function readCapUsd(): number {
  const raw = (process.env.AI_DAILY_BUDGET_USD ?? "").trim();
  if (!raw) return 0;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

const STATE: BudgetState = {
  capUsd: readCapUsd(),
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
          capUsd: STATE.capUsd,
        },
        "[aiCostBudget] daily AI spend rolling over",
      );
    }
    STATE.spentUsd = 0;
    STATE.dayBucketMs = bucket;
  }
}

/**
 * Throttle decision the schedulers consult before each autonomy tick.
 *
 * Pay-for-yourself semantics:
 *   The throttle is driven by `effectiveOverrun = max(0, ai_cost + fees − pnl)`,
 *   not raw AI spend.  Profitable days never throttle regardless of how much
 *   we spent on AI — we earned the overhead.  Losing days self-throttle as
 *   the deficit widens.
 *
 *   Cold start: until the bot has spent at least the cold-start floor
 *   (default $5) on AI today, the throttle stays off regardless of net.
 *   This prevents the "no trades on day 1 because no P&L yet" deadlock.
 *
 *   When AI_DAILY_BUDGET_USD is unset (cap=0), this module is a no-op —
 *   every tick proceeds with throttleFactor=1.
 *
 *   proceed=false      → skip this tick entirely (>=100 % effective overrun)
 *   throttleFactor=N   → multiply adaptive-cadence stale TTL by N
 *                        (>=1; 1 = no throttle)
 */
export type BudgetDecision = {
  proceed: boolean;
  throttleFactor: number;
  /** Raw AI spend USD today (informational; not the throttle driver). */
  spentUsd: number;
  /** Configured daily cap. */
  capUsd: number;
  /** ai_cost + fees − pnl, clamped to >= 0.  Drives the throttle. */
  effectiveOverrunUsd: number;
  /** effectiveOverrunUsd / capUsd, for telemetry / logging. */
  fractionSpent: number;
  /** Why the throttle decided what it did — surfaces in audit logs. */
  reason:
    | "no_cap"
    | "cold_start"
    | "net_positive"
    | "net_negative_throttle"
    | "exhausted_skip";
};

export function checkBudgetForRun(now: number = Date.now()): BudgetDecision {
  maybeRoll(now);
  const capUsd = STATE.capUsd;
  const spentUsd = STATE.spentUsd;
  if (capUsd <= 0) {
    return {
      proceed: true,
      throttleFactor: 1,
      spentUsd,
      capUsd,
      effectiveOverrunUsd: 0,
      fractionSpent: 0,
      reason: "no_cap",
    };
  }

  // Pull the latest daily scoreboard for P&L-aware throttling.  Cached
  // value lives in dailyScoreboard.ts and is refreshed at the top of each
  // scheduler tick before this fn is consulted.  Synchronous read.
  const scoreboard = getCachedScoreboard();
  const coldStartFloor = getColdStartAiUsd();

  const effectiveOverrunUsd = scoreboard
    ? scoreboard.effectiveOverrunUsd
    : spentUsd; // legacy fallback when no scoreboard yet (first boot tick)

  // Cold-start exemption: a brand-new day with minimal spend is the wrong
  // place to enforce pay-for-yourself.
  if (spentUsd < coldStartFloor) {
    return {
      proceed: true,
      throttleFactor: 1,
      spentUsd,
      capUsd,
      effectiveOverrunUsd,
      fractionSpent: 0,
      reason: "cold_start",
    };
  }

  // Net-positive day: no throttle ever, regardless of AI spend magnitude.
  if (scoreboard && scoreboard.netUsd > 0) {
    return {
      proceed: true,
      throttleFactor: 1,
      spentUsd,
      capUsd,
      effectiveOverrunUsd: 0,
      fractionSpent: 0,
      reason: "net_positive",
    };
  }

  // Single-tenant model: full speed until the day is genuinely losing more
  // than the operator-chosen cap, then hard stop.  No middle-ground
  // progressive throttle — the prior ramp (×1.5 at 60 %, ×2 at 80 %, ×4 at
  // 95 %) made the bot literally perform worse near the cap, which is the
  // exact opposite of what an owner accepting the risk wants.  The cap is
  // a "max acceptable daily loss attributable to AI overhead", not a soft
  // ceiling to feather toward.
  //
  //   profit > 0                    → run (net_positive branch above)
  //   profit ≤ 0, overrun < capUsd  → run at full speed (this branch)
  //   profit ≤ 0, overrun ≥ capUsd  → hard skip (next tick re-checks)
  const fractionSpent = effectiveOverrunUsd / capUsd;
  if (fractionSpent >= 1.0) {
    return {
      proceed: false,
      throttleFactor: 1,
      spentUsd,
      capUsd,
      effectiveOverrunUsd,
      fractionSpent,
      reason: "exhausted_skip",
    };
  }
  return {
    proceed: true,
    throttleFactor: 1,
    spentUsd,
    capUsd,
    effectiveOverrunUsd,
    fractionSpent,
    reason: "net_negative_throttle",
  };
}

/**
 * Record one model call against the daily budget.  Computes USD from the
 * usage block, accumulates into the day's spend, and emits a
 * fire-and-forget audit event so the operator can reconcile actuals.
 */
export function recordAiCallCost(
  model: string,
  usage: CostUsage,
  context?: { provider?: "anthropic" | "grok"; reviewer?: string; userId?: number },
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
  context?: { provider?: "anthropic" | "grok"; reviewer?: string; userId?: number };
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
        capUsd: STATE.capUsd,
      }),
      input.context?.userId ? String(input.context.userId) : "system",
    );
  } catch {
    // Swallow — auditing AI cost is best-effort.
  }
}

// ── Test-only helpers ─────────────────────────────────────────────────────

export const __TEST_ONLY__ = {
  /** Reset the in-memory counter and reload the cap from env. */
  reset(): void {
    STATE.capUsd = readCapUsd();
    STATE.spentUsd = 0;
    STATE.dayBucketMs = utcDayBucketMs();
  },
  /** Forcibly set the cap (bypassing env) for deterministic tests. */
  setCapUsd(usd: number): void {
    STATE.capUsd = usd;
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
