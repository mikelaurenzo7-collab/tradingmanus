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

  const armedSessionAssisted: TradingPreferences = {
    ...armedFullyAutonomous,
    autonomyMode: "semi_autonomous",
    executionCadence: "session_assisted",
  };

  it("describes away-from-chat reviews as a published scheduled capability rather than an unconditional always-on promise", () => {
    expect(getAutonomyModeDescription("fully_autonomous")).toContain(
      "scheduled away-from-chat reviews once the latest build is published"
    );

    expect(getAutonomyStatusSummary(armedFullyAutonomous).body).toContain(
      "scheduled reviews can keep evaluating markets while you are away"
    );
    expect(getAutonomyStatusSummary(armedFullyAutonomous).body).toContain(
      "publish the latest build"
    );
  });

  it("keeps supervised cadences labeled as active-session execution rather than away-from-chat scanning", () => {
    expect(getAutonomyStatusSummary(armedSessionAssisted).body).toContain(
      "selected cadence keeps execution supervised to active sessions"
    );
    expect(getExecutionCadenceLabel("continuous_watch")).toBe("Continuous review policy");
    expect(getExecutionCadenceLabel("hourly_watch")).toBe("Hourly review policy");
  });
});
