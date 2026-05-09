/**
 * Profit Guardrails — capital-preservation first.
 *
 * Thresholds (Claude-only, post-Phase-1):
 *   - Net EV (after exact Kalshi fees + amortized AI cost): ≥ MIN_NET_EV
 *   - Confidence after AI adjustment: ≥ MIN_CONFIDENCE_AFTER_ADJUST
 *   - Self-consistency: two Sonnet passes (catastrophic-bet only) must agree
 *   - Drawdown circuit breakers: pause on 3 % daily / 8 % weekly loss
 *   - Cold streak: pause after 5 consecutive losses or weekly edge < 3 %
 *   - Position sizing: ½ Kelly capped at 4 % of capital, floored at 0.5 %
 *   - Total exposure: ≤ 25 % of capital, ≤ 10 % per correlated category
 */

import { ENV } from "./env";
import { calculateNetEv } from "./feeCalculator";
import { calculateKellyPosition } from "./kellySizer";
import { checkDrawdownBreaker } from "./drawdownBreaker";
import {
  computeKalshiRoundTripCostFromMarket,
  type RoundTripCost,
} from "./kalshiFees";

// ── Snapshot exports kept for backwards compatibility ────────────────────────
export const MIN_NET_EV = ENV.profitGuardrails.minNetEv;
export const MIN_POSITIVE_EV = ENV.profitGuardrails.minNetEv;
export const MIN_CONFIDENCE_AFTER_ADJUST =
  ENV.profitGuardrails.minConfidenceAfterAdjust;
export const MAX_PORTFOLIO_EXPOSURE_PCT =
  ENV.profitGuardrails.maxPortfolioExposurePct;
export const MAX_CORRELATED_GROUP_PCT =
  ENV.profitGuardrails.maxCorrelatedGroupPct;

// ── Live getters (re-read ENV on each call) ──────────────────────────────────
export const getMinNetEv = () => ENV.profitGuardrails.minNetEv;
export const getMinPositiveEv = () => ENV.profitGuardrails.minNetEv;
export const getMinConfidenceAfterAdjust = () =>
  ENV.profitGuardrails.minConfidenceAfterAdjust;
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

// ── Core check (single trade) ────────────────────────────────────────────────

export type ProfitCheckResult = {
  approved: boolean;
  reason: string;
  adjustedEV: number;
  adjustedConfidence: number;
  netEvFraction: number;
  feeUsd: number;
  aiCostUsd: number;
  /** Phase 2 — full fee + spread-cost breakdown surfaced for the audit log. */
  feeBreakdown?: RoundTripCost;
};

export interface ProfitCheckInput {
  expectedValue: number; // gross EV fraction (model edge)
  confidence: number;
  count: number;
  entryPrice: number; // contract price 0..1
  category: string;
  liquidity?: "maker" | "taker";
  /** Self-consistency: did the second AI pass agree on direction + EV ≥ floor? */
  selfConsistencyAgreement?: boolean;
  /**
   * Phase 2 — `|yesPrice + noPrice − 1|` spread proxy from the market
   * snapshot.  When provided, the gate subtracts round-trip spread cost
   * from netEv on top of the existing fee subtraction.  When omitted,
   * the gate falls back to a 1¢-spread floor (still better than ignoring
   * spread entirely).
   */
  spreadProxy?: number;
  /**
   * Which platform's fee model to apply.  Defaults to "kalshi" so
   * Defaults to "kalshi".
   */
  platform?: "kalshi";
}

export function checkProfitGuardrails(
  input: ProfitCheckInput,
): ProfitCheckResult {
  const ev = Number(input.expectedValue) || 0;
  const conf = Number(input.confidence) || 0;

  // UNITS CRITICAL: signal.expectedValue is the per-contract dollar EV
  // produced by calculateExpectedValue with quantity=1 (so its scale is
  // [-1, 1] for binary markets — "EV per $1 of payout face").
  // calculateNetEv expects grossEvFraction as ROI per dollar invested
  // (= dollarEV / entryPrice).  Without the conversion, every gate
  // understated edge by a factor of entryPrice (e.g. a true 50% ROI on a
  // $0.40 contract was reported as 20% — borderline trades got blocked
  // and audit-log "Net EV" dollars were wrong by the same factor).
  const entryPriceForRoi = Math.max(0.01, Number(input.entryPrice) || 0.01);
  const evRoiFraction = ev / entryPriceForRoi;

  // PHASE-2-FEEAWARE: subtract BOTH exchange fees (calculateNetEv) AND
  // round-trip spread cost (computeKalshiRoundTripCostFromMarket) from
  // gross EV before applying the floor. Spread cost is dominant on
  // illiquid Kalshi markets (2-5¢ wide → 7-17 % round-trip on a 30¢
  // contract), and ignoring it lets paper-profitable trades die in
  // execution. The fee-side math is unchanged from Phase 1.
  const net = calculateNetEv({
    count: input.count,
    entryPrice: input.entryPrice,
    grossEvFraction: evRoiFraction,
    entryLiquidity: input.liquidity,
  });
  const feeBreakdown = computeKalshiRoundTripCostFromMarket({
    market: { yesPrice: input.entryPrice, noPrice: 1 - input.entryPrice },
    side: "yes",
    contracts: input.count,
    spreadProxy: input.spreadProxy,
    entryLiquidity: input.liquidity,
    exitLiquidity: input.liquidity,
  });
  const spreadCostFraction =
    feeBreakdown.notionalUsd > 0
      ? feeBreakdown.spreadCostUsd / feeBreakdown.notionalUsd
      : 0;
  const feeAwareNetEvFraction = net.netEvFraction - spreadCostFraction;

  // Single floor for everyone — no owner-override tier. The previous
  // owner-bypass that loosened EV/conf for OWNER_OVERRIDE_DOMAINS was
  // multi-tenant scaffolding; removed now that this is a single-owner
  // system. If you want looser floors, just set MIN_NET_EV /
  // MIN_CONFIDENCE_AFTER_ADJUST in env.
  const evFloor = getMinNetEv();
  const confFloor = getMinConfidenceAfterAdjust();

  if (feeAwareNetEvFraction < evFloor) {
    return {
      approved: false,
      reason: `Net EV ${(feeAwareNetEvFraction * 100).toFixed(2)}% < ${(evFloor * 100).toFixed(2)}% floor (gross ROI ${(evRoiFraction * 100).toFixed(2)}% − fees $${net.feeUsd.toFixed(2)} − spread $${feeBreakdown.spreadCostUsd.toFixed(2)} − AI $${net.aiCostUsd.toFixed(4)})`,
      adjustedEV: ev,
      adjustedConfidence: conf,
      netEvFraction: feeAwareNetEvFraction,
      feeUsd: net.feeUsd,
      aiCostUsd: net.aiCostUsd,
      feeBreakdown,
    };
  }

  if (conf < confFloor) {
    return {
      approved: false,
      reason: `Confidence ${(conf * 100).toFixed(1)}% below ${(confFloor * 100).toFixed(1)}% floor`,
      adjustedEV: ev,
      adjustedConfidence: conf,
      netEvFraction: feeAwareNetEvFraction,
      feeUsd: net.feeUsd,
      aiCostUsd: net.aiCostUsd,
      feeBreakdown,
    };
  }

  if (input.selfConsistencyAgreement === false) {
    return {
      approved: false,
      reason:
        "Self-consistency check failed — second AI pass disagreed with first; SKIP per ambiguity rule",
      adjustedEV: ev,
      adjustedConfidence: conf,
      netEvFraction: feeAwareNetEvFraction,
      feeUsd: net.feeUsd,
      aiCostUsd: net.aiCostUsd,
      feeBreakdown,
    };
  }

  return {
    approved: true,
    reason: `Net EV ${(feeAwareNetEvFraction * 100).toFixed(2)}% ≥ ${(evFloor * 100).toFixed(2)}% + confidence ${(conf * 100).toFixed(1)}% ≥ ${(confFloor * 100).toFixed(1)}% (gross ROI ${(evRoiFraction * 100).toFixed(2)}% − fees $${net.feeUsd.toFixed(2)} − spread $${feeBreakdown.spreadCostUsd.toFixed(2)})`,
    adjustedEV: ev,
    adjustedConfidence: conf,
    netEvFraction: feeAwareNetEvFraction,
    feeUsd: net.feeUsd,
    aiCostUsd: net.aiCostUsd,
    feeBreakdown,
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
