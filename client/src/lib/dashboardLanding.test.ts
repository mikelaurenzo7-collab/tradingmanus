import { describe, expect, it } from "vitest";
import { getFastActionItems, getFirstTestReadiness, getLandingBadge } from "./dashboardLanding";

describe("dashboardLanding", () => {
  it("marks disconnected accounts as needing connection before first live testing", () => {
    expect(getLandingBadge({ connected: false, currentBalance: 0, liveFeedCount: 0, maxDrawdown: 0 })).toEqual({
      label: "Connect account to unlock live telemetry",
      tone: "attention",
    });

    expect(getFirstTestReadiness({ connected: false, currentBalance: 0, liveFeedCount: 0, maxDrawdown: 0.02 })).toEqual({
      connectionLabel: "Pending",
      drawdownUsageLabel: "2.0%",
      microstructureLabel: "0",
      needsFundingReview: false,
    });
  });

  it("marks connected unfunded accounts as needing funding review", () => {
    expect(getLandingBadge({ connected: true, currentBalance: 0, liveFeedCount: 3, maxDrawdown: 0.04 })).toEqual({
      label: "Account telemetry active",
      tone: "connected",
    });

    expect(getFirstTestReadiness({ connected: true, currentBalance: 0, liveFeedCount: 3, maxDrawdown: 0.04 })).toEqual({
      connectionLabel: "Ready",
      drawdownUsageLabel: "4.0%",
      microstructureLabel: "3",
      needsFundingReview: true,
    });
  });

  it("returns the fast-action links for the first live-test workflow", () => {
    const items = getFastActionItems();
    expect(items).toHaveLength(4);
    expect(items.map((item) => item.href)).toEqual(["/connect", "/risk-controls", "/analytics", "/backtest"]);
  });
});
