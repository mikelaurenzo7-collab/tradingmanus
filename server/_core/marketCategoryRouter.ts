/**
 * Market category router.
 *
 * Classifies a Kalshi or Polymarket market into one of a small set of
 * domains so the AI reviewer can dispatch each candidate to a domain-expert
 * persona (sports book, crypto desk, political analyst, etc).
 *
 * The classifier is intentionally deterministic and self-contained — no LLM
 * call — so it adds zero latency to the autonomy loop and stays cheap to
 * run on every candidate.  Categories are chosen from the union of tags we
 * actually observe on Kalshi/Polymarket.
 */

export type MarketCategory =
  | "sports"
  | "crypto"
  | "politics"
  | "economics"
  | "tech"
  | "culture"
  | "weather"
  | "other";

export const MARKET_CATEGORIES: MarketCategory[] = [
  "sports",
  "crypto",
  "politics",
  "economics",
  "tech",
  "culture",
  "weather",
  "other",
];

type CategoryRule = {
  category: MarketCategory;
  /** Kalshi/Polymarket category tag substrings (case-insensitive). */
  categoryTokens: string[];
  /** Substrings that frequently appear inside the market title/question. */
  titleTokens: string[];
};

const RULES: CategoryRule[] = [
  {
    category: "sports",
    categoryTokens: [
      "sport",
      "nfl",
      "nba",
      "nhl",
      "mlb",
      "ncaa",
      "soccer",
      "tennis",
      "golf",
      "ufc",
      "mma",
      "boxing",
      "f1",
      "racing",
    ],
    titleTokens: [
      "win the",
      "championship",
      "super bowl",
      "world series",
      "stanley cup",
      "final",
      "playoff",
      "vs.",
      " vs ",
      "tournament",
      "match",
    ],
  },
  {
    category: "crypto",
    categoryTokens: [
      "crypto",
      "bitcoin",
      "ethereum",
      "btc",
      "eth",
      "defi",
      "stablecoin",
      "blockchain",
    ],
    titleTokens: [
      "bitcoin",
      "ethereum",
      "btc",
      "eth",
      "solana",
      "xrp",
      "doge",
      "stablecoin",
      "halving",
      "etf approval",
      "mainnet",
      "fork",
    ],
  },
  {
    category: "politics",
    categoryTokens: [
      "politic",
      "election",
      "president",
      "congress",
      "senate",
      "house",
      "governor",
      "primary",
      "policy",
      "scotus",
      "court",
    ],
    titleTokens: [
      "president",
      "election",
      "primary",
      "senate",
      "house seat",
      "governor",
      "impeach",
      "indict",
      "supreme court",
      "speaker",
      "ballot",
    ],
  },
  {
    category: "economics",
    categoryTokens: [
      "econom",
      "finance",
      "macro",
      "fed",
      "rate",
      "cpi",
      "inflation",
      "jobs",
      "gdp",
      "earnings",
    ],
    titleTokens: [
      "fed",
      "rate cut",
      "rate hike",
      "cpi",
      "inflation",
      "jobs report",
      "unemployment",
      "gdp",
      "recession",
      "earnings",
      "fomc",
    ],
  },
  {
    category: "tech",
    categoryTokens: [
      "tech",
      "ai",
      "artificial intelligence",
      "science",
      "space",
      "tesla",
      "openai",
      "nvidia",
      "google",
      "microsoft",
      "apple",
    ],
    titleTokens: [
      "openai",
      "anthropic",
      "gpt",
      "claude",
      "llm",
      "chip",
      "tesla",
      "spacex",
      "starship",
      "iphone",
      "launch",
      "release",
    ],
  },
  {
    category: "culture",
    categoryTokens: [
      "entertainment",
      "culture",
      "music",
      "film",
      "movie",
      "tv",
      "celebrity",
      "award",
      "oscar",
      "grammy",
      "emmy",
    ],
    titleTokens: [
      "oscar",
      "grammy",
      "emmy",
      "billboard",
      "box office",
      "streaming",
      "album",
      "tour",
      "song of the year",
    ],
  },
  {
    category: "weather",
    categoryTokens: ["weather", "climate", "hurricane", "storm", "temperature"],
    titleTokens: ["hurricane", "tornado", "snowfall", "temperature", "category 4", "category 5"],
  },
];

function normalize(value: string | undefined | null): string {
  return (value ?? "").toLowerCase();
}

function ruleMatchScore(rule: CategoryRule, category: string, title: string): number {
  let score = 0;
  for (const token of rule.categoryTokens) {
    if (category.includes(token)) score += 3;
  }
  for (const token of rule.titleTokens) {
    if (title.includes(token)) score += 1;
  }
  return score;
}

export type ClassifiableMarket = {
  category?: string | null;
  title?: string | null;
  question?: string | null;
};

export function classifyMarketCategory(market: ClassifiableMarket): MarketCategory {
  const category = normalize(market.category);
  const title = normalize(market.title ?? market.question);

  let bestCategory: MarketCategory = "other";
  let bestScore = 0;

  for (const rule of RULES) {
    const score = ruleMatchScore(rule, category, title);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = rule.category;
    }
  }

  return bestScore > 0 ? bestCategory : "other";
}

/**
 * Group an arbitrary list of markets/signals by category.  The selector
 * pulls the classifiable fields off each item so this works for both
 * KalshiMarket and PolymarketMarket without coupling.
 */
export function groupByCategory<T>(
  items: T[],
  selectMarket: (item: T) => ClassifiableMarket,
): Map<MarketCategory, T[]> {
  const buckets = new Map<MarketCategory, T[]>();
  for (const item of items) {
    const category = classifyMarketCategory(selectMarket(item));
    const bucket = buckets.get(category);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(category, [item]);
    }
  }
  return buckets;
}
