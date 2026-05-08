import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock db so the audit-log import inside aiCostBudget never hits Postgres in tests.
vi.mock("./db", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
  __TEST_ONLY__,
  checkBudgetForRun,
  computeCallCostUsd,
  recordAiCallCost,
} from "./_core/aiCostBudget";

describe("aiCostBudget", () => {
  beforeEach(() => {
    __TEST_ONLY__.reset();
  });

  afterEach(() => {
    __TEST_ONLY__.reset();
  });

  describe("computeCallCostUsd", () => {
    it("computes Haiku 4.5 cost from input + output + cache hit/write tokens", () => {
      // Anthropic billing contract: input_tokens is ALREADY the non-cached
      // portion; cache_read and cache_creation are reported separately and
      // billed at their own rates.  Total input = 1000 + 2000 + 1500 = 4500
      // tokens spread across three rate buckets.
      // Pricing: input $0.80/M, output $4/M, cache read $0.08/M, cache write $1/M.
      const usd = computeCallCostUsd("claude-haiku-4-5-20251001", {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 2000,
        cacheCreationInputTokens: 1500,
      });
      // base input  = 1000 → 1000*0.8/1e6   = 0.0008
      // output      = 500  → 500*4/1e6      = 0.002
      // cache read  = 2000 → 2000*0.08/1e6  = 0.00016
      // cache write = 1500 → 1500*1/1e6     = 0.0015
      // total       ≈ 0.00446
      expect(usd).toBeCloseTo(0.00446, 5);
    });

    it("does NOT subtract cache tokens from inputTokens (Codex regression)", () => {
      // Regression for the prior bug where billable input was computed as
      // input - cacheRead - cacheWrite, double-counting the cache discount
      // and undercounting actual spend (could let autonomy run past the cap).
      // input_tokens=1000 + cacheRead=5000.  Should bill 1000 at base rate
      // PLUS 5000 at cache-read rate, NOT 0 (clamped) at base rate.
      const usd = computeCallCostUsd("claude-haiku-4-5-20251001", {
        inputTokens: 1000,
        outputTokens: 0,
        cacheReadInputTokens: 5000,
        cacheCreationInputTokens: 0,
      });
      // 1000 * 0.80/1e6 + 5000 * 0.08/1e6 = 0.0008 + 0.0004 = 0.0012
      expect(usd).toBeCloseTo(0.0012, 5);
    });

    it("falls back to conservative pricing for unknown models", () => {
      const usd = computeCallCostUsd("some-future-model-x", {
        inputTokens: 1_000_000,
        outputTokens: 0,
      });
      // DEFAULT_PRICING input $5/M
      expect(usd).toBeCloseTo(5, 2);
    });

    it("computes Grok cost from prompt + completion tokens", () => {
      // grok-3-latest: $3/M input, $15/M output
      const usd = computeCallCostUsd("grok-3-latest", {
        inputTokens: 1000,
        outputTokens: 500,
      });
      // 1000*3/1e6 + 500*15/1e6 = 0.003 + 0.0075 = 0.0105
      expect(usd).toBeCloseTo(0.0105, 5);
    });
  });

  describe("checkBudgetForRun + recordAiCallCost", () => {
    // Reset the scoreboard cache before each budget test so prior tests
    // don't leak a "net positive" state into the throttle logic.
    beforeEach(async () => {
      const sb = await import("./_core/dailyScoreboard");
      sb.__TEST_ONLY__.reset();
    });

    it("returns proceed=true and throttle=1 when no cap is configured", () => {
      __TEST_ONLY__.setCapUsd(0);
      const decision = checkBudgetForRun();
      expect(decision.proceed).toBe(true);
      expect(decision.throttleFactor).toBe(1);
      expect(decision.reason).toBe("no_cap");
    });

    it("cold-start exemption: under $5 AI spend, no throttle even when net-down", async () => {
      const sb = await import("./_core/dailyScoreboard");
      __TEST_ONLY__.setCapUsd(10);
      __TEST_ONLY__.setSpentUsd(2); // below $5 cold-start floor
      sb.__TEST_ONLY__.setCached({
        dayBucketMs: Date.now(),
        realizedPnlUsd: 0,
        estimatedFeesUsd: 0,
        aiSpendUsd: 2,
        netUsd: -2,
        effectiveOverrunUsd: 2,
        refreshedAtMs: Date.now(),
      });
      const decision = checkBudgetForRun();
      expect(decision.proceed).toBe(true);
      expect(decision.throttleFactor).toBe(1);
      expect(decision.reason).toBe("cold_start");
    });

    it("net-positive day: never throttle regardless of AI spend", async () => {
      const sb = await import("./_core/dailyScoreboard");
      __TEST_ONLY__.setCapUsd(10);
      __TEST_ONLY__.setSpentUsd(50); // 5x the cap, but…
      sb.__TEST_ONLY__.setCached({
        dayBucketMs: Date.now(),
        realizedPnlUsd: 200, // …we made $200, so net-positive
        estimatedFeesUsd: 5,
        aiSpendUsd: 50,
        netUsd: 145,
        effectiveOverrunUsd: 0,
        refreshedAtMs: Date.now(),
      });
      const decision = checkBudgetForRun();
      expect(decision.proceed).toBe(true);
      expect(decision.throttleFactor).toBe(1);
      expect(decision.reason).toBe("net_positive");
    });

    it("escalates throttle factor as effective overrun burns through cap (net-negative day)", async () => {
      const sb = await import("./_core/dailyScoreboard");
      __TEST_ONLY__.setCapUsd(10);
      // The scoreboard re-computes effectiveOverrun = aiSpend - realizedPnl
      // live on every read, so we control it via (spentUsd, realizedPnlUsd).
      // Past cold-start (spent >= $5) and net-negative (overrun > 0).
      const setOverrun = (overrun: number) => {
        const aiSpend = 7; // fixed; > $5 to clear cold start
        __TEST_ONLY__.setSpentUsd(aiSpend);
        sb.__TEST_ONLY__.setCached({
          dayBucketMs: Date.now(),
          realizedPnlUsd: aiSpend - overrun,
          estimatedFeesUsd: 0,
          aiSpendUsd: aiSpend,
          netUsd: -overrun,
          effectiveOverrunUsd: overrun,
          refreshedAtMs: Date.now(),
        });
      };
      setOverrun(2);  // 20% of cap=10
      expect(checkBudgetForRun().throttleFactor).toBe(1);
      setOverrun(6);  // 60%
      expect(checkBudgetForRun().throttleFactor).toBe(1.5);
      setOverrun(8.1); // 81%
      expect(checkBudgetForRun().throttleFactor).toBe(2);
      setOverrun(9.6); // 96%
      expect(checkBudgetForRun().throttleFactor).toBe(4);
    });

    it("returns proceed=false when effective overrun reaches cap", async () => {
      const sb = await import("./_core/dailyScoreboard");
      __TEST_ONLY__.setCapUsd(10);
      __TEST_ONLY__.setSpentUsd(20);
      // overrun = 20 - 5 = 15 (150% of cap)
      sb.__TEST_ONLY__.setCached({
        dayBucketMs: Date.now(),
        realizedPnlUsd: 5,
        estimatedFeesUsd: 0,
        aiSpendUsd: 20,
        netUsd: -15,
        effectiveOverrunUsd: 15,
        refreshedAtMs: Date.now(),
      });
      const decision = checkBudgetForRun();
      expect(decision.proceed).toBe(false);
      expect(decision.reason).toBe("exhausted_skip");
    });

    it("recordAiCallCost accumulates spend against the running total", () => {
      __TEST_ONLY__.setCapUsd(1);
      __TEST_ONLY__.setSpentUsd(0);
      // ~$0.0105 per call
      recordAiCallCost("grok-3-latest", { inputTokens: 1000, outputTokens: 500 });
      recordAiCallCost("grok-3-latest", { inputTokens: 1000, outputTokens: 500 });
      const state = __TEST_ONLY__.getState();
      expect(state.spentUsd).toBeCloseTo(0.021, 5);
    });
  });
});
