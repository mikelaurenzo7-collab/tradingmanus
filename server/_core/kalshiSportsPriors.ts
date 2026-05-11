/**
 * Kalshi Sports Player Prop Prior Model
 *
 * Provides empirical base-rate priors and live bookmaker odds for sports markets.
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
  | "mlb_hits_1plus"
  | "mlb_strikeouts_5plus"
  | "mlb_strikeouts_7plus"
  | "nba_points_10plus"
  | "nba_points_20plus"
  | "nba_points_30plus"
  | "nba_triple_double"
  | "nba_double_double"
  | "nba_rebounds_5plus"
  | "nba_rebounds_10plus"
  | "nba_assists_5plus"
  | "nba_assists_10plus"
  | "nfl_touchdown_anytime"
  | "nfl_pass_yds_250plus"
  | "nfl_pass_yds_300plus"
  | "nfl_rush_yds_50plus"
  | "nfl_rec_yds_50plus"
  | "nhl_points_1plus"
  | "nhl_goals_1plus"
  | "soccer_goal_anytime";

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
    type: "mlb_hits_1plus",
    patterns: ["record 1+ hits", "have 1+ hits", "get 1+ hits", "record a hit"],
    baseRate: 0.64, // Lead-off / top order average
  },
  {
    type: "mlb_hits_2plus",
    patterns: ["record 2+ hits", "have 2+ hits", "get 2+ hits"],
    baseRate: 0.22, // Top contact hitter average
  },
  {
    type: "mlb_strikeouts_5plus",
    patterns: ["record 5+ strikeouts", "have 5+ strikeouts", "get 5+ strikeouts"],
    baseRate: 0.55, // SP average
  },
  {
    type: "mlb_strikeouts_7plus",
    patterns: ["record 7+ strikeouts", "have 7+ strikeouts", "get 7+ strikeouts"],
    baseRate: 0.28, // High-K SP average
  },
  {
    type: "nba_points_10plus",
    patterns: ["score 10+ points", "record 10+ points"],
    baseRate: 0.88, // Starter average
  },
  {
    type: "nba_points_20plus",
    patterns: ["score 20+ points", "record 20+ points"],
    baseRate: 0.42, // Star/Scorer average
  },
  {
    type: "nba_points_30plus",
    patterns: ["score 30+ points", "record 30+ points"],
    baseRate: 0.15, // Elite scorer average (consistent with star baseline)
  },
  {
    type: "nba_triple_double",
    patterns: ["record a triple-double", "have a triple-double"],
    baseRate: 0.06, // General star average (updated down from 0.08)
  },
  {
    type: "nba_double_double",
    patterns: ["record a double-double", "have a double-double"],
    baseRate: 0.28, // Above average starter (updated from 0.25)
  },
  {
    type: "nba_rebounds_5plus",
    patterns: ["record 5+ rebounds", "have 5+ rebounds", "get 5+ rebounds"],
    baseRate: 0.72,
  },
  {
    type: "nba_rebounds_10plus",
    patterns: ["record 10+ rebounds", "have 10+ rebounds", "get 10+ rebounds"],
    baseRate: 0.22,
  },
  {
    type: "nba_assists_5plus",
    patterns: ["record 5+ assists", "have 5+ assists", "get 5+ assists"],
    baseRate: 0.58,
  },
  {
    type: "nba_assists_10plus",
    patterns: ["record 10+ assists", "have 10+ assists", "get 10+ assists"],
    baseRate: 0.18,
  },
  {
    type: "nfl_touchdown_anytime",
    patterns: ["score 1+ touchdown", "record 1+ touchdown", "anytime touchdown"],
    baseRate: 0.32, // Lead back / WR1 average (updated from 0.35)
  },
  {
    type: "nfl_rush_yds_50plus",
    patterns: ["record 50+ rushing yards", "rushing yards over 50", "get 50+ rushing yards"],
    baseRate: 0.62, // RB1 average
  },
  {
    type: "nfl_rec_yds_50plus",
    patterns: ["record 50+ receiving yards", "receiving yards over 50", "get 50+ receiving yards"],
    baseRate: 0.58, // WR1/WR2 average
  },
  {
    type: "nfl_pass_yds_250plus",
    patterns: ["throw for 250+ yards", "record 250+ passing yards", "250+ passing yards"],
    baseRate: 0.45,
  },
  {
    type: "nfl_pass_yds_300plus",
    patterns: ["throw for 300+ yards", "record 300+ passing yards", "300+ passing yards"],
    baseRate: 0.18, // Top tier QB average
  },
  {
    type: "nhl_points_1plus",
    patterns: ["record 1+ points", "have 1+ points", "get 1+ points"],
    baseRate: 0.65, // Top line forward
  },
  {
    type: "nhl_goals_1plus",
    patterns: ["score 1+ goals", "record 1+ goals", "anytime goalscorer"],
    baseRate: 0.25, // Top line forward
  },
  {
    type: "soccer_goal_anytime",
    patterns: ["score 1+ goals", "score a goal", "anytime goalscorer"],
    baseRate: 0.25, // Striker
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
export function lookupSportsPrior(market: { title: string }, liveOdds?: Map<string, number>): number | null {
  // If we have a high-confidence live prior from a bookmaker (Odds API),
  // prefer it over the static empirical base rate.
  if (liveOdds && liveOdds.has(market.title)) {
    return liveOdds.get(market.title)!;
  }

  const type = classifySportsPropMarket(market.title);
  if (!type) return null;

  const rule = PROP_RULES.find(r => r.type === type);
  return rule ? rule.baseRate : null;
}

