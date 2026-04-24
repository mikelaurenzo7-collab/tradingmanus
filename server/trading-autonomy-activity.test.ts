import { describe, expect, it } from "vitest";
import {
  formatAutonomyActivityTime,
  getAutonomyEventLabel,
  getAutonomyReviewSummary,
  type AutonomyActivitySummary,
} from "../client/src/lib/tradingAutonomy";

const baseActivity: AutonomyActivitySummary = {
  lastRun: null,
  lastOrder: null,
  recentActivity: [],
};

describe("trading autonomy activity helpers", () => {
  it("describes a blocked away-from-chat review with persisted signal counts", () => {
    const summary = getAutonomyReviewSummary({
      ...baseActivity,
      lastRun: {
        eventType: "scheduled_autonomy_run_blocked",
        status: "blocked",
        createdAt: new Date("2026-04-24T12:00:00.000Z"),
        reason: "daily order cap reached",
        signalsGenerated: 3,
        executionCandidates: 1,
        candidateMarketId: "KXTEST-1",
        executedMarketId: null,
        autonomyMode: "fully_autonomous",
        executionCadence: "continuous_watch",
      },
    });

    expect(summary.title).toContain("blocked");
    expect(summary.body).toContain("3 signals · 1 execution-ready candidates");
    expect(summary.body).toContain("daily order cap reached");
  });

  it("describes an executed away-from-chat review with the executed market id", () => {
    const summary = getAutonomyReviewSummary({
      ...baseActivity,
      lastRun: {
        eventType: "scheduled_autonomy_run_executed",
        status: "executed",
        createdAt: new Date("2026-04-24T13:00:00.000Z"),
        reason: "scheduled autonomy found an eligible non-heuristic signal and placed a live order",
        signalsGenerated: 4,
        executionCandidates: 2,
        candidateMarketId: "KXTEST-2",
        executedMarketId: "KXTEST-2",
        autonomyMode: "fully_autonomous",
        executionCadence: "continuous_watch",
      },
    });

    expect(summary.title).toContain("placed a live order");
    expect(summary.body).toContain("Executed KXTEST-2");
    expect(summary.tone).toBe("text-emerald-300");
  });

  it("keeps event labels readable for away-from-chat activity rows", () => {
    expect(getAutonomyEventLabel("scheduled_autonomy_run_generated_only")).toBe(
      "Away Review Generated Only"
    );
    expect(getAutonomyEventLabel("live_trading_armed")).toBe("Live Trading Armed");
  });

  it("formats recorded timestamps into a display string", () => {
    expect(formatAutonomyActivityTime(new Date("2026-04-24T13:30:00.000Z"))).not.toBe(
      "Not yet recorded"
    );
    expect(formatAutonomyActivityTime(null)).toBe("Not yet recorded");
  });
});
