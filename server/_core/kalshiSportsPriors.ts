/**
 * Kalshi Sports Player Prop Prior Model
 *
 * Provides empirical base-rate priors for sports player prop markets.
 *
 * Retail bettors on prediction markets have a massive "lottery ticket" bias,
 * often pricing "Yes" on rare events (Home Runs, Triple Doubles) at 30-45%
 * when the true empirical probability is 10-20%.
 *
 * This model detects these market types and provides a calibrated prior
 * so the existing value-play pipeline (detectValueOpportunity) can correctly
 * identify "No" opportunities when the market is over-priced.
 *
 * Calibration data:
 * - MLB Home Run: Average ~18% per game for top-tier sluggers.
 * - MLB 2+ Hits: ~22% for top-tier contact hitters.
 * - NBA Triple Double: <10% except for 2-3 specific players.
 * - NBA 30+ Points: ~15% for stars.
 */

export type SportsPropType =
  | "mlb_home_run"
  | "mlb_hits_2plus"
  | "nba_points_30plus"
  | "nba_triple_double"
  | "nfl_touchdown_anytime";

interface SportsPropRule {
  type: SportsPropType;
  patterns: string[];
  baseRate: number;
}

const PROP_RULES: SportsPropRule[] = [
  {
    type: "mlb_home_run",
    patterns: ["record 1+ home run", "hit 1+ home run", "hit a home run"],
    baseRate: 0.18, // Top slugger average
  },
  {
    type: "mlb_hits_2plus",
    patterns: ["record 2+ hits", "have 2+ hits", "get 2+ hits"],
    baseRate: 0.22, // Top contact hitter average
  },
  {
    type: "nba_points_30plus",
    patterns: ["score 30+ points", "record 30+ points"],
    baseRate: 0.25, // Star player average
  },
  {
    type: "nba_triple_double",
    patterns: ["record a triple-double", "have a triple-double"],
    baseRate: 0.08, // General star average (excluding Joker/Luka)
  },
  {
    type: "nfl_touchdown_anytime",
    patterns: ["score 1+ touchdown", "record 1+ touchdown", "anytime touchdown"],
    baseRate: 0.35, // Lead back / WR1 average
  },
];

/**
 * Normalise title for matching
 */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9+]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Detect sports prop type from market title
 */
export function classifySportsPropMarket(title: string): SportsPropType | null {
  const lower = normalise(title);
  for (const rule of PROP_RULES) {
    if (rule.patterns.some(p => lower.includes(p))) {
      return rule.type;
    }
  }
  return null;
}

/**
 * Resolve a sports-specific fundamental prior for a market.
 * Returns the base rate if matched, else null.
 */
export function lookupSportsPrior(market: { title: string }): number | null {
  const type = classifySportsPropMarket(market.title);
  if (!type) return null;

  const rule = PROP_RULES.find(r => r.type === type);
  return rule ? rule.baseRate : null;
}
