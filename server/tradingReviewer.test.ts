/**
 * Phase 1 acceptance test for the Claude-only trading reviewer.
 *
 * Mocks the Anthropic client so no network calls fire. Verifies:
 *   1. High-EV / high-confidence input → at least one signal survives.
 *   2. Reviewer veto → signal dropped.
 *   3. The `isTradingReviewerConfigured` gate matches `ANTHROPIC_API_KEY`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// vi.hoisted runs BEFORE any import (including the env.ts module-load that
// snapshots ANTHROPIC_API_KEY into ENV). A plain top-level assignment runs
// AFTER ESM hoists imports, so it's too late.
vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
});

// Stub @anthropic-ai/sdk before any imports that touch it. Phase 1's
// reviewer no longer has a Grok fallback, so the SDK is the only path.
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class {
      messages = {
        create: vi.fn(),
      };
    },
  };
});

vi.mock("../db", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db.desk-memory", () => ({
  formatDeskMemoryForPrompt: () => null,
  getDeskMemoryBatch: vi.fn().mockResolvedValue(new Map()),
}));

import {
  reviewSignalsWithTrader,
  isTradingReviewerConfigured,
} from "./_core/tradingReviewer";

const baseMarket = {
  id: "TEST-1",
  ticker: "TEST-1",
  title: "Will outcome X happen?",
  description: "Test fixture market for the Phase 1 reviewer test.",
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
  // Use 0.75 to match the hardcoded SELF_CONSISTENCY_UPPER bound in
  // `server/_core/tradingReviewer.ts` so self-consistency tests behave
  // deterministically without relying on an environment override.
  confidence: 0.75,
  marketPrice: 0.4,
  impliedProbability: 0.4,
  expectedValue: 0.12,
  reasoning: "fundamental prior 55% vs 40% market",
  metadata: {
    fundamentalSource: "explicit" as const,
    fundamentalProbability: 0.55,
    marketCategory: "weather" as const,
    liquidityScore: 0.8,
    spreadProxy: 0.02,
    totalVolume: 5000,
  },
};

function buildAnthropicClient(reviews: Array<{
  marketId: string;
  approved: boolean;
  confidenceAdjustment?: number;
  expectedValueAdjustment?: number;
  reasoning?: string;
}>) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify({ reviews }) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  };
}

describe("Phase 1 trading reviewer (Claude-only)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("isTradingReviewerConfigured is true when ANTHROPIC_API_KEY is set", () => {
    expect(isTradingReviewerConfigured()).toBe(true);
  });

  it("approves a high-EV high-confidence signal", async () => {
    const anthropicClient = buildAnthropicClient([
      {
        marketId: "TEST-1",
        approved: true,
        confidenceAdjustment: 0.0,
        expectedValueAdjustment: 0.0,
        reasoning: "ok",
      },
    ]);
    const result = await reviewSignalsWithTrader(
      { markets: [baseMarket], signals: [baseSignal] },
      { anthropicClient, skipInTest: false },
    );
    expect(result.length).toBe(1);
    expect(result[0].marketId).toBe("TEST-1");
  });

  it("drops a vetoed signal", async () => {
    const anthropicClient = buildAnthropicClient([
      {
        marketId: "TEST-1",
        approved: false,
        reasoning: "thin liquidity",
      },
    ]);
    const result = await reviewSignalsWithTrader(
      { markets: [baseMarket], signals: [baseSignal] },
      { anthropicClient, skipInTest: false },
    );
    expect(result.length).toBe(0);
  });

  it("drops a signal whose post-adjustment confidence falls below the floor", async () => {
    // -0.25 adjustment on 0.8 → 0.55, well below MIN_CONFIDENCE_AFTER_ADJUST 0.76
    const anthropicClient = buildAnthropicClient([
      {
        marketId: "TEST-1",
        approved: true,
        confidenceAdjustment: -0.25,
        expectedValueAdjustment: 0.0,
        reasoning: "ok but low conviction",
      },
    ]);
    const result = await reviewSignalsWithTrader(
      { markets: [baseMarket], signals: [baseSignal] },
      { anthropicClient, skipInTest: false },
    );
    expect(result.length).toBe(0);
  });

  it("drops a signal whose post-adjustment EV falls below the net-EV floor", async () => {
    // -0.10 adjustment on 0.12 → 0.02 EV per payout face. After ROI conversion
    // (entry 0.4) ≈ 5%; minus fees + AI cost it falls below MIN_NET_EV 0.05.
    const anthropicClient = buildAnthropicClient([
      {
        marketId: "TEST-1",
        approved: true,
        confidenceAdjustment: 0.0,
        expectedValueAdjustment: -0.1,
        reasoning: "EV thinner than priced",
      },
    ]);
    const result = await reviewSignalsWithTrader(
      { markets: [baseMarket], signals: [baseSignal] },
      { anthropicClient, skipInTest: false },
    );
    // Either guardrail rejection or post-fee gate drops this; both are valid.
    expect(result.length).toBe(0);
  });

  it("never makes a network call (mock-only)", async () => {
    const anthropicClient = buildAnthropicClient([
      { marketId: "TEST-1", approved: true, reasoning: "" },
    ]);
    await reviewSignalsWithTrader(
      { markets: [baseMarket], signals: [baseSignal] },
      { anthropicClient, skipInTest: false },
    );
    // Phase 1.5: bulk-Haiku self-consistency runs the prompt twice (temp=0.2
    // and temp=0.7) and intersects the verdicts. Both calls go through the
    // mocked client; no real network use.
    expect(anthropicClient.messages.create).toHaveBeenCalledTimes(2);
  });
});
