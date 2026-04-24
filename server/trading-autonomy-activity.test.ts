import { describe, expect, it } from "vitest";
import {
  formatAutonomyActivityTime,
  getAutonomyDecisionSummary,
  getAutonomyEventLabel,
  getAutonomyReadinessSummary,
  getAutonomyReviewSummary,
  type AutonomyActivitySummary,
  type TradingPreferences,
} from "../client/src/lib/tradingAutonomy";

const baseActivity: AutonomyActivitySummary = {
  lastRun: null,
  lastOrder: null,
  recentActivity: [],
};

const basePreferences: TradingPreferences = {
  autonomyMode: "fully_autonomous",
  liveTradingEnabled: true,
  executionCadence: "continuous_watch",
  riskPosture: "balanced",
  minSignalConfidence: 0.72,
  maxOrderNotional: 10,
  maxDailyOrders: 3,
  requireApprovalAbove: 8,
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
        decision: {
          marketId: "KXTEST-1",
          side: "yes",
          confidence: 0.83,
          executionScore: 0.84,
          expectedValue: 0.18,
          limitPrice: 0.43,
          quantity: null,
          availableCapital: null,
          maxBudget: null,
          orderExposure: null,
          maxLossOnTrade: null,
          reasoning: "Explicit probability edge",
          blockedBy: "daily_order_cap",
        },
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
        decision: {
          marketId: "KXTEST-2",
          side: "no",
          confidence: 0.78,
          executionScore: 0.81,
          expectedValue: 0.14,
          limitPrice: 0.39,
          quantity: 5,
          availableCapital: 63.59,
          maxBudget: 5,
          orderExposure: 3.05,
          maxLossOnTrade: 3.05,
          reasoning: "Cross-market dislocation remains attractive.",
          blockedBy: null,
        },
      },
    });

    expect(summary.title).toContain("placed a live order");
    expect(summary.body).toContain("Executed KXTEST-2");
    expect(summary.tone).toBe("text-emerald-300");
  });

  it("summarizes the latest candidate decision with guardrail context", () => {
    const summary = getAutonomyDecisionSummary({
      ...baseActivity,
      lastRun: {
        eventType: "scheduled_autonomy_run_generated_only",
        status: "generated_only",
        createdAt: new Date("2026-04-24T13:00:00.000Z"),
        reason: "approval-required mode never auto-submits away-from-chat orders",
        signalsGenerated: 2,
        executionCandidates: 1,
        candidateMarketId: "KXTEST-9",
        executedMarketId: null,
        autonomyMode: "approval_required",
        executionCadence: "continuous_watch",
        decision: {
          marketId: "KXTEST-9",
          side: "yes",
          confidence: 0.83,
          executionScore: 0.84,
          expectedValue: 0.18,
          limitPrice: 0.43,
          quantity: null,
          availableCapital: null,
          maxBudget: null,
          orderExposure: null,
          maxLossOnTrade: null,
          reasoning: "Explicit probability edge",
          blockedBy: "approval_required_mode",
        },
      },
    });

    expect(summary.title).toContain("evaluated KXTEST-9 YES without trading");
    expect(summary.body).toContain("83% confidence");
    expect(summary.body).toContain("84% execution score");
    expect(summary.body).toContain("Approval-required mode held the order for manual review");
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

  it("marks away-from-chat trading as eligible only when the account, arming, and cadence all support scheduled reviews", () => {
    const eligible = getAutonomyReadinessSummary({
      preferences: basePreferences,
      connected: true,
      equity: 63.59,
      lastRunAt: new Date("2026-04-24T14:00:00.000Z"),
    });
    const disarmed = getAutonomyReadinessSummary({
      preferences: { ...basePreferences, liveTradingEnabled: false },
      connected: true,
      equity: 63.59,
      lastRunAt: null,
    });

    expect(eligible.title).toContain("eligible");
    expect(disarmed.title).toContain("disarmed");
  });
});
