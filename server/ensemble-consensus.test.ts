/**
 * Unit tests for the 3-tier ensemble consensus orchestrator.
 *
 * Focus areas:
 *   - Fail-closed when ANTHROPIC_API_KEY is unset on high-stakes signals
 *   - Tier-1 veto passes through without calling Sonnet/Opus
 *   - Low-stakes signals trust Tier-1 without escalation
 *   - High-stakes: Tier-1 ✓ + Sonnet ✓ → APPROVE
 *   - High-stakes: Tier-1 ✓ + Sonnet ✗ (below EV floor) → VETO without Opus
 *   - High-stakes: Tier-1 ✓ + Sonnet ✗ (above EV floor) → Opus tiebreaker
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Inject API key before the ENV module is loaded
vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  process.env.OPUS_ESCALATION_MIN_GROSS_EV = "0.05";
});

const claudeReviewerMocks = vi.hoisted(() => ({
  reviewWithSonnet: vi.fn(),
  reviewWithOpus: vi.fn(),
}));

vi.mock("./_core/claudeReviewer", () => ({
  reviewWithSonnet: claudeReviewerMocks.reviewWithSonnet,
  reviewWithOpus: claudeReviewerMocks.reviewWithOpus,
}));

vi.mock("../db", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { runEnsemble, type EnsembleInput, type Tier1Verdict } from "./_core/ensembleConsensus";

function makeTier1(approved: boolean): Tier1Verdict {
  return {
    approved,
    confidenceAdjustment: 0,
    expectedValueAdjustment: 0,
    impliedProbability: 0.6,
    reasoning: approved ? "looks good" : "too risky",
    firstPassApproved: approved,
    secondPassApproved: approved,
    firstPassEvAdjustment: 0,
    secondPassEvAdjustment: 0,
    costUsd: 0.001,
  };
}

function makeInput(overrides: Partial<EnsembleInput> = {}): EnsembleInput {
  return {
    marketId: "KX-TEST",
    ticker: "KX-TEST",
    category: "weather",
    side: "yes",
    count: 5,
    entryPrice: 0.4,
    grossEvFraction: 0.12,
    confidence: 0.82,
    resolutionPrimary: null,
    resolutionSecondary: null,
    capitalUsd: 500,
    resolutionAtMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
    notionalUsd: 2,
    tier1Verdict: makeTier1(true),
    ...overrides,
  };
}

const approveVerdict = {
  approved: true,
  confidenceAdjustment: 0.02,
  expectedValueAdjustment: 0.01,
  impliedProbability: 0.62,
  reasoning: "solid trade",
  costUsd: 0.015,
  reviewerId: "claude.sonnet-4-6" as const,
};

const vetoVerdict = {
  approved: false,
  confidenceAdjustment: -0.05,
  expectedValueAdjustment: -0.03,
  impliedProbability: 0.55,
  reasoning: "too uncertain",
  costUsd: 0.015,
  reviewerId: "claude.sonnet-4-6" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runEnsemble — Tier-1 veto shortcircuit", () => {
  it("returns approved=false immediately when Tier-1 vetoed, no Sonnet call", async () => {
    const result = await runEnsemble(makeInput({ tier1Verdict: makeTier1(false) }));

    expect(result.approved).toBe(false);
    expect(result.reasoning).toMatch(/Tier-1 veto/);
    expect(claudeReviewerMocks.reviewWithSonnet).not.toHaveBeenCalled();
    expect(claudeReviewerMocks.reviewWithOpus).not.toHaveBeenCalled();
  });
});

describe("runEnsemble — low-stakes path", () => {
  it("trusts Tier-1 without calling Sonnet on a $2 notional trade", async () => {
    // $2 notional on $500 capital = 0.4% — well below high-stakes threshold
    const result = await runEnsemble(makeInput({ notionalUsd: 2, capitalUsd: 500 }));

    expect(result.approved).toBe(true);
    expect(result.reasoning).toMatch(/Low-stakes/i);
    expect(claudeReviewerMocks.reviewWithSonnet).not.toHaveBeenCalled();
  });
});

describe("runEnsemble — fail-closed when ANTHROPIC_API_KEY unset on high-stakes", () => {
  it("vetoes a high-stakes signal when ANTHROPIC_API_KEY is missing (fail closed)", async () => {
    // We need to reload the module with an empty API key. The ENV singleton
    // captures the key at load time, so we temporarily patch ENV directly.
    vi.resetModules();

    // Re-mock after resetModules
    vi.mock("./_core/claudeReviewer", () => ({
      reviewWithSonnet: claudeReviewerMocks.reviewWithSonnet,
      reviewWithOpus: claudeReviewerMocks.reviewWithOpus,
    }));
    vi.mock("../db", () => ({
      logAuditEvent: vi.fn().mockResolvedValue(undefined),
    }));

    // Patch process.env and reimport
    const savedKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "";

    const { ENV } = await import("./_core/env");
    // Temporarily empty the key on the singleton (the in-memory value)
    const originalKey = (ENV as unknown as Record<string, string>).anthropicApiKey;
    (ENV as unknown as Record<string, string>).anthropicApiKey = "";

    const { runEnsemble: runEnsembleReloaded } = await import("./_core/ensembleConsensus");

    // High-stakes: large notional relative to capital
    const result = await runEnsembleReloaded(
      makeInput({ notionalUsd: 100, capitalUsd: 200 }),
    );

    expect(result.approved).toBe(false);
    expect(result.reasoning).toMatch(/ANTHROPIC_API_KEY unset|Configuration error/i);
    expect(claudeReviewerMocks.reviewWithSonnet).not.toHaveBeenCalled();

    // Restore
    (ENV as unknown as Record<string, string>).anthropicApiKey = originalKey;
    process.env.ANTHROPIC_API_KEY = savedKey ?? "";
    vi.resetModules();
  });
});

describe("runEnsemble — high-stakes non-catastrophic", () => {
  // 5% of capital is above the 2% high-stakes threshold but below the 8%
  // catastrophic-bet threshold, so it runs Sonnet once (not dual-pass).
  const HIGH_STAKES_NON_CATASTROPHIC_NOTIONAL = 10; // 10 / 200 = 5%
  const CAPITAL = 200;

  it("approves when Tier-1 ✓ and Sonnet ✓", async () => {
    claudeReviewerMocks.reviewWithSonnet.mockResolvedValue(approveVerdict);

    const result = await runEnsemble(
      makeInput({ notionalUsd: HIGH_STAKES_NON_CATASTROPHIC_NOTIONAL, capitalUsd: CAPITAL }),
    );

    expect(result.approved).toBe(true);
    expect(claudeReviewerMocks.reviewWithSonnet).toHaveBeenCalledTimes(1);
    expect(claudeReviewerMocks.reviewWithOpus).not.toHaveBeenCalled();
  });

  it("vetoes when Sonnet ✗ and gross EV below Opus escalation floor", async () => {
    claudeReviewerMocks.reviewWithSonnet.mockResolvedValue(vetoVerdict);

    // grossEvFraction = 0.03 < default OPUS_ESCALATION_MIN_GROSS_EV (0.05)
    const result = await runEnsemble(
      makeInput({
        notionalUsd: HIGH_STAKES_NON_CATASTROPHIC_NOTIONAL,
        capitalUsd: CAPITAL,
        grossEvFraction: 0.03,
      }),
    );

    expect(result.approved).toBe(false);
    expect(result.reasoning).toMatch(/below.*floor/i);
    expect(claudeReviewerMocks.reviewWithOpus).not.toHaveBeenCalled();
  });

  it("escalates to Opus tiebreaker when Sonnet ✗ and gross EV above floor", async () => {
    claudeReviewerMocks.reviewWithSonnet.mockResolvedValue(vetoVerdict);
    claudeReviewerMocks.reviewWithOpus.mockResolvedValue({
      ...approveVerdict,
      reviewerId: "claude.opus-4-7" as const,
    });

    // grossEvFraction = 0.12 > 0.05 floor → Opus runs as tiebreaker
    const result = await runEnsemble(
      makeInput({ notionalUsd: HIGH_STAKES_NON_CATASTROPHIC_NOTIONAL, capitalUsd: CAPITAL }),
    );

    expect(claudeReviewerMocks.reviewWithOpus).toHaveBeenCalledTimes(1);
    expect(result.approved).toBe(true);
    expect(result.reasoning).toMatch(/Tiebreaker/i);
  });

  it("respects Opus veto in tiebreaker", async () => {
    claudeReviewerMocks.reviewWithSonnet.mockResolvedValue(vetoVerdict);
    claudeReviewerMocks.reviewWithOpus.mockResolvedValue({
      ...vetoVerdict,
      reviewerId: "claude.opus-4-7" as const,
    });

    const result = await runEnsemble(
      makeInput({ notionalUsd: HIGH_STAKES_NON_CATASTROPHIC_NOTIONAL, capitalUsd: CAPITAL }),
    );

    expect(result.approved).toBe(false);
    expect(result.reasoning).toMatch(/Tiebreaker.*VETO/i);
  });
});
