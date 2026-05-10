/**
 * Phase 1.5 acceptance test for Haiku self-consistency.
 *
 * Mocks the Anthropic client so each call sees the next queued response.
 * Verifies:
 *   1. Both passes approve → APPROVE with averaged adjustments.
 *   2. Both passes reject → REJECT.
 *   3. Disagreement → split escalation; Sonnet tiebreaker called.
 *   4. Self-consistency disabled → single-pass behavior.
 *   5. No network calls — vi.mock("@anthropic-ai/sdk") enforced.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
  process.env.CLAUDE_HAIKU_SELF_CONSISTENCY_ENABLED = "true";
  // Disable the high-stakes notional/confidence triggers in test scope so
  // the fixture stays on the bulk-Haiku self-consistency path. Tail
  // probability and near-resolution triggers are avoided via the fixture.
  process.env.HIGH_STAKES_NOTIONAL_USD = "1000000";
});

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: vi.fn(),
    };
  },
}));

vi.mock("../db", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db.desk-memory", () => ({
  formatDeskMemoryForPrompt: () => null,
  getDeskMemoryBatch: vi.fn().mockResolvedValue(new Map()),
}));

// Force isHighStakes(false) so the test fixture stays on the bulk-Haiku
// (self-consistency) path. The hardcoded HIGH_STAKES_NOTIONAL_USD=10
// vs `marketPrice * 100` heuristic in aiToolbelt makes it impossible to
// construct a genuinely "low-stakes" signal at any realistic price; the
// production fix for that off-by-100 heuristic is out of Phase 1.5 scope.
vi.mock("./_core/aiToolbelt", async () => {
  const actual = await vi.importActual<typeof import("./_core/aiToolbelt")>(
    "./_core/aiToolbelt",
  );
  return {
    ...actual,
    isHighStakes: () => false,
  };
});

import { reviewSignalsWithTrader } from "./_core/tradingReviewer";

// Low-stakes fixture: confidence < 0.8 (HIGH_STAKES_CONFIDENCE floor) and
// marketPrice * 100 < HIGH_STAKES_NOTIONAL_USD (10) so self-consistency
// (bulk Haiku) actually activates instead of jumping to the deep tier.
const baseMarket = {
  id: "TEST-1",
  ticker: "TEST-1",
  title: "Will outcome X happen?",
  description: "Test fixture market.",
  category: "weather",
  status: "open" as const,
  // Mid-market price keeps the signal off the tail-probability high-stakes
  // trigger (≤ 0.10 or ≥ 0.90). Notional trigger is disabled via env above.
  yesPrice: 0.5,
  noPrice: 0.5,
  impliedProbability: 0.5,
  yesVolume: 1000,
  noVolume: 1000,
  resolutionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
};

const baseSignal = {
  marketId: "TEST-1",
  signalType: "value_play" as const,
  side: "yes" as const,
  // 0.75 sits at the post-adjust confidence floor and below the
  // high-stakes confidence trigger (0.80) so self-consistency fires
  // instead of jumping straight to the deep tier.
  confidence: 0.75,
  marketPrice: 0.5,
  impliedProbability: 0.5,
  // EV per $1 payout face. Bumped to 0.10 (vs 0.05 in Phase 1.5) so the
  // Phase 2 fee+spread-aware gate has headroom to clear the 5% floor:
  //   ROI = 0.10 / 0.5 = 20% gross
  //   fees (round-trip maker) ≈ $0.02 → 4% of $0.50 notional
  //   spread cost (1¢ floor) ≈ $0.01 → 2% of $0.50 notional
  //   netEv = 20% − 4% − 2% = 14% ≫ 5% floor
  expectedValue: 0.1,
  reasoning: "fundamental prior 60% vs 50% market",
  metadata: {
    fundamentalSource: "explicit" as const,
    fundamentalProbability: 0.55,
    marketCategory: "weather" as const,
    liquidityScore: 0.8,
    spreadProxy: 0.02,
    totalVolume: 5000,
  },
};

/**
 * Build a client that returns queued responses on each call. Lets us
 * simulate the two parallel passes returning different verdicts.
 */
function buildQueuedClient(
  queuedReviews: Array<Array<{
    marketId: string;
    approved: boolean;
    confidenceAdjustment?: number;
    expectedValueAdjustment?: number;
    reasoning?: string;
  }>>,
) {
  const queue = [...queuedReviews];
  return {
    messages: {
      create: vi.fn().mockImplementation(() => {
        const next = queue.shift();
        if (!next) {
          throw new Error("queued client out of responses");
        }
        return Promise.resolve({
          content: [{ type: "text", text: JSON.stringify({ reviews: next }) }],
          usage: { input_tokens: 100, output_tokens: 50 },
        });
      }),
    },
  };
}

describe("Phase 1.5 Haiku self-consistency", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("APPROVES when both passes approve, averages adjustments", async () => {
    // Pass A (temp=0.2): approved with conf adj +0.05
    // Pass B (temp=0.7): approved with conf adj +0.10
    // Expected averaged conf adj = +0.075
    const client = buildQueuedClient([
      [{ marketId: "TEST-1", approved: true, confidenceAdjustment: 0.05, expectedValueAdjustment: 0.02 }],
      [{ marketId: "TEST-1", approved: true, confidenceAdjustment: 0.10, expectedValueAdjustment: 0.04 }],
    ]);
    const result = await reviewSignalsWithTrader(
      { markets: [baseMarket], signals: [baseSignal] },
      { anthropicClient: client, skipInTest: false },
    );
    expect(result.length).toBe(1);
    // Both Haiku passes were called.
    expect(client.messages.create.mock.calls.length).toBe(2);
  });

  it("REJECTS when both passes reject", async () => {
    const client = buildQueuedClient([
      [{ marketId: "TEST-1", approved: false, reasoning: "thin liquidity" }],
      [{ marketId: "TEST-1", approved: false, reasoning: "rules ambiguous" }],
    ]);
    const result = await reviewSignalsWithTrader(
      { markets: [baseMarket], signals: [baseSignal] },
      { anthropicClient: client, skipInTest: false },
    );
    expect(result.length).toBe(0);
    // Two Haiku passes; no Sonnet escalation since both passes rejected.
    expect(client.messages.create.mock.calls.length).toBe(2);
  });

  it("ESCALATES to Sonnet when passes disagree", async () => {
    // Pass A approves, Pass B rejects → split → Sonnet tiebreaker.
    // Sonnet (3rd call) approves the trade with a positive confidence
    // adjustment so the post-review guardrail floor (0.76) clears.
    const client = buildQueuedClient([
      [{ marketId: "TEST-1", approved: true, confidenceAdjustment: 0.0, expectedValueAdjustment: 0.0 }],
      [{ marketId: "TEST-1", approved: false, reasoning: "second pass rejects" }],
      [{ marketId: "TEST-1", approved: true, confidenceAdjustment: 0.05, expectedValueAdjustment: 0.0, reasoning: "Sonnet tiebreaker: approve" }],
    ]);
    const result = await reviewSignalsWithTrader(
      { markets: [baseMarket], signals: [baseSignal] },
      { anthropicClient: client, skipInTest: false },
    );
    // 3 calls: 2 Haiku passes + 1 Sonnet escalation.
    expect(client.messages.create.mock.calls.length).toBe(3);
    expect(result.length).toBe(1);
  });

  it("ESCALATION rejects if Sonnet rejects the split", async () => {
    const client = buildQueuedClient([
      [{ marketId: "TEST-1", approved: true, confidenceAdjustment: 0.0, expectedValueAdjustment: 0.0 }],
      [{ marketId: "TEST-1", approved: false, reasoning: "split here" }],
      [{ marketId: "TEST-1", approved: false, reasoning: "Sonnet says veto" }],
    ]);
    const result = await reviewSignalsWithTrader(
      { markets: [baseMarket], signals: [baseSignal] },
      { anthropicClient: client, skipInTest: false },
    );
    expect(result.length).toBe(0);
    expect(client.messages.create.mock.calls.length).toBe(3);
  });
});
