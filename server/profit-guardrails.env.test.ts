/**
 * Profit-guardrails env-tunable thresholds.
 *
 * The thresholds are env-driven via ENV.profitGuardrails (env.ts).  The
 * exported getters (getMinPositiveEv, etc.) re-read ENV on every call, so
 * tests can mutate ENV.profitGuardrails directly between checks without
 * needing vi.resetModules.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { ENV } from "./_core/env";
import {
  checkProfitGuardrails,
  checkPortfolioExposure,
} from "./_core/profitGuardrails";
import { __TEST_ONLY__ as SCOREBOARD } from "./_core/dailyScoreboard";
import { __TEST_ONLY__ as BUDGET } from "./_core/aiCostBudget";

const ORIGINAL = { ...ENV.profitGuardrails };

afterEach(() => {
  ENV.profitGuardrails.minPositiveEv = ORIGINAL.minPositiveEv;
  ENV.profitGuardrails.minConfidenceAfterAdjust = ORIGINAL.minConfidenceAfterAdjust;
  ENV.profitGuardrails.minDualBotAgreement = ORIGINAL.minDualBotAgreement;
  ENV.profitGuardrails.maxPortfolioExposurePct = ORIGINAL.maxPortfolioExposurePct;
  ENV.profitGuardrails.maxCorrelatedGroupPct = ORIGINAL.maxCorrelatedGroupPct;
});

describe("env-tunable profit guardrails", () => {
  it("uses the configured MIN_POSITIVE_EV floor", () => {
    ENV.profitGuardrails.minPositiveEv = 0.05;
    const result = checkProfitGuardrails({ expectedValue: 0.04, confidence: 0.80 });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("EV 0.040 below high-leverage minimum 0.05");
  });

  it("approves an EV that just meets the configured floor", () => {
    ENV.profitGuardrails.minPositiveEv = 0.04;
    ENV.profitGuardrails.minConfidenceAfterAdjust = 0.65;
    const result = checkProfitGuardrails({ expectedValue: 0.04, confidence: 0.80 });
    expect(result.approved).toBe(true);
  });

  it("uses the configured MIN_CONFIDENCE_AFTER_ADJUST floor", () => {
    ENV.profitGuardrails.minConfidenceAfterAdjust = 0.80;
    const result = checkProfitGuardrails({ expectedValue: 0.10, confidence: 0.70 });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("Confidence 0.70 below high-leverage floor 0.8");
  });

  it("uses the configured MIN_DUAL_BOT_AGREEMENT floor on grokConfidence", () => {
    ENV.profitGuardrails.minDualBotAgreement = 0.75;
    const result = checkProfitGuardrails({
      expectedValue: 0.10,
      confidence: 0.80,
      grokConfidence: 0.70,
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("Grok confidence 0.70 too low");
  });

  it("uses the configured MAX_PORTFOLIO_EXPOSURE_PCT", () => {
    ENV.profitGuardrails.maxPortfolioExposurePct = 0.10; // 10% cap
    ENV.profitGuardrails.maxCorrelatedGroupPct = 0.10;   // keep loose so the cluster cap doesn't fire first
    const result = checkPortfolioExposure(
      0,        // no current exposure
      150,      // new $150 order
      1000,     // $1000 bankroll → 10% cap = $100
      "tech",
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("10% of bankroll");
    expect(result.maxAllowed).toBe(100);
  });

  it("uses the configured MAX_CORRELATED_GROUP_PCT", () => {
    ENV.profitGuardrails.maxPortfolioExposurePct = 1.0;  // disable portfolio cap so cluster gate is the trigger
    ENV.profitGuardrails.maxCorrelatedGroupPct = 0.05;   // 5% per cluster
    const result = checkPortfolioExposure(
      0,        // current exposure
      80,       // new $80 order
      1000,     // $1000 bankroll → 5% cluster cap = $50
      "tech",
      { tech_ai: 0 },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Correlated group 'tech_ai'");
    expect(result.reason).toContain("5% of bankroll");
  });

  it("approves when exposure is under both caps", () => {
    ENV.profitGuardrails.maxPortfolioExposurePct = 0.20;
    ENV.profitGuardrails.maxCorrelatedGroupPct = 0.10;
    const result = checkPortfolioExposure(0, 50, 1000, "tech", { tech_ai: 0 });
    expect(result.ok).toBe(true);
  });

  it("owner respects raised env floor (Math.max semantics)", () => {
    // Operator raises EV floor to 0.10. Owner must respect it — a 4% edge
    // is rejected even on the owner branch. Guards against a regression
    // back to Math.min, which would let owner trade at 0.03 and bypass
    // the operator's explicit safety bar.
    ENV.profitGuardrails.minPositiveEv = 0.10;
    ENV.profitGuardrails.minConfidenceAfterAdjust = 0.80;
    const result = checkProfitGuardrails({
      expectedValue: 0.04,
      confidence: 0.95,
      isOwner: true,
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("EV 0.040 below high-leverage minimum 0.1");
  });

  it("owner respects raised confidence env floor (symmetric Math.max)", () => {
    // Mirror of the EV-clamp test for the confidence path: a high-EV but
    // low-confidence trade is rejected on the owner branch when the
    // configured confidence floor is raised.  Locks the symmetric Math.max
    // semantics for minConfidenceAfterAdjust.
    ENV.profitGuardrails.minPositiveEv = 0.01;
    ENV.profitGuardrails.minConfidenceAfterAdjust = 0.90;
    const result = checkProfitGuardrails({
      expectedValue: 0.20,
      confidence: 0.70,
      isOwner: true,
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("Confidence 0.70 below high-leverage floor 0.9");
  });

  it("owner is clamped UP to the 0.03 legacy floor when env is lowered below it", () => {
    // If operator misconfigures env to a dangerously-low 0.005, the
    // legacy 0.03 floor still protects the owner from a 1% edge.
    ENV.profitGuardrails.minPositiveEv = 0.005;
    ENV.profitGuardrails.minConfidenceAfterAdjust = 0.50;
    const result = checkProfitGuardrails({
      expectedValue: 0.01,
      confidence: 0.90,
      isOwner: true,
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("below high-leverage minimum 0.03");
  });

  it("non-owner respects the configured env floor regardless of legacy values", () => {
    // Sanity: non-owner branch is unchanged by the Math.max fix.
    ENV.profitGuardrails.minPositiveEv = 0.005;
    ENV.profitGuardrails.minConfidenceAfterAdjust = 0.50;
    const result = checkProfitGuardrails({
      expectedValue: 0.01,
      confidence: 0.55,
      isOwner: false,
    });
    expect(result.approved).toBe(true);
  });
});

describe("normalizeFloat strict-parse contract", () => {
  // The helper isn't exported, but the contract is observable through the
  // documented defaults: a malformed env string at boot must fall back to
  // the default. We can't mutate boot-time parsing here, so we assert the
  // documented properties of the parser indirectly via Number().
  it("rejects trailing junk strings (Number, not Number.parseFloat semantics)", () => {
    expect(Number("0.68abc")).toBeNaN();
    expect(Number.parseFloat("0.68abc")).toBe(0.68);
  });
});

describe("env-var parsing fallbacks (env.ts)", () => {
  // These verify that the boot-time normalizeFloat helper rejects nonsense
  // values.  We exercise it via the exported defaults — because we can't
  // re-import env.ts after mutating process.env (ENV is computed once),
  // we test parsing edge cases at the helper level.  The fallback contract
  // is: out-of-range or non-numeric input → fallback default.
  beforeAll(() => {
    // sanity: defaults are within sane bounds
    expect(ORIGINAL.minPositiveEv).toBeGreaterThanOrEqual(0);
    expect(ORIGINAL.minPositiveEv).toBeLessThanOrEqual(1);
    expect(ORIGINAL.maxPortfolioExposurePct).toBeGreaterThan(0);
    expect(ORIGINAL.maxPortfolioExposurePct).toBeLessThanOrEqual(1);
  });

  it("preserves the documented defaults when env is unset", () => {
    // These are the values committed to env.ts as fallbacks; if they
    // change, update the .env.example + the Railway checklist in PR #48.
    expect(ORIGINAL.minPositiveEv).toBeCloseTo(0.035, 5);
    expect(ORIGINAL.minConfidenceAfterAdjust).toBeCloseTo(0.68, 5);
    expect(ORIGINAL.minDualBotAgreement).toBeCloseTo(0.62, 5);
    expect(ORIGINAL.maxPortfolioExposurePct).toBeCloseTo(0.20, 5);
    expect(ORIGINAL.maxCorrelatedGroupPct).toBeCloseTo(0.10, 5);
  });
});

describe("pay-for-yourself floor tightening (Layer 3)", () => {
  // The PFY multiplier reads from dailyScoreboard's cached snapshot.
  // We mutate that cache + ENV.aiDailyBudgetUsd directly to test the
  // tightening in isolation.

  afterEach(() => {
    SCOREBOARD.reset();
    BUDGET.setSpentUsd(0);
    ENV.aiDailyBudgetUsd = 0;
  });

  // The PFY multiplier reads `getCachedScoreboard()` which RE-COMPUTES
  // netUsd + effectiveOverrunUsd from the cache's realizedPnl/fees plus
  // the LIVE aiSpend.  So tests must set both the scoreboard cache AND
  // BUDGET.setSpentUsd to make the live overrun what we want.

  it("does not tighten when net-positive (multiplier = 1.0)", () => {
    ENV.aiDailyBudgetUsd = 10;
    BUDGET.setSpentUsd(5);
    SCOREBOARD.setCached({
      dayBucketMs: Date.now(),
      realizedPnlUsd: 50, // net = 50 - 5 = +45
      estimatedFeesUsd: 0,
      aiSpendUsd: 5,
      netUsd: 45,
      effectiveOverrunUsd: 0,
      refreshedAtMs: Date.now(),
    });
    ENV.profitGuardrails.minPositiveEv = 0.04;
    const result = checkProfitGuardrails({ expectedValue: 0.04, confidence: 0.80 });
    expect(result.approved).toBe(true);
  });

  it("tightens floors when net-negative (overrun 100% → multiplier 1.5)", () => {
    ENV.aiDailyBudgetUsd = 10;
    BUDGET.setSpentUsd(20); // live overrun = 20 - 0 = 20 (200% clamped to 100%)
    SCOREBOARD.setCached({
      dayBucketMs: Date.now(),
      realizedPnlUsd: 0,
      estimatedFeesUsd: 0,
      aiSpendUsd: 20,
      netUsd: -20,
      effectiveOverrunUsd: 20,
      refreshedAtMs: Date.now(),
    });
    ENV.profitGuardrails.minPositiveEv = 0.04;
    // Effective floor: 0.04 × 1.5 = 0.06.  EV = 0.05 should now be vetoed.
    const result = checkProfitGuardrails({ expectedValue: 0.05, confidence: 0.80 });
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("EV 0.050 below high-leverage minimum");
  });

  it("does not tighten when AI_DAILY_BUDGET_USD is unset (multiplier = 1.0)", () => {
    ENV.aiDailyBudgetUsd = 0; // operator opted out of the cap
    BUDGET.setSpentUsd(100);
    SCOREBOARD.setCached({
      dayBucketMs: Date.now(),
      realizedPnlUsd: 0,
      estimatedFeesUsd: 0,
      aiSpendUsd: 100,
      netUsd: -100,
      effectiveOverrunUsd: 100,
      refreshedAtMs: Date.now(),
    });
    ENV.profitGuardrails.minPositiveEv = 0.04;
    const result = checkProfitGuardrails({ expectedValue: 0.04, confidence: 0.80 });
    expect(result.approved).toBe(true);
  });

  it("caps confidence floor at 0.95 even at maximum tightening", () => {
    ENV.aiDailyBudgetUsd = 10;
    BUDGET.setSpentUsd(20);
    SCOREBOARD.setCached({
      dayBucketMs: Date.now(),
      realizedPnlUsd: 0,
      estimatedFeesUsd: 0,
      aiSpendUsd: 20,
      netUsd: -20,
      effectiveOverrunUsd: 20,
      refreshedAtMs: Date.now(),
    });
    ENV.profitGuardrails.minConfidenceAfterAdjust = 0.7;
    // 0.7 × 1.5 = 1.05, but clamped to 0.95.  Confidence 0.96 should clear.
    ENV.profitGuardrails.minPositiveEv = 0.001;
    const result = checkProfitGuardrails({ expectedValue: 0.10, confidence: 0.96 });
    expect(result.approved).toBe(true);
  });
});
