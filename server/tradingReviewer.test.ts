import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reviewSignalWithOpenRouterKalshiTeam: vi.fn(),
}));

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "sk-or-test-key";
  process.env.OPENROUTER_TRIAGE_ENABLED = "false";
});

vi.mock("../db", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./_core/openRouterKalshiTeam", () => ({
  reviewSignalWithOpenRouterKalshiTeam:
    mocks.reviewSignalWithOpenRouterKalshiTeam,
}));

import {
  isTradingReviewerConfigured,
  reviewSignalsWithTrader,
} from "./_core/tradingReviewer";

const baseMarket = {
  id: "TEST-1",
  ticker: "TEST-1",
  title: "Will outcome X happen?",
  description: "True-winner reviewer test market.",
  category: "weather",
  status: "open" as const,
  yesPrice: 0.4,
  noPrice: 0.6,
  impliedProbability: 0.4,
  yesVolume: 1000,
  noVolume: 1000,
  resolutionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
};

const baseSignal = {
  marketId: "TEST-1",
  signalType: "value_play" as const,
  side: "yes" as const,
  confidence: 0.68,
  marketPrice: 0.4,
  impliedProbability: 0.4,
  expectedValue: 0.18,
  reasoning: "fundamental prior 58% vs 40% market",
  metadata: {
    fundamentalSource: "explicit" as const,
    fundamentalProbability: 0.58,
    marketCategory: "weather" as const,
    liquidityScore: 0.8,
    spreadProxy: 0.02,
    totalVolume: 5000,
  },
};

function makeTeamReview(overrides: Partial<Awaited<ReturnType<typeof mocks.reviewSignalWithOpenRouterKalshiTeam>>> = {}) {
  return {
    approved: true,
    confidenceAdjustment: 0.08,
    expectedValueAdjustment: 0.04,
    impliedProbability: 0.78,
    reasoning: "Research + quant agree this is a true-winner setup.",
    researcher: {
      summary: "Researcher found a durable probability edge.",
      estimatedYesProbability: 78,
      confidence: 0.72,
      catalysts: ["supportive catalyst"],
      risks: ["headline reversal"],
      ambiguityFlag: false,
    },
    quant: {
      approved: true,
      side: "yes" as const,
      sideWinProbability: 0.78,
      marketPrice: 0.4,
      edgeFraction: 0.38,
      roiFraction: 0.95,
      confidenceAdjustment: 0.08,
      expectedValueAdjustment: 0.04,
      reasoning: "Quant cleared the true-winner thresholds.",
      ambiguityFlag: false,
    },
    executionPrototype: {
      ticker: "TEST-1",
      action: "buy" as const,
      side: "yes" as const,
      count: 1,
      type: "limit" as const,
      time_in_force: "good_till_cancelled" as const,
      yes_price: 40,
    },
    ...overrides,
  };
}

describe("trading reviewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reviewSignalWithOpenRouterKalshiTeam.mockResolvedValue(
      makeTeamReview(),
    );
  });

  it("is configured when OPENROUTER_API_KEY is set", () => {
    expect(isTradingReviewerConfigured()).toBe(true);
  });

  it("treats an injected client as configured even with an empty override key", () => {
    expect(
      isTradingReviewerConfigured({
        openRouterApiKey: "",
        client: { chat: vi.fn() },
      }),
    ).toBe(true);
  });

  it("approves a true-winner signal when the OpenRouter team approves it", async () => {
    const result = await reviewSignalsWithTrader(
      { markets: [baseMarket], signals: [baseSignal] },
      { skipInTest: false, triageThresholdOverride: 999 },
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      marketId: "TEST-1",
      confidence: 0.76,
      impliedProbability: 0.78,
    });
    expect(result[0].reasoning).toContain("Kalshi beasts");
  });

  it("drops a signal when the OpenRouter team vetoes it", async () => {
    mocks.reviewSignalWithOpenRouterKalshiTeam.mockResolvedValueOnce(
      makeTeamReview({
        approved: false,
        confidenceAdjustment: 0,
        expectedValueAdjustment: 0,
        reasoning: "Quant rejected the edge as too weak.",
      }),
    );

    const result = await reviewSignalsWithTrader(
      { markets: [baseMarket], signals: [baseSignal] },
      { skipInTest: false, triageThresholdOverride: 999 },
    );

    expect(result).toHaveLength(0);
  });

  it("drops a signal whose post-review confidence falls below the floor", async () => {
    mocks.reviewSignalWithOpenRouterKalshiTeam.mockResolvedValueOnce(
      makeTeamReview({
        confidenceAdjustment: -0.25,
        expectedValueAdjustment: 0,
        impliedProbability: 0.58,
      }),
    );

    const result = await reviewSignalsWithTrader(
      { markets: [baseMarket], signals: [baseSignal] },
      { skipInTest: false, triageThresholdOverride: 999 },
    );

    expect(result).toHaveLength(0);
  });

  it("drops a signal whose post-review EV fails the profit guardrails", async () => {
    mocks.reviewSignalWithOpenRouterKalshiTeam.mockResolvedValueOnce(
      makeTeamReview({
        confidenceAdjustment: 0.08,
        expectedValueAdjustment: -0.17,
        impliedProbability: 0.66,
      }),
    );

    const result = await reviewSignalsWithTrader(
      { markets: [baseMarket], signals: [baseSignal] },
      { skipInTest: false, triageThresholdOverride: 999 },
    );

    expect(result).toHaveLength(0);
  });

  it("passes an injected OpenRouter client through to the team reviewer", async () => {
    const client = { chat: vi.fn() };

    await reviewSignalsWithTrader(
      { markets: [baseMarket], signals: [baseSignal] },
      { client, skipInTest: false, triageThresholdOverride: 999 },
    );

    expect(mocks.reviewSignalWithOpenRouterKalshiTeam).toHaveBeenCalledWith(
      baseMarket,
      baseSignal,
      expect.objectContaining({ client }),
    );
  });
});
