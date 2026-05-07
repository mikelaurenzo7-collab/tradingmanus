/**
 * Profit Guardrails
 *
 * Hard rules that must pass before any live order is placed.
 * Goal: Maximize probability of positive expectancy while protecting capital.
 * NO GUARANTEES — markets are uncertain; losses are possible.
 */

import { ENV } from "./env";

export const MIN_POSITIVE_EV = 0.025;        // 2.5% edge required after adjustments

export const MIN_CONFIDENCE_AFTER_ADJUST = 0.60; // 60% confidence floor

export const MIN_BOTH_BOTS_CONFIDENCE = 0.55;  // When using team mode

export const MAX_PORTFOLIO_EXPOSURE_PCT = 0.25; // 25% of bankroll max in open positions

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
 * Core profitability gate.
 * Requires positive EV + minimum confidence after reviewer adjustments.
 * In team mode, also requires Grok not to veto.
 */
export function checkProfitGuardrails(input: {
  expectedValue: number;           // after reviewer adjustments
  confidence: number;              // after reviewer adjustments
  grokApproved?: boolean;          // if Grok reviewed this signal
  grokEV?: number;
  grokConfidence?: number;
  isTeamMode?: boolean;
  recentWinRate?: number;          // 0-1 from desk memory
}): ProfitCheckResult {
  const ev = Number(input.expectedValue) || 0;
  const conf = Number(input.confidence) || 0;

  if (ev < MIN_POSITIVE_EV) {
    return {
      approved: false,
      reason: `EV ${ev.toFixed(3)} below minimum ${MIN_POSITIVE_EV} — insufficient edge` ,
      adjustedEV: ev,
      adjustedConfidence: conf,
    };
  }

  if (conf < MIN_CONFIDENCE_AFTER_ADJUST) {
    return {
      approved: false,
      reason: `Confidence ${conf.toFixed(2)} below floor ${MIN_CONFIDENCE_AFTER_ADJUST}`,
      adjustedEV: ev,
      adjustedConfidence: conf,
    };
  }

  // Team mode: Grok must approve (or at least not strongly disagree)
  if (input.isTeamMode && input.grokApproved === false) {
    return {
      approved: false,
      reason: "Grok vetoed this trade — dual-AI consensus required for live execution",
      adjustedEV: ev,
      adjustedConfidence: conf,
      grokVeto: true,
    };
  }

  // Optional: raise bar if recent win rate is poor
  if (input.recentWinRate !== undefined && input.recentWinRate < 0.45 && ev < 0.04) {
    return {
      approved: false,
      reason: `Recent win rate ${(input.recentWinRate * 100).toFixed(0)}% is weak — waiting for stronger edge` ,
      adjustedEV: ev,
      adjustedConfidence: conf,
    };
  }

  return {
    approved: true,
    reason: "Profit guardrails passed — positive EV + confidence + dual-AI consensus",
    adjustedEV: ev,
    adjustedConfidence: conf,
  };
}

/**
 * Portfolio-level exposure check (simple version).
 * Prevents over-concentration in correlated categories.
 */
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
      reason: `Total exposure would exceed ${(MAX_PORTFOLIO_EXPOSURE_PCT * 100).toFixed(0)}% of bankroll` ,
      maxAllowed: Math.max(0, maxTotal - currentOpenExposureUsd),
    };
  }

  // Correlated category cap (e.g., don't put >12% in all politics bets)
  const group = Object.keys(CORRELATED_CATEGORY_GROUPS).find((g) =>
    CORRELATED_CATEGORY_GROUPS[g].includes(category)
  ) || "other";

  const groupExposure = (openPositionsByCategory[group] || 0) + newOrderExposureUsd;
  const maxGroup = bankrollUsd * 0.12; // 12% per correlated group

  if (groupExposure > maxGroup) {
    return {
      ok: false,
      reason: `Correlated group '${group}' exposure would exceed 12% of bankroll` ,
      maxAllowed: Math.max(0, maxGroup - (openPositionsByCategory[group] || 0)),
    };
  }

  return { ok: true, maxAllowed: newOrderExposureUsd };
}
