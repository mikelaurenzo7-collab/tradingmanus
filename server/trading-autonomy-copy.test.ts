import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getAutonomyModeDescription,
  getAutonomyStatusSummary,
  getExecutionCadenceLabel,
  type TradingPreferences,
} from "../client/src/lib/tradingAutonomy";

describe("trading autonomy copy truthfulness", () => {
  const tradingAutonomyPageSource = readFileSync(
    resolve(process.cwd(), "client/src/pages/TradingAutonomy.tsx"),
    "utf8"
  );
  const startTradingDialogSource = readFileSync(
    resolve(process.cwd(), "client/src/components/StartTradingDialog.tsx"),
    "utf8"
  );

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

  it("describes direct autonomous trading as an account-driven capability rather than a publish-step or operator task", () => {
    expect(getAutonomyModeDescription("fully_autonomous")).toContain(
      "direct autonomous trading"
    );
    expect(getAutonomyModeDescription("fully_autonomous")).not.toContain(
      "publish"
    );

    expect(getAutonomyStatusSummary(armedFullyAutonomous).body).toContain(
      "Laurenzo can place trades automatically under your saved account guardrails while you are away"
    );
    expect(getAutonomyStatusSummary(armedFullyAutonomous).body).not.toContain(
      "publish the latest build"
    );
    expect(getAutonomyStatusSummary(armedFullyAutonomous).body).not.toContain(
      "scheduled reviews"
    );
  });

  it("keeps supervised cadences labeled as active-session execution while direct autonomous cadences stay explicitly trade-oriented", () => {
    expect(getAutonomyStatusSummary(armedSessionAssisted).body).toContain(
      "selected cadence keeps execution supervised to active sessions"
    );
    expect(getExecutionCadenceLabel("continuous_watch")).toBe("Continuous autonomous trading");
    expect(getExecutionCadenceLabel("hourly_watch")).toBe("Hourly autonomous trading");
  });

  it("removes review-loop phrasing from the main autonomy UI surfaces", () => {
    expect(tradingAutonomyPageSource).toContain("Latest autonomous trading activity");
    expect(tradingAutonomyPageSource).toContain("Autonomous trading readiness");
    expect(tradingAutonomyPageSource).not.toContain("automatic review");
    expect(tradingAutonomyPageSource).not.toContain("scheduled review");

    expect(startTradingDialogSource).toContain("direct autonomous trading");
    expect(startTradingDialogSource).not.toContain("automatic reviews");
  });
});
