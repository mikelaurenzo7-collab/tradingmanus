import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reviewSignalWithOpenRouterKalshiTeam: vi.fn(),
  runOpenRouterTriage: vi.fn(),
}));

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "sk-or-test-key";
  process.env.OPENROUTER_TRIAGE_ENABLED = "true";
});

vi.mock("../db", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./_core/openRouterKalshiTeam", () => ({
  reviewSignalWithOpenRouterKalshiTeam:
    mocks.reviewSignalWithOpenRouterKalshiTeam,
}));

vi.mock("./_core/openRouterTriage", () => ({
  isOpenRouterTriageConfigured: () => true,
  runOpenRouterTriage: mocks.runOpenRouterTriage,
}));

import { reviewSignalsWithTrader } from "./_core/tradingReviewer";

const markets = [
  {
    id: "TEST-1",
    ticker: "TEST-1",
    title: "Will outcome X happen?",
    description: "Test market 1.",
    category: "weather",
    status: "open" as const,
    yesPrice: 0.4,
    noPrice: 0.6,
    impliedProbability: 0.4,
    yesVolume: 1000,
    noVolume: 1000,
    resolutionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "TEST-2",
    ticker: "TEST-2",
    title: "Will outcome Y happen?",
    description: "Test market 2.",
    category: "sports",
    status: "open" as const,
    yesPrice: 0.43,
    noPrice: 0.57,
    impliedProbability: 0.43,
    yesVolume: 1500,
    noVolume: 1500,
    resolutionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

const signals = [
  {
    marketId: "TEST-1",
    signalType: "value_play" as const,
    side: "yes" as const,
    confidence: 0.7,
    marketPrice: 0.4,
    impliedProbability: 0.4,
    expectedValue: 0.18,
    reasoning: "signal one",
    metadata: { spreadProxy: 0.02 },
  },
  {
    marketId: "TEST-2",
    signalType: "momentum" as const,
    side: "yes" as const,
    confidence: 0.72,
    marketPrice: 0.43,
    impliedProbability: 0.43,
    expectedValue: 0.2,
    reasoning: "signal two",
    metadata: { spreadProxy: 0.02 },
  },
];

function makeTeamReview(marketId: string, impliedProbability: number) {
  return {
    approved: true,
    confidenceAdjustment: 0.08,
    expectedValueAdjustment: 0.04,
    impliedProbability,
    reasoning: `Approved ${marketId}`,
    researcher: {
      summary: `Researcher summary for ${marketId}`,
      estimatedYesProbability: impliedProbability * 100,
      confidence: 0.7,
      catalysts: [],
      risks: [],
      ambiguityFlag: false,
    },
    quant: {
      approved: true,
      side: "yes" as const,
      sideWinProbability: impliedProbability,
      marketPrice: 0.4,
      edgeFraction: 0.2,
      roiFraction: 0.4,
      confidenceAdjustment: 0.08,
      expectedValueAdjustment: 0.04,
      reasoning: `Quant approved ${marketId}`,
      ambiguityFlag: false,
    },
    executionPrototype: {
      ticker: marketId,
      action: "buy" as const,
      side: "yes" as const,
      count: 1,
      type: "limit" as const,
      time_in_force: "good_till_cancelled" as const,
      yes_price: 40,
    },
  };
}

describe("trading reviewer triage flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runOpenRouterTriage.mockResolvedValue(new Set(["TEST-1", "TEST-2"]));
    mocks.reviewSignalWithOpenRouterKalshiTeam.mockImplementation(
      async (market: { id: string }) =>
        makeTeamReview(market.id, market.id === "TEST-1" ? 0.74 : 0.76),
    );
  });

  it("keeps only triaged market IDs when the batch exceeds the threshold", async () => {
    mocks.runOpenRouterTriage.mockResolvedValueOnce(new Set(["TEST-2"]));

    const result = await reviewSignalsWithTrader(
      { markets, signals },
      { skipInTest: false, triageThresholdOverride: 0 },
    );

    expect(mocks.runOpenRouterTriage).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].marketId).toBe("TEST-2");
  });

  it("falls back to the original batch when triage drops everything", async () => {
    mocks.runOpenRouterTriage.mockResolvedValueOnce(new Set());

    const result = await reviewSignalsWithTrader(
      { markets, signals },
      { skipInTest: false, triageThresholdOverride: 0 },
    );

    expect(result.map((signal) => signal.marketId)).toEqual(["TEST-1", "TEST-2"]);
    expect(mocks.reviewSignalWithOpenRouterKalshiTeam).toHaveBeenCalledTimes(2);
  });

  it("skips triage when the batch does not exceed the threshold", async () => {
    const result = await reviewSignalsWithTrader(
      { markets: [markets[0]], signals: [signals[0]] },
      { skipInTest: false, triageThresholdOverride: 1 },
    );

    expect(mocks.runOpenRouterTriage).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].marketId).toBe("TEST-1");
  });

  it("drops signals whose market context is missing before team review", async () => {
    const result = await reviewSignalsWithTrader(
      {
        markets: [markets[0]],
        signals: [signals[0], { ...signals[1], marketId: "MISSING" }],
      },
      { skipInTest: false, triageThresholdOverride: 999 },
    );

    expect(result.map((signal) => signal.marketId)).toEqual(["TEST-1"]);
    expect(mocks.reviewSignalWithOpenRouterKalshiTeam).toHaveBeenCalledTimes(1);
  });
});
