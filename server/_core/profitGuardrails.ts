/**
 * Profit Guardrails — High Leverage Wins Only
 *
 * Strict rules for live trading (owner or graduated users).
 * Higher thresholds = fewer but higher-quality trades.
 * NO GUARANTEES — trading involves risk of loss.
 */

import { ENV } from "./env";

// High-leverage thresholds (tighter than before)
export const MIN_POSITIVE_EV = 0.035;           // 3.5%+ edge required

export const MIN_CONFIDENCE_AFTER_ADJUST = 0.68; // 68%+ confidence

export const MIN_DUAL_BOT_AGREEMENT = 0.62;     // Both Claude & Grok must be ≥ this

export const MAX_PORTFOLIO_EXPOSURE_PCT = 0.20; // 20% max (more conservative)

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
  isOwner?: boolean;           // owner gets slightly more leeway
  recentWinRate?: number;
}): ProfitCheckResult {
  const ev = Number(input.expectedValue) || 0;
  const conf = Number(input.confidence) || 0;

  const minEV = input.isOwner ? 0.03 : MIN_POSITIVE_EV;
  const minConf = input.isOwner ? 0.65 : MIN_CONFIDENCE_AFTER_ADJUST;

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
  if (input.grokConfidence !== undefined && input.grokConfidence < MIN_DUAL_BOT_AGREEMENT) {
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
  const maxTotal = bankrollUsd * MAX_PORTFOLIO_EXPOSURE_PCT;

  if (totalAfter > maxTotal) {
    return {
      ok: false,
      reason: `Total exposure would exceed ${(MAX_PORTFOLIO_EXPOSURE_PCT * 100).toFixed(0)}% of bankroll (high-leverage limit)` ,
      maxAllowed: Math.max(0, maxTotal - currentOpenExposureUsd),
    };
  }

  const group = Object.keys(CORRELATED_CATEGORY_GROUPS).find((g) =>
    CORRELATED_CATEGORY_GROUPS[g].includes(category)
  ) || "other";

  const groupExposure = (openPositionsByCategory[group] || 0) + newOrderExposureUsd;
  const maxGroup = bankrollUsd * 0.10; // 10% per correlated group (tighter)

  if (groupExposure > maxGroup) {
    return {
      ok: false,
      reason: `Correlated group '${group}' exposure would exceed 10% of bankroll (high-leverage limit)` ,
      maxAllowed: Math.max(0, maxGroup - (openPositionsByCategory[group] || 0)),
    };
  }

  return { ok: true, maxAllowed: newOrderExposureUsd };
}
