import axios from "axios";
import { logger } from "./logger";
import { ENV } from "./env";

export interface OddsApiResponse {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: {
    key: string;
    title: string;
    last_update: string;
    markets: {
      key: string;
      last_update: string;
      outcomes: {
        name: string;
        price: number;
        point?: number;
        description?: string;
      }[];
    }[];
  }[];
}

/**
 * The Odds API Client
 * Used to fetch real-world bookmaker odds to use as fundamental priors for sports markets.
 */
export class OddsApiClient {
  private apiKey: string;
  private baseUrl = "https://api.the-odds-api.com/v4/sports";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Fetch odds for a specific sport
   */
  async getOdds(sport: string, regions = "us", markets = "h2h,totals,spreads"): Promise<OddsApiResponse[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/${sport}/odds`, {
        params: {
          apiKey: this.apiKey,
          regions,
          markets,
          oddsFormat: "decimal",
        },
      });
      return response.data;
    } catch (err) {
      logger.error({ err, sport }, "[OddsApi] Failed to fetch odds");
      return [];
    }
  }

  /**
   * Fetch player props for a specific event
   */
  async getPlayerProps(sport: string, eventId: string, propType = "player_points"): Promise<OddsApiResponse | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/${sport}/events/${eventId}/odds`, {
        params: {
          apiKey: this.apiKey,
          regions: "us",
          markets: propType,
          oddsFormat: "decimal",
        },
      });
      return response.data;
    } catch (err) {
      logger.error({ err, eventId, propType }, "[OddsApi] Failed to fetch player props");
      return null;
    }
  }

  /**
   * Attempt to map a Kalshi sports market to an Odds API event and outcome.
   * Returns the implied probability if a match is found.
   */
  async mapKalshiToOddsApi(market: { title: string; category?: string }): Promise<number | null> {
    const title = market.title.toLowerCase();
    
    // 1. Determine the sport and market type
    let sport = "";
    let propType = "";
    
    if (title.includes("nfl") || title.includes("super bowl")) {
      sport = "americanfootball_nfl";
    } else if (title.includes("nba")) {
      sport = "basketball_nba";
    } else if (title.includes("mlb")) {
      sport = "baseball_mlb";
    } else if (title.includes("nhl")) {
      sport = "icehockey_nhl";
    }
    
    if (!sport) return null;

    // 2. Identify common prop patterns
    if (title.includes("points")) propType = "player_points";
    else if (title.includes("rebounds")) propType = "player_rebounds";
    else if (title.includes("assists")) propType = "player_assists";
    else if (title.includes("home run")) propType = "player_home_runs";
    else if (title.includes("strikeouts")) propType = "player_strikeouts";
    else if (title.includes("touchdown")) propType = "player_anytime_td";
    
    // 3. Fetch events for the sport
    const events = await this.getOdds(sport, "us", propType || "h2h");
    if (events.length === 0) return null;

    // 4. Try to find a matching event by team names in the title
    for (const event of events) {
      const homeMatch = title.includes(event.home_team.toLowerCase());
      const awayMatch = title.includes(event.away_team.toLowerCase());
      
      if (homeMatch || awayMatch) {
        // Found a potential event match. Now look for the specific outcome.
        // For simplicity in this iteration, we look for player name matches.
        for (const bookmaker of event.bookmakers) {
          for (const m of bookmaker.markets) {
            for (const outcome of m.outcomes) {
              const playerName = outcome.description || outcome.name;
              if (playerName && title.includes(playerName.toLowerCase())) {
                // Potential player match. Check if the line matches (e.g., "over 25.5")
                const match = title.match(/(\d+\.?\d*)/);
                if (match) {
                  const kalshiLine = parseFloat(match[1]);
                  const oddsLine = outcome.point;
                  
                  if (oddsLine !== undefined && Math.abs(kalshiLine - oddsLine) < 0.1) {
                    // Match found! Return implied probability
                    return decimalToProbability(outcome.price);
                  }
                }
              }
            }
          }
        }
      }
    }

    return null;
  }
}

/**
 * Convert decimal odds to implied probability
 */
export function decimalToProbability(decimal: number): number {
  if (decimal <= 0) return 0.5;
  return 1 / decimal;
}

/**
 * Average implied probability across bookmakers for a specific outcome
 */
export function calculateAverageProbability(event: OddsApiResponse, marketKey: string, outcomeName: string): number | null {
  const probabilities: number[] = [];

  for (const bookmaker of event.bookmakers) {
    const market = bookmaker.markets.find((m) => m.key === marketKey);
    if (!market) continue;

    const outcome = market.outcomes.find((o) => o.name === outcomeName);
    if (outcome) {
      probabilities.push(decimalToProbability(outcome.price));
    }
  }

  if (probabilities.length === 0) return null;
  return probabilities.reduce((a, b) => a + b, 0) / probabilities.length;
}

/**
 * Singleton instance using the user-provided API key from ENV if available
 */
let oddsClientInstance: OddsApiClient | null = null;

export function getOddsClient(): OddsApiClient | null {
  if (oddsClientInstance) return oddsClientInstance;
  
  const apiKey = ENV.oddsApiKey || "b5ddfc0af8e39668db82af26c53d33e0";
  if (!apiKey) {
    logger.warn("[OddsApi] No API key available in ENV.oddsApiKey");
    return null;
  }
  
  oddsClientInstance = new OddsApiClient(apiKey);
  return oddsClientInstance;
}
