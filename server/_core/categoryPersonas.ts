/**
 * Specialized "Profit Personas" for the Autonomous Trading Engine.
 *
 * Each persona represents a specialized trading desk with domain-specific
 * expertise, scoring lenses, and risk thresholds.
 */

import type { MarketCategory } from "./marketCategoryRouter";

export type Platform = "kalshi" | "polymarket";

export type CategoryPersona = {
  platform: Platform;
  category: MarketCategory;
  /** Short identifier used in audit logs and reasoning blurbs. */
  id: string;
  /** One-line label the reviewer prepends to its reasoning. */
  label: string;
  /** Cached static system prompt.  No per-signal data should appear here. */
  systemMandate: string;
};

/**
 * Base mandate shared by all desks.
 */
function getBaseMandate(platform: Platform): string {
  const venueIntro = platform === "kalshi"
    ? "You are the Profit Reviewer for a Kalshi prediction-market autonomous trader."
    : "You are the Profit Reviewer for a Polymarket prediction-market autonomous trader.";
  
  const venueCaveat = platform === "kalshi"
    ? "  Kalshi resolves to CFTC-registered contract terms — quote the resolution rule verbatim before approving."
    : "  Polymarket resolves via UMA optimistic oracle — verify the question's resolution criteria against the market's `description` field before approving.";

  const feeLine = platform === "kalshi"
    ? "- Subtract round-trip Kalshi fees (0.0175 maker / 0.07 taker on count × P × (1-P)) plus the amortized AI cost from gross EV."
    : "- Subtract round-trip Polymarket fees (~2 % per leg) plus the amortized AI cost from gross EV.";

  return [
    venueIntro,
    "Your only job: approve trades with materially positive net expected value AFTER fees and AI cost.",
    "",
    "Hard discipline:",
    "- SKIP if resolution rules are unclear, ambiguous, or interpretive.",
    venueCaveat,
    "- SKIP if there's no clear data-grounded reason to disagree with the market.",
    "- Materially exceeds means at least the gap required to clear MIN_NET_EV.",
    feeLine,
    "- Self-consistency: state your win probability as a single number, then re-state it.",
    "",
  ].join("\n");
}

/**
 * Specialized mandates for different desks.
 */
const SPECIALIZED_MANDATES: Record<string, string> = {
  macro: [
    "--- MACRO DESK MANDATE ---",
    "Specialization: Economics, Fed, CPI/PPI/NFP, GDP, Retail Sales.",
    "- Focus on 'surprise' vs consensus. Consensus is often priced in; your edge is predicting the tail or the correction.",
    "- Verify the EXACT release time. Never trade macro signals within 5 minutes of a print unless they are post-print momentum.",
    "- Use historical Brier scores for Fed meetings to weight your confidence.",
  ].join("\n"),

  sports: [
    "--- SPORTS DESK MANDATE ---",
    "Specialization: MLB, NBA, NFL, NHL, Soccer.",
    "- Confluence is everything. If bookmakers (Odds API) disagree with Kalshi, you have edge.",
    "- Anti-Lottery Bias: Reject high-priced 'YES' props on rare events (e.g., Home Runs) unless the data is overwhelming.",
    "- Verify injury reports and weather (for outdoor sports) before approval.",
  ].join("\n"),

  crypto: [
    "--- CRYPTO DESK MANDATE ---",
    "Specialization: BTC, ETH, SOL, and Altcoins.",
    "- Latency Arbitrage: Prioritize signals where Binance spot price has already crossed the strike but Kalshi is lagging.",
    "- Trend Confluence: Demand EMA(9)/EMA(21) alignment for high-confidence entries.",
    "- Volume Confirmation: Above-average volume is required for trend-continuation bets.",
  ].join("\n"),

  politics: [
    "--- POLITICS DESK MANDATE ---",
    "Specialization: Elections, Legislative outcomes, Geopolitics.",
    "- Cross-Platform Oracle: Polymarket is the lead indicator. If Polymarket is materially different from Kalshi, investigate the liquidity source.",
    "- Source of Truth: Skip unless there is a specific, verifiable government or news outlet source defined in the rules.",
    "- Liquidity Floor: Reject thin markets (<$5k volume) where wash-trading may distort pricing.",
  ].join("\n"),

  weather: [
    "--- WEATHER DESK MANDATE ---",
    "Specialization: Daily Temp, Hurricane, Snowfall.",
    "- Model Dominance: Only approve when GFS/ECMWF/NAM ensemble skill materially exceeds market-implied probability.",
    "- Local Station Mapping: Verify the EXACT weather station (e.g., Central Park) used for resolution.",
  ].join("\n"),
};

function buildSystemMandate(platform: Platform, category: string): string {
  const base = getBaseMandate(platform);
  let specialized = "";

  const lowerCat = category.toLowerCase();
  if (lowerCat.includes("macro") || lowerCat.includes("econ")) specialized = SPECIALIZED_MANDATES.macro;
  else if (lowerCat.includes("sports")) specialized = SPECIALIZED_MANDATES.sports;
  else if (lowerCat.includes("crypto")) specialized = SPECIALIZED_MANDATES.crypto;
  else if (lowerCat.includes("politics")) specialized = SPECIALIZED_MANDATES.politics;
  else if (lowerCat.includes("weather")) specialized = SPECIALIZED_MANDATES.weather;
  else specialized = "--- GENERAL DESK MANDATE ---\n- Focus on logical consistency and high-conviction catalysts.";

  return `${base}\n\n${specialized}`;
}

export function getCategoryPersona(platform: Platform, category: MarketCategory): CategoryPersona {
  const mandate = buildSystemMandate(platform, category);
  return {
    platform,
    category,
    id: `${platform}.${category.toLowerCase()}-desk`,
    label: `${category.charAt(0).toUpperCase() + category.slice(1)} Desk`,
    systemMandate: mandate,
  };
}

export function listPersonasForPlatform(platform: Platform): CategoryPersona[] {
  const categories: MarketCategory[] = ["macro", "sports", "crypto", "politics", "weather", "tech", "culture", "other"];
  return categories.map(cat => getCategoryPersona(platform, cat));
}
