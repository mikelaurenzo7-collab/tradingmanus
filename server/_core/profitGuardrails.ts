/**
 * Profit Guardrails — capital-preservation first, $200-starting-capital tuned.
 *
 * Tighter post-pivot thresholds:
 *   - Net EV (after exact Kalshi fees + amortized Grok cost): ≥ 6.5 %
 *   - Confidence after Grok adjustment:                       ≥ 76 %
 *   - Self-consistency: two Grok passes (different temps) must agree
 *   - Drawdown circuit breakers: pause on 3 % daily / 8 % weekly loss
 *   - Cold streak: pause after 5 consecutive losses or weekly edge < 3 %
 *   - Position sizing: ¼ Kelly capped at 2 % of capital, floored at 0.5 %
 *   - Total exposure: ≤ 20 % of capital, ≤ 10 % per correlated category
 *
 * Owner-override domains: env-listed categories where the operator's domain
 * knowledge is trusted enough to relax the AI gate (still honors the hard
 * fee/Kelly/drawdown rules — only the soft EV/confidence floors are loosened).
 */

import { ENV } from "./env";
import { calculateNetEv } from "./feeCalculator";
import { calculateKellyPosition } from "./kellySizer";
import { checkDrawdownBreaker } from "./drawdownBreaker";

// ── Snapshot exports kept for backwards compatibility ────────────────────────
export const MIN_NET_EV = ENV.profitGuardrails.minNetEv;
export const MIN_POSITIVE_EV = ENV.profitGuardrails.minNetEv;
export const MIN_CONFIDENCE_AFTER_ADJUST =
  ENV.profitGuardrails.minConfidenceAfterAdjust;
export const MIN_DUAL_BOT_AGREEMENT = ENV.profitGuardrails.minDualBotAgreement;
export const MAX_PORTFOLIO_EXPOSURE_PCT =
  ENV.profitGuardrails.maxPortfolioExposurePct;
export const MAX_CORRELATED_GROUP_PCT =
  ENV.profitGuardrails.maxCorrelatedGroupPct;

// ── Live getters (re-read ENV on each call) ──────────────────────────────────
export const getMinNetEv = () => ENV.profitGuardrails.minNetEv;
export const getMinPositiveEv = () => ENV.profitGuardrails.minNetEv;
export const getMinConfidenceAfterAdjust = () =>
  ENV.profitGuardrails.minConfidenceAfterAdjust;
export const getMinDualBotAgreement = () =>
  ENV.profitGuardrails.minDualBotAgreement;
export const getMaxPortfolioExposurePct = () =>
  ENV.profitGuardrails.maxPortfolioExposurePct;
export const getMaxCorrelatedGroupPct = () =>
  ENV.profitGuardrails.maxCorrelatedGroupPct;

export const CORRELATED_CATEGORY_GROUPS: Record<string, string[]> = {
  weather: ["weather"],
  economics: ["economics", "macro"],
  politics: ["politics"],
  tech_ai: ["tech", "ai"],
  sports: ["sports"],
  crypto: ["crypto"],
  entertainment: ["entertainment"],
};

function getOwnerOverrideDomains(): Set<string> {
  if (!ENV.ownerOverrideDomains) return new Set();
  return new Set(
    ENV.ownerOverrideDomains
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isOwnerOverrideCategory(category: string): boolean {
  return getOwnerOverrideDomains().has(category.toLowerCase());
}

// ── Core check (single trade) ────────────────────────────────────────────────

export type ProfitCheckResult = {
  approved: boolean;
  reason: string;
  adjustedEV: number;
  adjustedConfidence: number;
  netEvFraction: number;
  feeUsd: number;
  aiCostUsd: number;
  grokVeto?: boolean;
};

export interface ProfitCheckInput {
  expectedValue: number; // gross EV fraction (model edge)
  confidence: number;
  count: number;
  entryPrice: number; // contract price 0..1
  category: string;
  liquidity?: "maker" | "taker";
  /** Self-consistency: did the second Grok pass agree on direction + EV ≥ floor? */
  selfConsistencyAgreement?: boolean;
  /** Operator override flag — set true to bypass the soft EV/conf gates for
   *  high-confidence personal-domain trades. Hard fee/Kelly checks still run. */
  isOwnerOverride?: boolean;
}

export function checkProfitGuardrails(
  input: ProfitCheckInput,
): ProfitCheckResult {
  const ev = Number(input.expectedValue) || 0;
  const conf = Number(input.confidence) || 0;

  const net = calculateNetEv({
    count: input.count,
    entryPrice: input.entryPrice,
    grossEvFraction: ev,
    entryLiquidity: input.liquidity,
  });

  const minNetEv = getMinNetEv();
  const minConf = getMinConfidenceAfterAdjust();

  // Owner-override domains: looser EV/conf floors but still positive.
  const ownerOverride =
    input.isOwnerOverride || isOwnerOverrideCategory(input.category);
  const evFloor = ownerOverride ? Math.max(0.025, minNetEv * 0.5) : minNetEv;
  const confFloor = ownerOverride ? Math.max(0.6, minConf - 0.08) : minConf;

  if (net.netEvFraction < evFloor) {
    return {
      approved: false,
      reason: `Net EV ${(net.netEvFraction * 100).toFixed(2)}% < ${(evFloor * 100).toFixed(2)}% floor (gross ${(ev * 100).toFixed(2)}% − fees $${net.feeUsd.toFixed(2)} − AI $${net.aiCostUsd.toFixed(4)})`,
      adjustedEV: ev,
      adjustedConfidence: conf,
      netEvFraction: net.netEvFraction,
      feeUsd: net.feeUsd,
      aiCostUsd: net.aiCostUsd,
    };
  }

  if (conf < confFloor) {
    return {
      approved: false,
      reason: `Confidence ${(conf * 100).toFixed(1)}% below ${(confFloor * 100).toFixed(1)}% floor`,
      adjustedEV: ev,
      adjustedConfidence: conf,
      netEvFraction: net.netEvFraction,
      feeUsd: net.feeUsd,
      aiCostUsd: net.aiCostUsd,
    };
  }

  if (input.selfConsistencyAgreement === false) {
    return {
      approved: false,
      reason:
        "Self-consistency check failed — second Grok pass disagreed with first; SKIP per ambiguity rule",
      adjustedEV: ev,
      adjustedConfidence: conf,
      netEvFraction: net.netEvFraction,
      feeUsd: net.feeUsd,
      aiCostUsd: net.aiCostUsd,
    };
  }

  return {
    approved: true,
    reason: `Net EV ${(net.netEvFraction * 100).toFixed(2)}% ≥ ${(evFloor * 100).toFixed(2)}% + confidence ${(conf * 100).toFixed(1)}% ≥ ${(confFloor * 100).toFixed(1)}%${ownerOverride ? " (owner override)" : ""}`,
    adjustedEV: ev,
    adjustedConfidence: conf,
    netEvFraction: net.netEvFraction,
    feeUsd: net.feeUsd,
    aiCostUsd: net.aiCostUsd,
  };
}

// ── Portfolio exposure ───────────────────────────────────────────────────────

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
      reason: `Total exposure would exceed ${(portfolioPct * 100).toFixed(0)}% of bankroll`,
      maxAllowed: Math.max(0, maxTotal - currentOpenExposureUsd),
    };
  }

  const group =
    Object.keys(CORRELATED_CATEGORY_GROUPS).find((g) =>
      CORRELATED_CATEGORY_GROUPS[g].includes(category),
    ) || "other";
  const groupExposure =
    (openPositionsByCategory[group] || 0) + newOrderExposureUsd;
  const groupPct = getMaxCorrelatedGroupPct();
  const maxGroup = bankrollUsd * groupPct;

  if (groupExposure > maxGroup) {
    return {
      ok: false,
      reason: `Correlated group '${group}' exposure would exceed ${(groupPct * 100).toFixed(0)}% of bankroll`,
      maxAllowed: Math.max(
        0,
        maxGroup - (openPositionsByCategory[group] || 0),
      ),
    };
  }
  return { ok: true, maxAllowed: newOrderExposureUsd };
}

// ── Combined gate (the one the autonomy loop calls) ──────────────────────────

export interface FullCheckInput extends ProfitCheckInput {
  capitalUsd: number;
  todayPnlUsd: number;
  weeklyPnlUsd: number;
  consecutiveLosses: number;
  weeklyRealizedEdgePct: number;
  currentOpenExposureUsd: number;
  openPositionsByCategory: Record<string, number>;
  /** Operator probability estimate for Kelly sizing (0..1). */
  winProbability: number;
}

export interface FullCheckResult {
  approved: boolean;
  reason: string;
  details: {
    profit: ProfitCheckResult;
    drawdown: ReturnType<typeof checkDrawdownBreaker>;
    kelly: ReturnType<typeof calculateKellyPosition>;
    exposure: ReturnType<typeof checkPortfolioExposure>;
  };
}

/**
 * The single canonical "should we place this order?" check. Combines net-EV
 * gate, drawdown breakers, Kelly sizing, and portfolio exposure into one
 * decision. The autonomy loop should call only this — never the individual
 * checks — so the audit log captures a coherent reason on every reject.
 */
export function checkFullEntry(input: FullCheckInput): FullCheckResult {
  const drawdown = checkDrawdownBreaker({
    capitalUsd: input.capitalUsd,
    todayPnlUsd: input.todayPnlUsd,
    weeklyPnlUsd: input.weeklyPnlUsd,
    consecutiveLosses: input.consecutiveLosses,
    weeklyRealizedEdgePct: input.weeklyRealizedEdgePct,
  });
  if (!drawdown.allowed) {
    return {
      approved: false,
      reason: `Drawdown breaker tripped: ${drawdown.reason}`,
      details: {
        profit: emptyProfitResult(input, "skipped — drawdown gate"),
        drawdown,
        kelly: emptyKelly(),
        exposure: { ok: false, maxAllowed: 0, reason: "skipped — drawdown" },
      },
    };
  }

  const profit = checkProfitGuardrails(input);
  if (!profit.approved) {
    return {
      approved: false,
      reason: profit.reason,
      details: {
        profit,
        drawdown,
        kelly: emptyKelly(),
        exposure: { ok: false, maxAllowed: 0, reason: "skipped — EV/conf" },
      },
    };
  }

  const kelly = calculateKellyPosition({
    winProbability: input.winProbability,
    contractPrice: input.entryPrice,
    totalCapitalUsd: input.capitalUsd,
  });
  if (!kelly.meetsMinFloor) {
    return {
      approved: false,
      reason: `Kelly below floor: ${kelly.reason}`,
      details: {
        profit,
        drawdown,
        kelly,
        exposure: { ok: false, maxAllowed: 0, reason: "skipped — Kelly floor" },
      },
    };
  }

  const orderUsd = kelly.positionUsd;
  const exposure = checkPortfolioExposure(
    input.currentOpenExposureUsd,
    orderUsd,
    input.capitalUsd,
    input.category,
    input.openPositionsByCategory,
  );
  if (!exposure.ok) {
    return {
      approved: false,
      reason: exposure.reason ?? "exposure cap exceeded",
      details: { profit, drawdown, kelly, exposure },
    };
  }

  return {
    approved: true,
    reason: "All capital-preservation gates passed",
    details: { profit, drawdown, kelly, exposure },
  };
}

function emptyKelly() {
  return {
    fullKelly: 0,
    fractionalKelly: 0,
    positionUsd: 0,
    contractCount: 0,
    meetsMinFloor: false,
    reason: "skipped",
  };
}

function emptyProfitResult(
  input: ProfitCheckInput,
  reason: string,
): ProfitCheckResult {
  return {
    approved: false,
    reason,
    adjustedEV: input.expectedValue,
    adjustedConfidence: input.confidence,
    netEvFraction: 0,
    feeUsd: 0,
    aiCostUsd: 0,
  };
}

/**
 * Pay-for-yourself multiplier — kept as a no-op for backwards compat after
 * the daily-budget refactor. Returns 1.0 (no tightening) until callers
 * migrate to the drawdown breaker, which is the unified capital gate.
 */
export function getPayForYourselfMultiplier(): number {
  return 1.0;
}
