import { describe, expect, it } from "vitest";
import { getFastActionItems, getFirstTestReadiness, getLandingBadge, getVisibleCapital } from "./dashboardLanding";

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
      needsSyncReview: false,
    });
  });

  it("marks connected unfunded accounts as needing funding review", () => {
    expect(getLandingBadge({ connected: true, currentBalance: 0, liveFeedCount: 3, maxDrawdown: 0.04 })).toEqual({
      label: "Account connected, funding review needed",
      tone: "funding",
    });

    expect(getFirstTestReadiness({ connected: true, currentBalance: 0, liveFeedCount: 3, maxDrawdown: 0.04 })).toEqual({
      connectionLabel: "Ready",
      drawdownUsageLabel: "4.0%",
      microstructureLabel: "3",
      needsFundingReview: true,
      needsSyncReview: false,
    });
  });

  it("surfaces linked-account sync issues separately from connection and funding states", () => {
    expect(
      getLandingBadge({ connected: true, currentBalance: 250, liveFeedCount: 2, maxDrawdown: 0.01, syncIssue: true })
    ).toEqual({
      label: "Account linked, live sync needs attention",
      tone: "warning",
    });

    expect(
      getFirstTestReadiness({ connected: true, currentBalance: 250, liveFeedCount: 2, maxDrawdown: 0.01, syncIssue: true })
    ).toEqual({
      connectionLabel: "Sync issue",
      drawdownUsageLabel: "1.0%",
      microstructureLabel: "2",
      needsFundingReview: false,
      needsSyncReview: true,
    });
  });

  it("hides stale capital when the account is not currently connected or the live sync is unhealthy", () => {
    expect(getVisibleCapital({ connected: false, currentBalance: 100, syncIssue: false })).toBe(0);
    expect(getVisibleCapital({ connected: true, currentBalance: 100, syncIssue: true })).toBe(0);
    expect(getVisibleCapital({ connected: true, currentBalance: 100, syncIssue: false })).toBe(100);
  });

  it("returns the fast-action links for the first live-test workflow", () => {
    const items = getFastActionItems();
    expect(items).toHaveLength(4);
    expect(items.map((item) => item.href)).toEqual(["/connect", "/autonomy", "/risk-controls", "/analytics"]);
  });
});
