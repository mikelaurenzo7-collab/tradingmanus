/**
 * Dynamic scanner — daily AI-analysis budget controller.
 *
 * Base rule:  5 analyses / day.
 * Conditional rule: increase to 7 (when high-opportunity signal is single)
 *                   or 8 (when both signals fire) IF AND ONLY IF:
 *
 *   (a) >18 liquid markets with clear, unambiguous resolution rules are
 *       observable today, OR
 *   (b) a major scheduled event lands today (Fed FOMC, CPI/PPI/NFP, election
 *       night, named storm landfall, scheduled SCOTUS decision day, etc.), OR
 *   (c) the trailing-week backtest realized edge > 8 %.
 *
 * If neither (a) nor (b) nor (c) hold, the scanner stays at 5/day.
 *
 * The scanner is a *budget* — the autonomy loop calls `getDailyAnalysisBudget`
 * once per day and reduces the active-market candidate set to fit. Once the
 * budget is consumed, additional reviews are skipped until the next UTC day.
 */

import { ENV } from "./env";

export interface ScannerInputs {
  /** Number of currently-open Kalshi markets that pass the liquidity floor
   *  + have unambiguous resolution rules (operator-judged). */
  liquidUnambiguousMarketCount: number;
  /** True when today contains at least one major scheduled event. */
  majorScheduledEventToday: boolean;
  /** Trailing 7-day realized edge as a decimal fraction. */
  weeklyRealizedEdgePct: number;
}

export interface ScannerDecision {
  /** Daily analysis budget for the AI reviewer. */
  dailyBudget: number;
  /** Why the budget was chosen — surfaced on the dashboard. */
  reason: string;
  /** Which conditional triggers fired (for audit + dashboard). */
  triggers: {
    highLiquidity: boolean;
    majorScheduledEvent: boolean;
    weeklyEdgeAboveCutoff: boolean;
  };
  /** Whether the budget was raised above the base. */
  raised: boolean;
}

export function getDailyAnalysisBudget(input: ScannerInputs): ScannerDecision {
  const base = ENV.scannerBaseAnalysesPerDay;
  const max = ENV.scannerMaxAnalysesPerDay;
  const liquidCutoff = ENV.scannerHighOpportunityLiquidMarkets;
  const edgeCutoff = ENV.scannerHighOpportunityWeeklyEdgePct;

  const triggers = {
    highLiquidity: input.liquidUnambiguousMarketCount > liquidCutoff,
    majorScheduledEvent: !!input.majorScheduledEventToday,
    weeklyEdgeAboveCutoff: input.weeklyRealizedEdgePct > edgeCutoff,
  };

  const triggerCount =
    (triggers.highLiquidity ? 1 : 0) +
    (triggers.majorScheduledEvent ? 1 : 0) +
    (triggers.weeklyEdgeAboveCutoff ? 1 : 0);

  if (triggerCount === 0) {
    return {
      dailyBudget: base,
      reason: `Base budget (${base}). No high-opportunity trigger fired.`,
      triggers,
      raised: false,
    };
  }

  // Single trigger → 7 analyses; both/all triggers → max (8).
  const raisedTo = triggerCount >= 2 ? max : Math.min(max, base + 2);
  const why: string[] = [];
  if (triggers.highLiquidity)
    why.push(
      `${input.liquidUnambiguousMarketCount} liquid+unambiguous markets > ${liquidCutoff}`,
    );
  if (triggers.majorScheduledEvent) why.push("major scheduled event today");
  if (triggers.weeklyEdgeAboveCutoff)
    why.push(
      `7d edge ${(input.weeklyRealizedEdgePct * 100).toFixed(2)}% > ${(edgeCutoff * 100).toFixed(2)}%`,
    );

  return {
    dailyBudget: raisedTo,
    reason: `High-opportunity day → budget raised to ${raisedTo}. Triggers: ${why.join("; ")}`,
    triggers,
    raised: true,
  };
}
