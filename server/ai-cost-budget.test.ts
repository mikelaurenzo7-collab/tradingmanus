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
      // Pricing: input $0.80/M, output $4/M, cache read $0.08/M, cache write $1/M.
      // 1000 input (excludes cache), 500 output, 2000 cache read, 1500 cache write.
      // Anthropic reports input_tokens including cache reads/creates, so callsite
      // sends inputTokens = 1000 + 2000 + 1500 = 4500 to mirror the real wire.
      const usd = computeCallCostUsd("claude-haiku-4-5-20251001", {
        inputTokens: 4500,
        outputTokens: 500,
        cacheReadInputTokens: 2000,
        cacheCreationInputTokens: 1500,
      });
      // billable input = 1000 → 1000*0.8/1e6 = 0.0008
      // output         = 500  → 500*4/1e6   = 0.002
      // cache read     = 2000 → 2000*0.08/1e6 = 0.00016
      // cache write    = 1500 → 1500*1/1e6   = 0.0015
      // total          ≈ 0.00446
      expect(usd).toBeCloseTo(0.00446, 5);
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
    it("returns proceed=true and throttle=1 when no cap is configured", () => {
      __TEST_ONLY__.setCapUsd(0);
      const decision = checkBudgetForRun();
      expect(decision.proceed).toBe(true);
      expect(decision.throttleFactor).toBe(1);
    });

    it("escalates throttle factor as budget burns", () => {
      __TEST_ONLY__.setCapUsd(10);
      __TEST_ONLY__.setSpentUsd(2);
      expect(checkBudgetForRun().throttleFactor).toBe(1);
      __TEST_ONLY__.setSpentUsd(6);
      expect(checkBudgetForRun().throttleFactor).toBe(1.5);
      __TEST_ONLY__.setSpentUsd(8.1);
      expect(checkBudgetForRun().throttleFactor).toBe(2);
      __TEST_ONLY__.setSpentUsd(9.6);
      expect(checkBudgetForRun().throttleFactor).toBe(4);
    });

    it("returns proceed=false at 100% spent", () => {
      __TEST_ONLY__.setCapUsd(10);
      __TEST_ONLY__.setSpentUsd(10.01);
      const decision = checkBudgetForRun();
      expect(decision.proceed).toBe(false);
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
