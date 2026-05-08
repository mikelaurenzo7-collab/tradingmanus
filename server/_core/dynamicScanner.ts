/**
 * Dynamic scanner — daily AI-analysis budget controller, capital-aware.
 *
 * Base rule: 5 analyses / day. Bottleneck on Kalshi is signal supply, not
 * reviewer quality, so the BASE rate doesn't scale with capital.
 *
 * Conditional ramp on high-opportunity days. Today qualifies as
 * "high opportunity" if any of:
 *   (a) > SCANNER_HIGH_OPP_LIQUID_MARKETS liquid+unambiguous markets, OR
 *   (b) a major scheduled event (FOMC, CPI/PPI/NFP, election day,
 *       named-storm landfall, scheduled SCOTUS decision day), OR
 *   (c) trailing-week realized edge > SCANNER_HIGH_OPP_WEEKLY_EDGE_PCT.
 *
 * The MAXIMUM ramp scales with live capital so a $5,000 account can
 * actually deploy more reviews on a high-opportunity day than a $200
 * account (whose few small positions don't justify it):
 *
 *   capital ≤ SCANNER_CAP_MID_TIER_USD                  → max  8
 *   SCANNER_CAP_MID_TIER_USD < capital ≤ HIGH_TIER_USD  → max 10
 *   capital > SCANNER_CAP_HIGH_TIER_USD                 → max 12
 *
 * The scanner is a *budget* — the autonomy loop calls `getDailyAnalysisBudget`
 * once per day, then reduces the active-market candidate set to fit. Once
 * the budget is consumed, additional reviews are skipped until UTC rollover.
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
  /** Live Kalshi balance in USD. Drives the capital-tier max ramp. */
  liveCapitalUsd: number;
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
  /** Capital-tier label used to set the max ramp. */
  capitalTier: "low" | "mid" | "high";
}

function maxAnalysesForCapitalTier(liveCapitalUsd: number): {
  max: number;
  tier: "low" | "mid" | "high";
} {
  if (liveCapitalUsd > ENV.scannerCapHighTierUsd) {
    return { max: ENV.scannerMaxAnalysesPerDayHighTier, tier: "high" };
  }
  if (liveCapitalUsd > ENV.scannerCapMidTierUsd) {
    return { max: ENV.scannerMaxAnalysesPerDayMidTier, tier: "mid" };
  }
  return { max: ENV.scannerMaxAnalysesPerDay, tier: "low" };
}

export function getDailyAnalysisBudget(input: ScannerInputs): ScannerDecision {
  const base = ENV.scannerBaseAnalysesPerDay;
  const { max, tier } = maxAnalysesForCapitalTier(input.liveCapitalUsd);
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
      reason: `Base budget (${base}). No high-opportunity trigger fired. Capital tier: ${tier}.`,
      triggers,
      raised: false,
      capitalTier: tier,
    };
  }

  // Single trigger → base + 2; both/all triggers → tier max.
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
    reason: `High-opportunity day → budget raised to ${raisedTo} (capital tier: ${tier}). Triggers: ${why.join("; ")}`,
    triggers,
    raised: true,
    capitalTier: tier,
  };
}
