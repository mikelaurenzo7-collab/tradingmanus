import { describe, expect, it } from "vitest";
import {
  getAutonomyModeDescription,
  getAutonomyStatusSummary,
  getExecutionCadenceLabel,
  type TradingPreferences,
} from "../client/src/lib/tradingAutonomy";

describe("trading autonomy copy truthfulness", () => {
  const armedFullyAutonomous: TradingPreferences = {
    autonomyMode: "fully_autonomous",
    liveTradingEnabled: true,
    executionCadence: "continuous_watch",
    riskPosture: "balanced",
    minSignalConfidence: 0.72,
    maxOrderNotional: 10,
    maxDailyOrders: 3,
    requireApprovalAbove: 8,
  };

  it("makes clear that full autonomy alone does not start a background trade-search worker", () => {
    expect(getAutonomyModeDescription("fully_autonomous")).toContain(
      "does not start a background trade-search worker"
    );

    expect(getAutonomyStatusSummary(armedFullyAutonomous).body).toContain(
      "does not keep searching for trades in the background while you are away"
    );
  });

  it("labels continuous_watch as a policy label rather than a guaranteed running watcher", () => {
    expect(getExecutionCadenceLabel("continuous_watch")).toBe("Continuous review policy");
    expect(getExecutionCadenceLabel("hourly_watch")).toBe("Hourly review policy");
  });
});
