import { describe, expect, it } from "vitest";
import { getFastActionItems, getFirstTestReadiness, getLandingBadge, getVisibleCapital } from "../client/src/lib/dashboardLanding";

describe("dashboard landing production-readiness states", () => {
  it("surfaces connected-account sync failures without showing stale capital", () => {
    expect(
      getLandingBadge({ connected: true, currentBalance: 73.59, liveFeedCount: 1, maxDrawdown: 0.01, syncIssue: true })
    ).toEqual({
      label: "Account linked, live sync needs attention",
      tone: "warning",
    });

    expect(
      getFirstTestReadiness({ connected: true, currentBalance: 73.59, liveFeedCount: 1, maxDrawdown: 0.01, syncIssue: true })
    ).toEqual({
      connectionLabel: "Sync issue",
      drawdownUsageLabel: "1.0%",
      microstructureLabel: "1",
      needsFundingReview: false,
      needsSyncReview: true,
    });

    expect(getVisibleCapital({ connected: true, currentBalance: 73.59, syncIssue: true })).toBe(0);
  });

  it("keeps the fast-action flow aligned with the explicit autonomy workflow", () => {
    expect(getFastActionItems().map((item) => item.href)).toEqual([
      "/connect",
      "/autonomy",
      "/risk-controls",
      "/analytics",
    ]);
  });
});
