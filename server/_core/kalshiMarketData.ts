/**
 * Kalshi Market Data Adapter
 * Fetches real-time market data from Kalshi prediction markets API
 */

export interface KalshiMarket {
  id: string;
  title: string;
  category: string;
  description: string;
  resolutionDate: string;
  status: "open" | "closed" | "resolved";
  yesPrice: number;
  noPrice: number;
  yesVolume: number;
  noVolume: number;
  impliedProbability: number;
}

export interface KalshiOrderBook {
  market_id: string;
  yes_price: number;
  no_price: number;
  yes_volume: number;
  no_volume: number;
}

const KALSHI_API_BASE = "https://api.elections.kalshi.com/trade-api/v2";

/**
 * Fetch all Kalshi markets
 */
export async function fetchKalshiMarkets(filters?: {
  category?: string;
  status?: "open" | "closed" | "resolved";
}): Promise<KalshiMarket[]> {
  try {
    const params = new URLSearchParams();
    if (filters?.category) params.append("category", filters.category);
    if (filters?.status) params.append("status", filters.status);

    const url = `${KALSHI_API_BASE}/markets?${params.toString()}`;
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(`[Kalshi] API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return (data.markets || []).map((m: any) => ({
      id: m.id,
      title: m.title,
      category: m.category,
      description: m.description,
      resolutionDate: m.resolution_date,
      status: m.status,
      yesPrice: m.yes_price,
      noPrice: m.no_price,
      yesVolume: m.yes_volume,
      noVolume: m.no_volume,
      impliedProbability: calculateImpliedProbability(Number(m.yes_price ?? 0), Number(m.no_price ?? 0)),
    }));
  } catch (error) {
    console.error("[Kalshi] Market fetch failed:", error);
    return [];
  }
}

/**
 * Fetch specific market details and order book
 */
export async function fetchKalshiMarketDetails(marketId: string): Promise<KalshiMarket | null> {
  try {
    const url = `${KALSHI_API_BASE}/markets/${marketId}`;
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(`[Kalshi] Market details error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const m = data.market;
    return {
      id: m.id,
      title: m.title,
      category: m.category,
      description: m.description,
      resolutionDate: m.resolution_date,
      status: m.status,
      yesPrice: m.yes_price,
      noPrice: m.no_price,
      yesVolume: m.yes_volume,
      noVolume: m.no_volume,
      impliedProbability: calculateImpliedProbability(Number(m.yes_price ?? 0), Number(m.no_price ?? 0)),
    };
  } catch (error) {
    console.error(`[Kalshi] Market details fetch failed for ${marketId}:`, error);
    return null;
  }
}

/**
 * Fetch markets by category (Politics, Sports, Economics, etc.)
 */
export async function fetchKalshiMarketsByCategory(category: string): Promise<KalshiMarket[]> {
  return fetchKalshiMarkets({ category, status: "open" });
}

/**
 * Calculate implied probability from yes/no prices
 */
export const getKalshiMarketDetails = fetchKalshiMarketDetails;

export function calculateImpliedProbability(yesPrice: number, noPrice: number): number {
  const total = yesPrice + noPrice;
  if (total === 0) return 0.5;
  return yesPrice / total;
}

/**
 * Calculate expected value for a trade
 * EV = (Probability of Win * Profit) - (Probability of Loss * Loss)
 */
export function calculateExpectedValue(
  side: "yes" | "no",
  entryPrice: number,
  currentPrice: number,
  quantity: number,
  impliedProbability: number
): number {
  const probWin = side === "yes" ? impliedProbability : 1 - impliedProbability;
  const probLoss = 1 - probWin;

  const profit = (1 - entryPrice) * quantity;
  const loss = entryPrice * quantity;

  return probWin * profit - probLoss * loss;
}

/**
 * Detect value opportunities (mispriced markets)
 */
export function detectValueOpportunity(
  market: KalshiMarket,
  fundamentalProbability: number,
  threshold: number = 0.05
): { side: "yes" | "no"; expectedValue: number } | null {
  const marketProbability = market.impliedProbability;
  const diff = Math.abs(marketProbability - fundamentalProbability);

  if (diff > threshold) {
    if (fundamentalProbability > marketProbability) {
      // YES is underpriced
      return {
        side: "yes",
        expectedValue: calculateExpectedValue("yes", market.yesPrice, 1, 1, fundamentalProbability),
      };
    } else {
      // NO is underpriced
      return {
        side: "no",
        expectedValue: calculateExpectedValue("no", market.noPrice, 0, 1, fundamentalProbability),
      };
    }
  }

  return null;
}

/**
 * Detect momentum opportunities (strong directional moves)
 */
export function detectMomentumOpportunity(
  market: KalshiMarket,
  priceHistory: Array<{ price: number; timestamp: number }>
): { side: "yes" | "no"; confidence: number } | null {
  if (priceHistory.length < 2) return null;

  const recent = priceHistory.slice(-5);
  const avgPrice = recent.reduce((sum, p) => sum + p.price, 0) / recent.length;
  const currentPrice = market.impliedProbability;

  const momentum = (currentPrice - avgPrice) / avgPrice;
  const confidence = Math.min(Math.abs(momentum) * 2, 1);

  if (Math.abs(momentum) > 0.02 && confidence > 0.3) {
    return {
      side: momentum > 0 ? "yes" : "no",
      confidence,
    };
  }

  return null;
}

/**
 * Detect contrarian opportunities (reversal signals)
 */
export function detectContrarianOpportunity(
  market: KalshiMarket,
  extremeThreshold: number = 0.1
): { side: "yes" | "no"; confidence: number } | null {
  const prob = market.impliedProbability;

  // Extreme YES (>90%) or extreme NO (<10%)
  if (prob > 1 - extremeThreshold) {
    return { side: "no", confidence: (prob - (1 - extremeThreshold)) / extremeThreshold };
  }
  if (prob < extremeThreshold) {
    return { side: "yes", confidence: (extremeThreshold - prob) / extremeThreshold };
  }

  return null;
}
