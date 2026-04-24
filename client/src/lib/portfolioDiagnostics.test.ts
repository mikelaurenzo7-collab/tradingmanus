import { describe, expect, it } from "vitest";
import {
  buildSelectedPositionMap,
  getSignalKey,
  splitSignalsBySelection,
  summarizePortfolioDeployment,
} from "./portfolioDiagnostics";

const signals = [
  { marketId: "FED_CUT_JUN", side: "yes", confidence: 0.62, expectedValue: 0.18 },
  { marketId: "BTC_ABOVE_90K", side: "yes", confidence: 0.54, expectedValue: 0.22 },
  { marketId: "TESLA_DELIVERY_BEAT", side: "no", confidence: 0.57, expectedValue: 0.11 },
];

const portfolio = {
  positions: [
    {
      marketId: "FED_CUT_JUN",
      side: "yes",
      size: 125,
      expectedReturn: 0.12,
      risk: 0.03,
    },
    {
      marketId: "TESLA_DELIVERY_BEAT",
      side: "no",
      size: 100,
      expectedReturn: 0.08,
      risk: 0.04,
    },
  ],
  expectedReturn: 0.2,
  portfolioRisk: 0.05,
  diversificationScore: 0.62,
  kellyFraction: 0.09,
};

describe("portfolioDiagnostics", () => {
  it("builds stable signal keys and maps selected positions by market-side pair", () => {
    const selected = buildSelectedPositionMap(portfolio);

    expect(getSignalKey(signals[0])).toBe("FED_CUT_JUN:yes");
    expect(selected.get("FED_CUT_JUN:yes")?.size).toBe(125);
    expect(selected.get("BTC_ABOVE_90K:yes")).toBeUndefined();
  });

  it("summarizes deployment metrics from the optimized portfolio", () => {
    expect(summarizePortfolioDeployment(500, portfolio)).toEqual({
      capitalAllocated: 225,
      allocationRatio: 0.45,
      remainingCash: 275,
      selectedCount: 2,
    });
  });

  it("splits the signal universe into selected and excluded buckets for UI diagnostics", () => {
    const split = splitSignalsBySelection(signals, portfolio);

    expect(split.selected).toHaveLength(2);
    expect(split.excluded).toHaveLength(1);
    expect(split.excluded[0].marketId).toBe("BTC_ABOVE_90K");
  });
});
