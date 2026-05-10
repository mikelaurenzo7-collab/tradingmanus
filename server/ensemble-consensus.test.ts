/**
 * Unit tests for the cost-minimized ensemble consensus orchestrator.
 *
 * Focus areas:
 *   - Fail-closed when OPENROUTER_API_KEY is unset on high-stakes signals
 *   - Fail-closed when live capital is unavailable
 *   - Tier-1 veto passes through without calling Tier-2 reviewers
 *   - Low-stakes signals trust Tier-1 without escalation
 *   - High-stakes: Tier-1 ✓ + Sonnet ✓ → APPROVE
 *   - High-stakes: Tier-1 ✓ + Sonnet ✗ → VETO without Opus
 *   - Catastrophic bets still require Tier-2 approval, but do not pay for Opus
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Inject API key before the ENV module is loaded
vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "sk-or-test";
});

const claudeReviewerMocks = vi.hoisted(() => ({
  reviewWithSonnet: vi.fn(),
  reviewWithOpus: vi.fn(),
}));

const grokReviewerMocks = vi.hoisted(() => ({
  reviewWithGrok: vi.fn(),
}));

vi.mock("./_core/claudeReviewer", () => ({
  reviewWithSonnet: claudeReviewerMocks.reviewWithSonnet,
  reviewWithOpus: claudeReviewerMocks.reviewWithOpus,
}));

vi.mock("./_core/grokReviewer", async () => {
  const actual = await vi.importActual<typeof import("./_core/grokReviewer")>(
    "./_core/grokReviewer",
  );
  return {
    ...actual,
    reviewWithGrok: grokReviewerMocks.reviewWithGrok,
  };
});

vi.mock("../db", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { ENV } from "./_core/env";
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

const grokApproveVerdict = {
  reviewerId: "grok-4-latest" as const,
  approved: true,
  confidenceAdjustment: 0.04,
  expectedValueAdjustment: 0.02,
  impliedProbability: 0.81,
  reasoning: "Fresh weather edge confirmed.",
  ambiguityFlag: false,
  toolCallsSummary: "NOAA + order book",
  costUsd: 0.01,
  tokensIn: 12,
  tokensOut: 6,
  latencyMs: 40,
  toolCallsMade: [],
};

const grokVetoVerdict = {
  ...grokApproveVerdict,
  approved: false,
  reasoning: "Fresh data vetoed the signal.",
};

beforeEach(() => {
  vi.clearAllMocks();
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

describe("runEnsemble — fail-closed when OPENROUTER_API_KEY unset on high-stakes", () => {
  it("vetoes a high-stakes signal when OPENROUTER_API_KEY is missing (fail closed)", async () => {
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
    const savedKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "";

    const { ENV } = await import("./_core/env");
    // Temporarily empty the key on the singleton (the in-memory value)
    const originalKey = (ENV as unknown as Record<string, string>).openRouterApiKey;
    (ENV as unknown as Record<string, string>).openRouterApiKey = "";

    const { runEnsemble: runEnsembleReloaded } = await import("./_core/ensembleConsensus");

    // High-stakes: large notional relative to capital
    const result = await runEnsembleReloaded(
      makeInput({ notionalUsd: 100, capitalUsd: 200 }),
    );

    expect(result.approved).toBe(false);
    expect(result.reasoning).toMatch(/OPENROUTER_API_KEY unset|Configuration error/i);
    expect(claudeReviewerMocks.reviewWithSonnet).not.toHaveBeenCalled();

    // Restore
    (ENV as unknown as Record<string, string>).openRouterApiKey = originalKey;
    process.env.OPENROUTER_API_KEY = savedKey ?? "";
    vi.resetModules();
  });
});

describe("runEnsemble — fail-closed when live capital is unavailable", () => {
  it.each([0, Number.NaN])( 
    "vetoes the signal when capitalUsd=%s",
    async (capitalUsd) => {
      const result = await runEnsemble(makeInput({ capitalUsd }));

      expect(result.approved).toBe(false);
      expect(result.reasoning).toMatch(/capital unavailable/i);
      expect(claudeReviewerMocks.reviewWithSonnet).not.toHaveBeenCalled();
      expect(claudeReviewerMocks.reviewWithOpus).not.toHaveBeenCalled();
    },
  );
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

  it("routes urgent high-edge weather trades to Grok instead of Sonnet", async () => {
    grokReviewerMocks.reviewWithGrok.mockResolvedValue(grokApproveVerdict);

    const result = await runEnsemble(
      makeInput({
        notionalUsd: HIGH_STAKES_NON_CATASTROPHIC_NOTIONAL,
        capitalUsd: CAPITAL,
        confidence: 0.82,
        grossEvFraction: 0.25,
        resolutionAtMs: Date.now() + 6 * 60 * 60 * 1000,
        tier1Verdict: {
          ...makeTier1(true),
          impliedProbability: 0.8,
        },
      }),
    );

    expect(grokReviewerMocks.reviewWithGrok).toHaveBeenCalledTimes(1);
    expect(claudeReviewerMocks.reviewWithSonnet).not.toHaveBeenCalled();
    expect(result.approved).toBe(true);
  });

  it("falls back to Sonnet when the shared Grok thresholds are not met", async () => {
    claudeReviewerMocks.reviewWithSonnet.mockResolvedValue(approveVerdict);

    const result = await runEnsemble(
      makeInput({
        notionalUsd: HIGH_STAKES_NON_CATASTROPHIC_NOTIONAL,
        capitalUsd: CAPITAL,
        confidence: 0.82,
        grossEvFraction: 0.25,
        resolutionAtMs: Date.now() + 6 * 60 * 60 * 1000,
        tier1Verdict: {
          ...makeTier1(true),
          impliedProbability: 0.7,
        },
      }),
    );

    expect(grokReviewerMocks.reviewWithGrok).not.toHaveBeenCalled();
    expect(claudeReviewerMocks.reviewWithSonnet).toHaveBeenCalledTimes(1);
    expect(result.approved).toBe(true);
  });

  it("falls back to Sonnet when xAI is unavailable", async () => {
    claudeReviewerMocks.reviewWithSonnet.mockResolvedValue(approveVerdict);
    (ENV as { xaiApiKey: string }).xaiApiKey = "";

    const result = await runEnsemble(
      makeInput({
        notionalUsd: HIGH_STAKES_NON_CATASTROPHIC_NOTIONAL,
        capitalUsd: CAPITAL,
        confidence: 0.82,
        grossEvFraction: 0.25,
        resolutionAtMs: Date.now() + 6 * 60 * 60 * 1000,
        tier1Verdict: {
          ...makeTier1(true),
          impliedProbability: 0.8,
        },
      }),
    );

    expect(grokReviewerMocks.reviewWithGrok).not.toHaveBeenCalled();
    expect(claudeReviewerMocks.reviewWithSonnet).toHaveBeenCalledTimes(1);
    expect(result.approved).toBe(true);
  });

  it("vetoes when Sonnet ✗ on a high-stakes trade without escalating to Opus", async () => {
    claudeReviewerMocks.reviewWithSonnet.mockResolvedValue(vetoVerdict);

    const result = await runEnsemble(
      makeInput({
        notionalUsd: HIGH_STAKES_NON_CATASTROPHIC_NOTIONAL,
        capitalUsd: CAPITAL,
        grossEvFraction: 0.25,
      }),
    );

    expect(result.approved).toBe(false);
    expect(result.reasoning).toMatch(/Tier-2 veto/i);
    expect(claudeReviewerMocks.reviewWithOpus).not.toHaveBeenCalled();
  });

  it("approves catastrophic bets with Tier-1 + Tier-2 only", async () => {
    claudeReviewerMocks.reviewWithSonnet.mockResolvedValue(approveVerdict);

    const result = await runEnsemble(
      makeInput({ notionalUsd: 50, capitalUsd: 200 }),
    );

    expect(result.approved).toBe(true);
    expect(result.reasoning).toMatch(/Catastrophic-bet approval/i);
    expect(claudeReviewerMocks.reviewWithOpus).not.toHaveBeenCalled();
  });

  it("vetoes catastrophic bets when Tier-2 rejects them", async () => {
    claudeReviewerMocks.reviewWithSonnet.mockResolvedValue(vetoVerdict);

    const result = await runEnsemble(
      makeInput({ notionalUsd: 50, capitalUsd: 200 }),
    );

    expect(result.approved).toBe(false);
    expect(result.reasoning).toMatch(/Catastrophic-bet veto/i);
    expect(claudeReviewerMocks.reviewWithOpus).not.toHaveBeenCalled();
  });

  it("respects a Grok veto on an urgent weather trade", async () => {
    grokReviewerMocks.reviewWithGrok.mockResolvedValue(grokVetoVerdict);

    const result = await runEnsemble(
      makeInput({
        notionalUsd: HIGH_STAKES_NON_CATASTROPHIC_NOTIONAL,
        capitalUsd: CAPITAL,
        confidence: 0.82,
        grossEvFraction: 0.25,
        resolutionAtMs: Date.now() + 6 * 60 * 60 * 1000,
        tier1Verdict: {
          ...makeTier1(true),
          impliedProbability: 0.8,
        },
      }),
    );

    expect(grokReviewerMocks.reviewWithGrok).toHaveBeenCalledTimes(1);
    expect(result.approved).toBe(false);
    expect(result.reasoning).toMatch(/Tier-2 veto/i);
  });
});
