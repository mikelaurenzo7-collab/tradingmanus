import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  createOpenRouterClient: vi.fn(),
  reviewWithGrok: vi.fn(),
}));

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.GROK_REVIEWER_ENABLED = "true";
  process.env.XAI_API_KEY = "xai-test";
  process.env.GROK_WEATHER_MAX_HOURS = "72";
  process.env.GROK_SPORTS_MAX_HOURS = "24";
  process.env.GROK_ECONOMICS_MAX_HOURS = "12";
  process.env.GROK_MIN_SIDE_PROBABILITY = "0.75";
  process.env.GROK_MIN_EDGE_FRACTION = "0.10";
  process.env.GROK_MIN_ROI_FRACTION = "0.18";
  process.env.GROK_MIN_CONFIDENCE = "0.70";
});

vi.mock("./_core/openRouterClient", () => ({
  createOpenRouterClient: mocks.createOpenRouterClient,
}));

vi.mock("./_core/grokReviewer", async () => {
  const actual = await vi.importActual<typeof import("./_core/grokReviewer")>(
    "./_core/grokReviewer",
  );
  return {
    ...actual,
    reviewWithGrok: mocks.reviewWithGrok,
  };
});

import { ENV } from "./_core/env";
import { reviewSignalWithOpenRouterKalshiTeam } from "./_core/openRouterKalshiTeam";

const market = {
  id: "WX-TEST",
  ticker: "WX-TEST",
  title: "Will a hurricane make landfall this week?",
  description: "Resolves YES if an NHC-designated hurricane makes landfall.",
  category: "weather",
  status: "open" as const,
  yesPrice: 0.4,
  noPrice: 0.6,
  impliedProbability: 0.4,
  yesVolume: 1500,
  noVolume: 1500,
  resolutionDate: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
};

const signal = {
  marketId: "WX-TEST",
  signalType: "value_play" as const,
  side: "yes" as const,
  confidence: 0.78,
  marketPrice: 0.4,
  impliedProbability: 0.4,
  expectedValue: 0.2,
  reasoning: "NOAA ensemble still above the market.",
  metadata: { spreadProxy: 0.02 },
};

function makeChatResult(content: string, model = "or-test-model") {
  return {
    content,
    model,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createOpenRouterClient.mockReturnValue({ chat: mocks.chat });
  mocks.reviewWithGrok.mockResolvedValue({
    reviewerId: "grok-4-latest",
    approved: true,
    confidenceAdjustment: 0.03,
    expectedValueAdjustment: 0.02,
    impliedProbability: 0.82,
    reasoning: "Grok confirmed the fresh weather edge.",
    ambiguityFlag: false,
    toolCallsSummary: "NOAA + order book",
    costUsd: 0.01,
    tokensIn: 10,
    tokensOut: 5,
    latencyMs: 40,
    toolCallsMade: [],
  });
  (ENV as { grokReviewerEnabled: boolean }).grokReviewerEnabled = true;
  (ENV as { xaiApiKey: string }).xaiApiKey = "xai-test";
  (ENV as { grokWeatherMaxHours: number }).grokWeatherMaxHours = 72;
  (ENV as { grokSportsMaxHours: number }).grokSportsMaxHours = 24;
  (ENV as { grokEconomicsMaxHours: number }).grokEconomicsMaxHours = 12;
  (ENV as { grokMinSideProbability: number }).grokMinSideProbability = 0.75;
  (ENV as { grokMinEdgeFraction: number }).grokMinEdgeFraction = 0.1;
  (ENV as { grokMinRoiFraction: number }).grokMinRoiFraction = 0.18;
  (ENV as { grokMinConfidence: number }).grokMinConfidence = 0.7;
});

describe("reviewSignalWithOpenRouterKalshiTeam — Grok routing", () => {
  it("escalates to Grok only when the shared thresholds are met and passes ROI", async () => {
    mocks.chat
      .mockResolvedValueOnce(makeChatResult(JSON.stringify({
        summary: "NOAA keeps the hurricane path live.",
        estimatedYesProbability: 80,
        confidence: 0.8,
        catalysts: ["NHC path shifted west"],
        risks: ["late weakening"],
        ambiguityFlag: false,
      })))
      .mockResolvedValueOnce(makeChatResult(JSON.stringify({
        approved: true,
        reasoning: "Quant sees a durable weather edge.",
        confidenceAdjustment: 0.05,
        expectedValueAdjustment: 0.04,
        ambiguityFlag: false,
      })));

    const result = await reviewSignalWithOpenRouterKalshiTeam(market, signal);

    expect(mocks.reviewWithGrok).toHaveBeenCalledTimes(1);
    expect(mocks.reviewWithGrok).toHaveBeenCalledWith(
      expect.objectContaining({
        marketId: "WX-TEST",
        roiFraction: 1,
        entryPrice: 0.4,
        confidence: 0.78,
      }),
    );
    expect(result.approved).toBe(true);
    expect(result.grokReasoning).toMatch(/fresh weather edge/i);
  });

  it("stays on the OpenRouter quant result when the Grok thresholds are not met", async () => {
    mocks.chat
      .mockResolvedValueOnce(makeChatResult(JSON.stringify({
        summary: "Weather edge exists but is not strong enough for Grok.",
        estimatedYesProbability: 70,
        confidence: 0.72,
        catalysts: [],
        risks: [],
        ambiguityFlag: false,
      })))
      .mockResolvedValueOnce(makeChatResult(JSON.stringify({
        approved: true,
        reasoning: "Quant still clears the true-winner floor.",
        confidenceAdjustment: 0.02,
        expectedValueAdjustment: 0.01,
        ambiguityFlag: false,
      })));

    const result = await reviewSignalWithOpenRouterKalshiTeam(market, signal);

    expect(mocks.reviewWithGrok).not.toHaveBeenCalled();
    expect(result.approved).toBe(true);
    expect(result.grokReasoning).toBeUndefined();
  });

  it("fails closed when Grok escalation throws", async () => {
    mocks.chat
      .mockResolvedValueOnce(makeChatResult(JSON.stringify({
        summary: "NOAA keeps the hurricane path live.",
        estimatedYesProbability: 80,
        confidence: 0.8,
        catalysts: ["NHC path shifted west"],
        risks: ["late weakening"],
        ambiguityFlag: false,
      })))
      .mockResolvedValueOnce(makeChatResult(JSON.stringify({
        approved: true,
        reasoning: "Quant sees a durable weather edge.",
        confidenceAdjustment: 0.05,
        expectedValueAdjustment: 0.04,
        ambiguityFlag: false,
      })));
    mocks.reviewWithGrok.mockRejectedValueOnce(new Error("grok down"));

    const result = await reviewSignalWithOpenRouterKalshiTeam(market, signal);

    expect(mocks.reviewWithGrok).toHaveBeenCalledTimes(1);
    expect(result.approved).toBe(false);
    expect(result.reasoning).toMatch(/Grok escalation failed/i);
  });
});