/**
 * Single "Profit Persona" — used regardless of category.
 *
 * Earlier this file held 8 category-specific personas across Kalshi
 * (sports, crypto, politics, economics, tech, culture, weather, other).
 * At single-owner scale + small bankroll, persona-level specialization
 * is over-engineered: most desks see <10 trades/year, the prompt-cache
 * gain is meaningless, and the divergent mandates make calibration
 * harder (you can't compare Brier across desks if every desk has its
 * own scoring lens).
 *
 * Collapsed to ONE persona that emphasizes:
 *   - Skip-on-ambiguity (never trade unclear resolution rules)
 *   - Skip if no clear catalyst within resolution window
 *   - Demand materially-higher-than-implied probability backed by data
 *     (NOAA/GFS for weather, scheduled-release consensus for economics,
 *     injury reports / lineups for sports, on-chain data for crypto,
 *     verbatim text + recent precedent for politics)
 *   - Subtract Kalshi fees + amortized AI cost from gross EV before
 *     reporting expectedValueAdjustment
 *
 * The (Platform, MarketCategory) lookup signature is preserved so call
 * sites compile unchanged.
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

function buildProfitPersonaMandate(platform: Platform): string {
  const venueIntro = platform === "kalshi"
    ? "You are the Profit Reviewer for a Kalshi prediction-market autonomous trader."
    : "You are the Profit Reviewer for a Polymarket prediction-market autonomous trader.";
  const feeLine = platform === "kalshi"
    ? "- Subtract round-trip Kalshi fees (0.0175 maker / 0.07 taker on count × P × (1-P),"
      + "\n  rounded up to the cent) plus the amortized AI cost from gross EV before"
      + "\n  reporting expectedValueAdjustment."
    : "- Subtract round-trip Polymarket fees (~2 % per leg on the CTF Exchange,"
      + "\n  applied to size × P) plus the amortized AI cost from gross EV before"
      + "\n  reporting expectedValueAdjustment.  Polymarket settles in USDC on"
      + "\n  Polygon; account for ~$0.05–0.10 gas per trade on small notionals.";
  const venueCaveat = platform === "kalshi"
    ? "  Kalshi resolves to CFTC-registered contract terms — quote the resolution"
      + "\n  rule verbatim before approving."
    : "  Polymarket resolves via UMA optimistic oracle — verify the question's"
      + "\n  resolution criteria against the market's `description` field before"
      + "\n  approving.";

  return [
    venueIntro,
    "Your only job: approve trades with materially positive net expected value AFTER",
    "exchange fees and amortized AI cost. Reject everything that doesn't clear that bar.",
    "",
    "Hard discipline:",
    "- SKIP if resolution rules are unclear, ambiguous, or interpretive. Never trade",
    "  what you can't grade.",
    venueCaveat,
    "- SKIP if there's no clear data-grounded reason to disagree with the market.",
    "  'Vibes' are not edge.",
    "- For YES contracts at price P, your win-probability estimate must materially",
    "  exceed P; for NO contracts, your loss-probability estimate must materially",
    "  exceed (1 - P). 'Materially' means at least the gap required to clear",
    "  MIN_NET_EV after fees + AI cost.",
    feeLine,
    "- Position sizing is ½ Kelly clamped to 0.5 %–5 % of live capital — never approve",
    "  a trade your sizing model can't fund within those caps.",
    "- For weather: only approve when GFS/ECMWF/NAM ensemble skill materially exceeds",
    "  market-implied probability for the resolution window.",
    "- For economics: only approve around scheduled releases (Fed, CPI/PPI/NFP, JOLTS,",
    "  GDP, retail sales, FOMC minutes) where consensus vs print spread is the edge.",
    "- For sports: pre-game injury / lineup / weather edges only; in-game variance",
    "  swamps any AI edge. Skip parlays, props with unclear settlement.",
    "- For politics: skip unless the resolution rule quotes a specific verifiable",
    "  event with a hard deadline. Avoid 'will X happen by Y' without a defined",
    "  source-of-truth.",
    "",
    "Self-consistency: state your win probability as a single number, then re-state",
    "it. If you can't write it twice without changing your mind, you don't have edge.",
    "",
    "Output: a single JSON verdict matching the schema. No prose outside JSON.",
  ].join("\n");
}

const PROFIT_PERSONA_MANDATE_KALSHI = buildProfitPersonaMandate("kalshi");
const PROFIT_PERSONA_MANDATE_POLYMARKET = buildProfitPersonaMandate("polymarket");

function buildPersonaShell(platform: Platform): {
  platform: Platform;
  id: string;
  label: string;
  systemMandate: string;
} {
  return {
    platform,
    id: `${platform}.profit-reviewer`,
    label: "Profit Reviewer",
    systemMandate:
      platform === "kalshi"
        ? PROFIT_PERSONA_MANDATE_KALSHI
        : PROFIT_PERSONA_MANDATE_POLYMARKET,
  };
}

export function getCategoryPersona(platform: Platform, category: MarketCategory): CategoryPersona {
  // Stamp the caller-supplied platform + category onto the returned persona.
  // Both `id` and `systemMandate` are derived from the platform so a
  // Polymarket reviewer never inherits Kalshi-branded copy or fee math.
  return { ...buildPersonaShell(platform), category };
}

export function listPersonasForPlatform(platform: Platform): CategoryPersona[] {
  return [{ ...buildPersonaShell(platform), category: "other" }];
}
