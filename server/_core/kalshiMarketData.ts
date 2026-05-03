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

function cleanText(value: unknown, fallback: string, maxLength: number): string {
  const normalized = typeof value === "string" ? value.trim() : String(value ?? fallback).trim();
  const base = normalized.length > 0 ? normalized : fallback;
  return base.slice(0, maxLength);
}

function looksLikeCompositeMarket(rawMarket: any, id: string, normalizedTitle: string): boolean {
  const joinedSignals = [
    id,
    rawMarket?.ticker,
    rawMarket?.market_id,
    rawMarket?.event_ticker,
    rawMarket?.series_ticker,
    rawMarket?.category,
    normalizedTitle,
    rawMarket?.subtitle,
  ]
    .filter(Boolean)
    .map((value) => String(value).toUpperCase())
    .join(" ");

  if (
    joinedSignals.includes("KXMVE") ||
    joinedSignals.includes("CROSSCATEGORY") ||
    joinedSignals.includes("MULTIVARIATE") ||
    rawMarket?.multivariate === true
  ) {
    return true;
  }

  const lowerTitle = normalizedTitle.toLowerCase();
  const hasCompositeJoiners = normalizedTitle.includes(",") || normalizedTitle.includes(";");
  const looksLikeLegList = lowerTitle.startsWith("yes ") || lowerTitle.startsWith("no ");

  return hasCompositeJoiners && looksLikeLegList;
}

function parseDollarValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function mapMarketStatus(status: unknown): "open" | "closed" | "resolved" {
  switch (status) {
    case "settled":
      return "resolved";
    case "closed":
      return "closed";
    case "paused":
    case "initialized":
    case "unopened":
    case "open":
    default:
      return "open";
  }
}

function normalizeKalshiMarket(rawMarket: any): KalshiMarket | null {
  const id = cleanText(rawMarket.id ?? rawMarket.marketId ?? rawMarket.market_id ?? rawMarket.ticker, "unknown-market", 128);
  const normalizedTitle = cleanText(rawMarket.title ?? rawMarket.subtitle ?? id, id, 255);

  if (looksLikeCompositeMarket(rawMarket, id, normalizedTitle)) {
    return null;
  }

  const yesPrice = parseDollarValue(
    rawMarket.yesPrice ??
      rawMarket.yes_price ??
      rawMarket.last_price_dollars ??
      rawMarket.yes_ask_dollars ??
      rawMarket.yes_bid_dollars
  );
  const noPrice = parseDollarValue(
    rawMarket.noPrice ??
      rawMarket.no_price ??
      rawMarket.no_ask_dollars ??
      rawMarket.no_bid_dollars ??
      (yesPrice > 0 ? 1 - yesPrice : 0)
  );
  const totalVolume = parseDollarValue(rawMarket.volume_fp ?? rawMarket.volume ?? 0);
  const yesVolume = parseDollarValue(rawMarket.yesVolume ?? rawMarket.yes_volume ?? totalVolume / 2);
  const noVolume = parseDollarValue(rawMarket.noVolume ?? rawMarket.no_volume ?? totalVolume / 2);

  return {
    id,
    title: normalizedTitle,
    category: cleanText(rawMarket.category ?? rawMarket.series_ticker ?? rawMarket.event_ticker ?? "general", "general", 128),
    description: cleanText(rawMarket.description ?? rawMarket.subtitle ?? rawMarket.rules_primary ?? "", "", 2000),
    resolutionDate:
      rawMarket.resolutionDate ??
      rawMarket.resolution_date ??
      rawMarket.close_time ??
      rawMarket.expiration_time ??
      rawMarket.latest_expiration_time ??
      new Date().toISOString(),
    status: mapMarketStatus(rawMarket.status),
    yesPrice,
    noPrice,
    yesVolume,
    noVolume,
    impliedProbability: calculateImpliedProbability(yesPrice, noPrice),
  };
}

function isDisplaySafeActionableMarket(market: KalshiMarket): boolean {
  const normalizedTitle = market.title.trim();
  const lowerTitle = normalizedTitle.toLowerCase();
  const hasCompositeJoiners = normalizedTitle.includes(",") || normalizedTitle.includes(";");
  const looksLikeLegList = lowerTitle.startsWith("yes ") || lowerTitle.startsWith("no ");
  const hasReadableTitle = normalizedTitle.length >= 8 && normalizedTitle.length <= 140;
  const hasNamedCategory = Boolean(market.category && market.category !== "general");

  return hasReadableTitle && hasNamedCategory && !hasCompositeJoiners && !looksLikeLegList;
}

function getMarketActionabilityScore(market: KalshiMarket): number {
  const totalVolume = Math.max(0, market.yesVolume + market.noVolume);
  const hasBoundedPricing =
    market.yesPrice > 0.01 &&
    market.yesPrice < 0.99 &&
    market.noPrice > 0.01 &&
    market.noPrice < 0.99 &&
    market.impliedProbability > 0.01 &&
    market.impliedProbability < 0.99;

  const volumeScore = Math.min(1, totalVolume / 500);
  const balanceScore = 1 - Math.min(1, Math.abs(market.impliedProbability - 0.5) / 0.5);
  const displaySafetyScore = isDisplaySafeActionableMarket(market) ? 1 : 0;

  return (hasBoundedPricing ? 1 : 0) * 2 + displaySafetyScore * 1.5 + volumeScore + balanceScore * 0.25;
}

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
    params.append("mve_filter", "exclude");
    params.append("limit", "200");

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
    return (data.markets || [])
      .map((market: any) => normalizeKalshiMarket(market))
      .filter((market: KalshiMarket | null): market is KalshiMarket => Boolean(market?.id))
      .filter((market: KalshiMarket) => isDisplaySafeActionableMarket(market))
      .sort((a: KalshiMarket, b: KalshiMarket) => getMarketActionabilityScore(b) - getMarketActionabilityScore(a));
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
    const market = data.market ?? data;
    const normalized = normalizeKalshiMarket(market);
    return normalized && isDisplaySafeActionableMarket(normalized) ? normalized : null;
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
 * Kalshi fee rate.  Kalshi's published fee schedule charges
 * `ceil(0.07 * C * P * (1 - P) * 100)` cents per trade where
 * P is the price in dollars and C is the contract count.  We
 * approximate (without ceiling) for EV math; this is also the
 * fee a closing trade would pay at settlement-implied price.
 *
 * Reference: https://kalshi.com/docs/fees
 */
export const KALSHI_FEE_COEFFICIENT = 0.07;

/**
 * Estimate the Kalshi trading fee in dollars for a single leg
 * (entry or exit) of a trade.  Kalshi charges a quadratic fee
 * that maxes out at $0.0175/contract when P = $0.50.  Returns
 * 0 for invalid inputs so callers can subtract safely.
 */
export function calculateKalshiFee(price: number, quantity: number): number {
  const p = Number(price);
  const q = Number(quantity);
  if (!Number.isFinite(p) || !Number.isFinite(q) || p <= 0 || p >= 1 || q <= 0) {
    return 0;
  }
  return KALSHI_FEE_COEFFICIENT * p * (1 - p) * q;
}

/**
 * Estimate the round-trip Kalshi fee in dollars (entry + exit at the
 * complement price under the simplifying assumption the exit is at
 * the binary settlement of $0 or $1, which incurs no additional
 * exchange fee).  In practice exits before settlement also incur a
 * fee; we approximate by doubling the entry fee to be conservative.
 */
export function calculateKalshiRoundTripFee(price: number, quantity: number): number {
  // Conservative: assume both legs cross the order book.
  return calculateKalshiFee(price, quantity) * 2;
}

/**
 * Calculate expected value for a trade, net of Kalshi fees.
 *
 * `winProbability` is the trader's forecast probability that the
 * chosen side resolves favourably.  This MUST be a forecast distinct
 * from the market's implied probability — passing market.impliedProbability
 * (which equals the entry price for a fairly-priced market) collapses EV
 * to zero by construction, which is the bug that previously made every
 * edge metric report ~0 and rendered signal ranking meaningless.
 */
export function calculateExpectedValue(
  side: "yes" | "no",
  entryPrice: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _currentPrice: number,
  quantity: number,
  winProbability: number
): number {
  const probWin = side === "yes" ? winProbability : 1 - winProbability;
  const probLoss = 1 - probWin;

  const profit = (1 - entryPrice) * quantity;
  const loss = entryPrice * quantity;

  const grossEV = probWin * profit - probLoss * loss;
  const fee = calculateKalshiRoundTripFee(entryPrice, quantity);
  return grossEV - fee;
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
