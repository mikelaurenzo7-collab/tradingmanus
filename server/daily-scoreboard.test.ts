import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
  __TEST_ONLY__,
  formatScoreboardForPrompt,
  getCachedScoreboard,
  refreshScoreboard,
  type DailyScoreboard,
} from "./_core/dailyScoreboard";
import { __TEST_ONLY__ as BUDGET } from "./_core/aiCostBudget";

beforeEach(() => {
  __TEST_ONLY__.reset();
  BUDGET.reset();
});

afterEach(() => {
  __TEST_ONLY__.reset();
  BUDGET.reset();
});

describe("dailyScoreboard", () => {
  it("getCachedScoreboard returns null before first refresh", () => {
    expect(getCachedScoreboard()).toBeNull();
  });

  it("refreshScoreboard returns an empty scoreboard when DB is unavailable", async () => {
    const snapshot = await refreshScoreboard(1);
    expect(snapshot.realizedPnlUsd).toBe(0);
    expect(snapshot.estimatedFeesUsd).toBe(0);
    // Use toBeCloseTo instead of toBe — JS's `0 - 0` produces -0 which
    // fails Object.is(0, -0) but is mathematically equivalent.
    expect(snapshot.netUsd).toBeCloseTo(0, 10);
  });

  it("getCachedScoreboard re-reads AI spend live so multi-call within a tick stays accurate", () => {
    __TEST_ONLY__.setCached({
      dayBucketMs: Date.now(),
      realizedPnlUsd: 100,
      estimatedFeesUsd: 5,
      aiSpendUsd: 10,
      netUsd: 85,
      effectiveOverrunUsd: 0,
      refreshedAtMs: Date.now(),
      dynamicDailyLossLimitUsd: 20,
    });
    // Simulate AI cost accumulation between refreshes.
    BUDGET.setSpentUsd(20);
    const live = getCachedScoreboard()!;
    expect(live.aiSpendUsd).toBe(20);
    // Net should reflect the new ai spend: 100 - 20 - 5 = 75
    expect(live.netUsd).toBe(75);
    expect(live.effectiveOverrunUsd).toBe(0); // still net-positive
  });

  it("effectiveOverrunUsd flips positive when AI cost + fees exceed P&L", () => {
    __TEST_ONLY__.setCached({
      dayBucketMs: Date.now(),
      realizedPnlUsd: 5,
      estimatedFeesUsd: 2,
      aiSpendUsd: 10,
      netUsd: -7,
      effectiveOverrunUsd: 7,
      refreshedAtMs: Date.now(),
      dynamicDailyLossLimitUsd: 20,
    });
    BUDGET.setSpentUsd(10);
    const live = getCachedScoreboard()!;
    // overrun = max(0, 10 + 2 - 5) = 7
    expect(live.effectiveOverrunUsd).toBe(7);
    expect(live.netUsd).toBe(-7);
  });

  describe("formatScoreboardForPrompt", () => {
    it("returns null when no scoreboard is cached", () => {
      expect(formatScoreboardForPrompt(null)).toBeNull();
    });

    it("renders NET POSITIVE status when net > 0", () => {
      const sb: DailyScoreboard = {
        dayBucketMs: Date.now(),
        realizedPnlUsd: 50,
        estimatedFeesUsd: 2,
        aiSpendUsd: 10,
        netUsd: 38,
        effectiveOverrunUsd: 0,
        refreshedAtMs: Date.now(),
        dynamicDailyLossLimitUsd: 20,
      };
      const text = formatScoreboardForPrompt(sb);
      expect(text).toContain("NET POSITIVE");
      expect(text).toContain("$38");
      expect(text).toContain("Pay-for-yourself rule");
    });

    it("renders NET NEGATIVE status when net < 0", () => {
      const sb: DailyScoreboard = {
        dayBucketMs: Date.now(),
        realizedPnlUsd: 0,
        estimatedFeesUsd: 1,
        aiSpendUsd: 5,
        netUsd: -6,
        effectiveOverrunUsd: 6,
        refreshedAtMs: Date.now(),
        dynamicDailyLossLimitUsd: 20,
      };
      const text = formatScoreboardForPrompt(sb);
      expect(text).toContain("NET NEGATIVE");
      expect(text).toContain("raise your EV/confidence bar");
    });

    it("renders BREAKEVEN status when net == 0", () => {
      const sb: DailyScoreboard = {
        dayBucketMs: Date.now(),
        realizedPnlUsd: 5,
        estimatedFeesUsd: 0,
        aiSpendUsd: 5,
        netUsd: 0,
        effectiveOverrunUsd: 0,
        refreshedAtMs: Date.now(),
        dynamicDailyLossLimitUsd: 20,
      };
      const text = formatScoreboardForPrompt(sb);
      expect(text).toContain("BREAKEVEN");
    });

    it("includes the never-trade-just-to-pay-back rule", () => {
      const sb: DailyScoreboard = {
        dayBucketMs: Date.now(),
        realizedPnlUsd: 0,
        estimatedFeesUsd: 0,
        aiSpendUsd: 10,
        netUsd: -10,
        effectiveOverrunUsd: 10,
        refreshedAtMs: Date.now(),
        dynamicDailyLossLimitUsd: 20,
      };
      const text = formatScoreboardForPrompt(sb);
      expect(text).toContain("hubris");
    });
  });
});
