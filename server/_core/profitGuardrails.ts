/**
 * Profit Guardrails — High Leverage Wins Only
 *
 * Strict rules for live trading (owner or graduated users).
 * Higher thresholds = fewer but higher-quality trades.
 * NO GUARANTEES — trading involves risk of loss.
 *
 * Thresholds are env-tunable via Railway (MIN_POSITIVE_EV,
 * MIN_CONFIDENCE_AFTER_ADJUST, MIN_DUAL_BOT_AGREEMENT,
 * MAX_PORTFOLIO_EXPOSURE_PCT, MAX_CORRELATED_GROUP_PCT) — see env.ts.
 * Out-of-range values silently fall back to the defaults preserved below.
 */

import { ENV } from "./env";
import { getCachedScoreboard } from "./dailyScoreboard";

// Snapshot exports preserve the prior public surface (other modules / tests
// that imported the constants by name).  They capture ENV.profitGuardrails
// at module load only and will NOT reflect later mutations.  Runtime
// mutation of ENV.profitGuardrails is intended for tests; production code
// should call the get*() helpers below to read live values.
export const MIN_POSITIVE_EV = ENV.profitGuardrails.minPositiveEv;
export const MIN_CONFIDENCE_AFTER_ADJUST = ENV.profitGuardrails.minConfidenceAfterAdjust;
export const MIN_DUAL_BOT_AGREEMENT = ENV.profitGuardrails.minDualBotAgreement;
export const MAX_PORTFOLIO_EXPOSURE_PCT = ENV.profitGuardrails.maxPortfolioExposurePct;
export const MAX_CORRELATED_GROUP_PCT = ENV.profitGuardrails.maxCorrelatedGroupPct;

// Live getters — prefer these in new code.  They re-read ENV on each call so
// tests can mock ENV.profitGuardrails between checks.
export const getMinPositiveEv = () => ENV.profitGuardrails.minPositiveEv;
export const getMinConfidenceAfterAdjust = () => ENV.profitGuardrails.minConfidenceAfterAdjust;
export const getMinDualBotAgreement = () => ENV.profitGuardrails.minDualBotAgreement;
export const getMaxPortfolioExposurePct = () => ENV.profitGuardrails.maxPortfolioExposurePct;
export const getMaxCorrelatedGroupPct = () => ENV.profitGuardrails.maxCorrelatedGroupPct;

/**
 * Pay-for-yourself floor multiplier.  When the day's running net is
 * negative (we've spent more on AI + fees than we've earned in P&L),
 * the post-review hard floors auto-tighten in proportion to the deficit.
 *
 *   net >= 0      → 1.0 × (no tightening)
 *   overrun 0-50% → 1.0..1.25 (linear ramp)
 *   overrun >=100%→ 1.5 ×  (hard cap)
 *
 * Capped at 1.5× so the gate never becomes impossibly tight (which would
 * just mean no trades all day).  Together with cadence throttling and the
 * reviewer-prompt awareness, this gives us a three-layer pay-for-yourself
 * defense:
 *   - Cadence layer (aiCostBudget): throttle reviews when overrunning
 *   - Reviewer layer: tighten judgment when net-negative
 *   - This (post-review) layer: hard veto on marginal approvals
 *
 * Returns 1.0 when no scoreboard cached (test path / first boot tick).
 */
export function getPayForYourselfMultiplier(): number {
  const sb = getCachedScoreboard();
  if (!sb) return 1.0;
  if (sb.netUsd >= 0) return 1.0;
  const cap = ENV.aiDailyBudgetUsd;
  if (cap <= 0) return 1.0; // operator opted out of cap → don't auto-tighten
  const overrunFraction = Math.min(1, sb.effectiveOverrunUsd / cap);
  // Linear ramp 1.0 → 1.5 across 0 → 100% overrun.
  return 1.0 + overrunFraction * 0.5;
}

export const CORRELATED_CATEGORY_GROUPS: Record<string, string[]> = {
  politics: ["politics"],
  macro: ["economics"],
  tech_ai: ["tech"],
  sports: ["sports"],
  crypto: ["crypto"],
};

export type ProfitCheckResult = {
  approved: boolean;
  reason: string;
  adjustedEV: number;
  adjustedConfidence: number;
  grokVeto?: boolean;
};

/**
 * Core high-leverage gate.
 * Requires strong positive EV + high confidence + dual-bot consensus.
 */
export function checkProfitGuardrails(input: {
  expectedValue: number;
  confidence: number;
  grokApproved?: boolean;
  grokEV?: number;
  grokConfidence?: number;
  isTeamMode?: boolean;
  isOwner?: boolean;           // owner gate is clamped to legacy safety floors (0.03/0.65) but never looser than the configured env floor
  recentWinRate?: number;
}): ProfitCheckResult {
  const ev = Number(input.expectedValue) || 0;
  const conf = Number(input.confidence) || 0;

  // Pay-for-yourself: tighten floors when today's net is negative.  Returns
  // 1.0 (no tightening) when net-positive, when no scoreboard cached, or
  // when AI_DAILY_BUDGET_USD is unset.  Maxes at 1.5× to keep the gate
  // sane.  Confidence floor is similarly tightened but capped at 0.95 so
  // it never becomes mathematically impossible to clear.
  const pfymult = getPayForYourselfMultiplier();
  const evFloorBase = getMinPositiveEv();
  const confFloorBase = getMinConfidenceAfterAdjust();
  const evFloor = evFloorBase * pfymult;
  const confFloor = Math.min(0.95, confFloorBase * pfymult);
  // Owner gate: respects the (now PFY-adjusted) env floor with 0.03 / 0.65
  // acting as a legacy safety floor against accidental over-lowering of
  // the env value.
  // - Default config + net-positive day (0.035 / 0.68) → owner sees the configured floor.
  // - Raised env (e.g. 0.10) → owner respects the raised floor.
  // - Lowered env below 0.03 / 0.65 → owner is clamped to the legacy floor.
  // - Net-negative day → both branches see the PFY-multiplied floor.
  // The owner never gets a lower floor than non-owner; tightening the env
  // (or burning the day's budget) tightens the gate for everyone.
  const minEV = input.isOwner ? Math.max(0.03, evFloor) : evFloor;
  const minConf = input.isOwner ? Math.max(0.65, confFloor) : confFloor;

  if (ev < minEV) {
    return {
      approved: false,
      reason: `EV ${ev.toFixed(3)} below high-leverage minimum ${minEV} — edge too thin for live` ,
      adjustedEV: ev,
      adjustedConfidence: conf,
    };
  }

  if (conf < minConf) {
    return {
      approved: false,
      reason: `Confidence ${conf.toFixed(2)} below high-leverage floor ${minConf}`,
      adjustedEV: ev,
      adjustedConfidence: conf,
    };
  }

  // Dual-bot consensus required for non-owners (and recommended for owner)
  if (input.isTeamMode && input.grokApproved === false) {
    return {
      approved: false,
      reason: "Grok veto — dual-AI consensus required for high-leverage live trades",
      adjustedEV: ev,
      adjustedConfidence: conf,
      grokVeto: true,
    };
  }

  // If Grok confidence is available, require agreement
  if (input.grokConfidence !== undefined && input.grokConfidence < getMinDualBotAgreement()) {
    return {
      approved: false,
      reason: `Grok confidence ${input.grokConfidence.toFixed(2)} too low for high-leverage trade` ,
      adjustedEV: ev,
      adjustedConfidence: conf,
    };
  }

  // Cold streak protection
  if (input.recentWinRate !== undefined && input.recentWinRate < 0.48 && ev < 0.05) {
    return {
      approved: false,
      reason: `Recent win rate ${(input.recentWinRate * 100).toFixed(0)}% — waiting for stronger high-leverage setup` ,
      adjustedEV: ev,
      adjustedConfidence: conf,
    };
  }

  return {
    approved: true,
    reason: "High-leverage guardrails passed — strong EV + confidence + dual-bot consensus",
    adjustedEV: ev,
    adjustedConfidence: conf,
  };
}
export function checkPortfolioExposure(
  currentOpenExposureUsd: number,
  newOrderExposureUsd: number,
  bankrollUsd: number,
  category: string,
  openPositionsByCategory: Record<string, number>,
): { ok: boolean; reason?: string; maxAllowed: number } {
  const totalAfter = currentOpenExposureUsd + newOrderExposureUsd;
  const portfolioPct = getMaxPortfolioExposurePct();
  const maxTotal = bankrollUsd * portfolioPct;

  if (totalAfter > maxTotal) {
    return {
      ok: false,
      reason: `Total exposure would exceed ${(portfolioPct * 100).toFixed(0)}% of bankroll (high-leverage limit)` ,
      maxAllowed: Math.max(0, maxTotal - currentOpenExposureUsd),
    };
  }

  const group = Object.keys(CORRELATED_CATEGORY_GROUPS).find((g) =>
    CORRELATED_CATEGORY_GROUPS[g].includes(category)
  ) || "other";

  const groupExposure = (openPositionsByCategory[group] || 0) + newOrderExposureUsd;
  const groupPct = getMaxCorrelatedGroupPct();
  const maxGroup = bankrollUsd * groupPct;

  if (groupExposure > maxGroup) {
    return {
      ok: false,
      reason: `Correlated group '${group}' exposure would exceed ${(groupPct * 100).toFixed(0)}% of bankroll (high-leverage limit)` ,
      maxAllowed: Math.max(0, maxGroup - (openPositionsByCategory[group] || 0)),
    };
  }

  return { ok: true, maxAllowed: newOrderExposureUsd };
}
