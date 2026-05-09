/**
 * Single Grok persona — used regardless of category in legacy
 * Grok-as-primary mode (REVIEWER_PREFER_GROK=true or no
 * ANTHROPIC_API_KEY). Mirrors the categoryPersonas single-persona
 * collapse so both providers carry the same Profit-Reviewer mandate.
 *
 * Earlier this file held 8 category-specific personas across Kalshi
 * (sports, crypto, politics, economics, tech, culture, weather, other).
 * Collapsed to one for the same reasons categoryPersonas was: at
 * single-owner scale, persona specialization is over-engineered and
 * makes calibration harder.
 *
 * The (Platform, MarketCategory) lookup signature is preserved so
 * callers compile unchanged.
 */

import type { MarketCategory } from "./marketCategoryRouter";

export type Platform = "kalshi";

export type GrokPersona = {
  platform: Platform;
  category: MarketCategory;
  id: string;
  label: string;
  systemMandate: string;
  /** Priority tier kept for back-compat with callers that filter on it.
   *  All categories ship at priority 1 in the single-persona collapse. */
  priorityTier: 1 | 2 | 3 | 4;
};

const PROFIT_PERSONA_MANDATE = [
  "You are the Profit Reviewer for a Kalshi prediction-market autonomous trader.",
  "Your only job: approve trades with materially positive net expected value AFTER",
  "Kalshi fees and amortized AI cost. Reject everything that doesn't clear that bar.",
  "",
  "Hard discipline:",
  "- SKIP if resolution rules are unclear, ambiguous, or interpretive. Never trade",
  "  what you can't grade. Use the verbatim rules in the user prompt — that block",
  "  starts with `${RULES_BLOCK}`.",
  "- SKIP if there's no clear data-grounded reason to disagree with the market.",
  "  'Vibes' are not edge.",
  "- For YES contracts at price P, your win-probability estimate must materially",
  "  exceed P; for NO contracts, your loss-probability estimate must materially",
  "  exceed (1 - P). 'Materially' means at least the gap required to clear",
  "  MIN_NET_EV after fees + AI cost.",
  "- Subtract round-trip Kalshi fees (0.0175 maker / 0.07 taker on count × P × (1-P),",
  "  rounded up to the cent) plus the amortized AI cost from gross EV before",
  "  reporting expectedValueAdjustment.",
  "- Position sizing is ½ Kelly clamped to 0.5 %–5 % of live capital — never approve",
  "  a trade your sizing model can't fund within those caps.",
  "",
  "Self-consistency: state your win probability as a single number, then re-state",
  "it. If you can't write it twice without changing your mind, you don't have edge.",
  "",
  "Output: a single JSON verdict matching the schema. No prose outside JSON.",
].join("\n");

const PROFIT_GROK_PERSONA: GrokPersona = {
  platform: "kalshi",
  category: "other",
  id: "grok.profit-reviewer",
  label: "Profit Reviewer",
  systemMandate: PROFIT_PERSONA_MANDATE,
  priorityTier: 1,
};

export function getGrokPersona(
  _platform: Platform,
  _category: MarketCategory,
): GrokPersona {
  return PROFIT_GROK_PERSONA;
}

export function listGrokPersonasForPlatform(
  _platform: Platform,
): GrokPersona[] {
  return [PROFIT_GROK_PERSONA];
}

/** Substitute the verbatim resolution-rules text into the persona's
 *  ${RULES_BLOCK} placeholder. Kept as a no-op style helper for any
 *  callers that still rely on it; the single-persona mandate doesn't
 *  template per-market because that breaks prompt caching. */
export function injectVerbatimRulesBlock(mandate: string, _rulesText: string): string {
  return mandate;
}
