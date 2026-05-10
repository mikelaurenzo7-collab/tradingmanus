import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  createOpenRouterClient: vi.fn(),
  recordAiCallCost: vi.fn(),
}));

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.CLAUDE_SONNET_MODEL = "anthropic/claude-sonnet-test";
  process.env.CLAUDE_OPUS_MODEL = "anthropic/claude-opus-test";
  process.env.CLAUDE_SONNET_TIMEOUT_MS = "21000";
  process.env.CLAUDE_OPUS_TIMEOUT_MS = "47000";
});

vi.mock("./_core/openRouterClient", () => ({
  createOpenRouterClient: mocks.createOpenRouterClient,
}));

vi.mock("./_core/aiCostBudget", () => ({
  recordAiCallCost: mocks.recordAiCallCost,
}));

vi.mock("../db", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { reviewWithOpus, reviewWithSonnet } from "./_core/claudeReviewer";

const baseInput = {
  marketId: "KX-TEST",
  ticker: "KX-TEST",
  category: "sports" as const,
  side: "yes" as const,
  count: 5,
  entryPrice: 0.4,
  grossEvFraction: 0.12,
  confidence: 0.78,
  resolutionPrimary: "Official market rules",
  resolutionSecondary: null,
  notionalUsd: 2,
  priorVerdict: {
    approved: true,
    impliedProbability: 0.6,
    confidenceAdjustment: 0,
    expectedValueAdjustment: 0,
    reasoning: "tier-1 approved",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createOpenRouterClient.mockReturnValue({
    chat: mocks.chat,
  });
  mocks.recordAiCallCost.mockReturnValue(0.015);
  mocks.chat.mockResolvedValue({
    content: JSON.stringify({
      approved: true,
      confidenceAdjustment: 0.02,
      expectedValueAdjustment: 0.01,
      impliedProbability: 0.63,
      reasoning: "deep review approved",
      ambiguityFlag: false,
    }),
    model: "resolved-model",
    inputTokens: 12,
    outputTokens: 8,
    totalTokens: 20,
  });
});

describe("claude deep reviewers", () => {
  it("routes Sonnet reviews through the configured Sonnet model", async () => {
    const verdict = await reviewWithSonnet(baseInput);

    expect(mocks.createOpenRouterClient).toHaveBeenCalledWith({
      apiKey: "sk-or-test",
      logger: expect.any(Object),
    });
    expect(mocks.chat).toHaveBeenCalledWith(expect.objectContaining({
      model: "anthropic/claude-sonnet-test",
      timeoutMs: 21000,
    }));
    expect(verdict.reviewerId).toBe("claude.sonnet-4-6");
  });

  it("routes Opus reviews through the configured Opus model", async () => {
    const verdict = await reviewWithOpus(baseInput);

    expect(mocks.chat).toHaveBeenCalledWith(expect.objectContaining({
      model: "anthropic/claude-opus-test",
      timeoutMs: 47000,
    }));
    expect(verdict.reviewerId).toBe("claude.opus-4-7");
  });
});