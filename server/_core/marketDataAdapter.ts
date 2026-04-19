/**
 * Market Data Adapter Service
 * Provides abstraction layer for fetching real-time market data from multiple sources
 * Supports: Polygon.io, Alpha Vantage, Kraken, and manual data entry
 */

import { ENV } from "./env";

export interface QuoteData {
  symbol: string;
  market: "stocks" | "crypto" | "prediction";
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
  timestamp: Date;
  source: "polygon" | "alpha_vantage" | "kraken" | "manual";
}

export interface DataQualityMetrics {
  isStale: boolean;
  staleSinceMinutes: number;
  hasGaps: boolean;
  lastUpdateAt: Date;
  dataAge: number;
  confidence: number; // 0-1, higher is more recent and reliable
}

/**
 * Fetch stock quote from Polygon.io
 * Requires POLYGON_API_KEY environment variable
 */
export async function fetchPolygonQuote(symbol: string): Promise<QuoteData | null> {
  if (!process.env.POLYGON_API_KEY) {
    console.warn("[MarketData] Polygon API key not configured");
    return null;
  }

  try {
    const url = `https://api.polygon.io/v1/last/quote/stocks/${symbol}?apiKey=${process.env.POLYGON_API_KEY}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[MarketData] Polygon API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (!data.results || !data.results.last) {
      console.warn(`[MarketData] No quote data from Polygon for ${symbol}`);
      return null;
    }

    const quote = data.results.last;
    return {
      symbol,
      market: "stocks",
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: quote.last,
      volume: quote.volume,
      timestamp: new Date(quote.exchange_timestamp || Date.now()),
      source: "polygon",
    };
  } catch (error) {
    console.error(`[MarketData] Polygon fetch failed for ${symbol}:`, error);
    return null;
  }
}

/**
 * Fetch stock/crypto quote from Alpha Vantage
 * Requires ALPHA_VANTAGE_API_KEY environment variable
 */
export async function fetchAlphaVantageQuote(
  symbol: string,
  market: "stocks" | "crypto" = "stocks"
): Promise<QuoteData | null> {
  if (!process.env.ALPHA_VANTAGE_API_KEY) {
    console.warn("[MarketData] Alpha Vantage API key not configured");
    return null;
  }

  try {
    const function_type = market === "crypto" ? "CURRENCY_EXCHANGE_RATE" : "GLOBAL_QUOTE";
    const url = `https://www.alphavantage.co/query?function=${function_type}&symbol=${symbol}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[MarketData] Alpha Vantage API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data["Error Message"]) {
      console.warn(`[MarketData] Alpha Vantage error: ${data["Error Message"]}`);
      return null;
    }

    let quoteData: QuoteData | null = null;

    if (market === "crypto" && data["Realtime Currency Exchange Rate"]) {
      const quote = data["Realtime Currency Exchange Rate"];
      quoteData = {
        symbol,
        market: "crypto",
        close: parseFloat(quote["5. Exchange Rate"]),
        timestamp: new Date(),
        source: "alpha_vantage",
      };
    } else if (market === "stocks" && data["Global Quote"]) {
      const quote = data["Global Quote"];
      quoteData = {
        symbol,
        market: "stocks",
        open: parseFloat(quote["02. open"]),
        high: parseFloat(quote["03. high"]),
        low: parseFloat(quote["04. low"]),
        close: parseFloat(quote["05. price"]),
        volume: parseFloat(quote["06. volume"]),
        timestamp: new Date(),
        source: "alpha_vantage",
      };
    }

    if (!quoteData) {
      console.warn(`[MarketData] No quote data from Alpha Vantage for ${symbol}`);
      return null;
    }

    return quoteData;
  } catch (error) {
    console.error(`[MarketData] Alpha Vantage fetch failed for ${symbol}:`, error);
    return null;
  }
}

/**
 * Fetch stock quote from Alpaca
 * Requires ALPACA_API_KEY environment variable
 */
export async function fetchAlpacaQuote(symbol: string): Promise<QuoteData | null> {
  if (!process.env.ALPACA_API_KEY) {
    console.warn("[MarketData] Alpaca API key not configured");
    return null;
  }

  try {
    const url = `https://data.alpaca.markets/v1beta3/latest/bars?symbols=${symbol}&feed=sip`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.ALPACA_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[MarketData] Alpaca API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const bar = data.bars?.[symbol]?.[0];

    if (!bar) {
      console.warn(`[MarketData] No quote data from Alpaca for ${symbol}`);
      return null;
    }

    return {
      symbol,
      market: "stocks",
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
      timestamp: new Date(bar.t),
      source: "alpha_vantage",
    };
  } catch (error) {
    console.error(`[MarketData] Alpaca fetch failed for ${symbol}:`, error);
    return null;
  }
}

/**
 * Fetch crypto quote from Kraken
 */
export async function fetchKrakenQuote(symbol: string): Promise<QuoteData | null> {
  try {
    // Kraken uses XBTUSDT format for BTC/USD
    const krakenSymbol = symbol.includes("USD") ? symbol : `${symbol}USD`;
    const url = `https://api.kraken.com/0/public/Ticker?pair=${krakenSymbol}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[MarketData] Kraken API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.error && data.error.length > 0) {
      console.warn(`[MarketData] Kraken error: ${data.error[0]}`);
      return null;
    }

    const result = Object.values(data.result || {})[0] as any;
    if (!result) {
      console.warn(`[MarketData] No quote data from Kraken for ${symbol}`);
      return null;
    }

    return {
      symbol,
      market: "crypto",
      close: parseFloat(result.c[0]),
      high: parseFloat(result.h[1]),
      low: parseFloat(result.l[1]),
      volume: parseFloat(result.v[1]),
      timestamp: new Date(),
      source: "kraken",
    };
  } catch (error) {
    console.error(`[MarketData] Kraken fetch failed for ${symbol}:`, error);
    return null;
  }
}

/**
 * Calculate data quality metrics for a quote
 */
export function calculateDataQuality(lastUpdate: Date, maxAgeMinutes: number = 5): DataQualityMetrics {
  const now = new Date();
  const ageMs = now.getTime() - lastUpdate.getTime();
  const ageMinutes = ageMs / (1000 * 60);
  const isStale = ageMinutes > maxAgeMinutes;

  // Confidence decreases as data ages
  // 100% confidence if < 1 minute old
  // 50% confidence at maxAgeMinutes
  // 0% confidence if > 2x maxAgeMinutes
  const confidence = Math.max(0, 1 - ageMinutes / (maxAgeMinutes * 2));

  return {
    isStale,
    staleSinceMinutes: isStale ? ageMinutes - maxAgeMinutes : 0,
    hasGaps: false, // TODO: implement gap detection
    lastUpdateAt: lastUpdate,
    dataAge: ageMinutes,
    confidence,
  };
}

/**
 * Fetch quote with fallback strategy
 * Tries primary source, falls back to secondary sources if needed
 */
export async function fetchQuoteWithFallback(
  symbol: string,
  market: "stocks" | "crypto" = "stocks",
  preferredSource?: "polygon" | "alpha_vantage" | "kraken"
): Promise<QuoteData | null> {
  // Try preferred source first
  if (preferredSource === "polygon" && market === "stocks") {
    const quote = await fetchPolygonQuote(symbol);
    if (quote) return quote;
  }

  if (preferredSource === "alpha_vantage") {
    const quote = await fetchAlphaVantageQuote(symbol, market);
    if (quote) return quote;
  }

  if (preferredSource === "kraken" && market === "crypto") {
    const quote = await fetchKrakenQuote(symbol);
    if (quote) return quote;
  }

  // Fallback strategy: try other sources
  if (market === "stocks") {
    // Try Polygon first for stocks
    let quote = await fetchPolygonQuote(symbol);
    if (quote) return quote;

    // Try Alpaca
    quote = await fetchAlpacaQuote(symbol);
    if (quote) return quote;

    // Fall back to Alpha Vantage
    quote = await fetchAlphaVantageQuote(symbol, "stocks");
    if (quote) return quote;
  } else if (market === "crypto") {
    // Try Kraken first for crypto
    let quote = await fetchKrakenQuote(symbol);
    if (quote) return quote;

    // Fall back to Alpha Vantage
    quote = await fetchAlphaVantageQuote(symbol, "crypto");
    if (quote) return quote;
  }

  console.warn(`[MarketData] Could not fetch quote for ${symbol} from any source`);
  return null;
}

/**
 * Format quote for display with data quality indicator
 */
export function formatQuoteForDisplay(
  quote: QuoteData,
  quality: DataQualityMetrics
): {
  price: string;
  change: string;
  quality: string;
  warning?: string;
} {
  const priceStr = quote.close.toFixed(2);
  const qualityStr = quality.isStale
    ? `STALE (${Math.round(quality.staleSinceMinutes)}m ago)`
    : `FRESH (${Math.round(quality.dataAge)}m ago)`;

  const warning = quality.confidence < 0.5 ? "Low data confidence" : undefined;

  return {
    price: priceStr,
    change: `${quality.confidence * 100}% confidence`,
    quality: qualityStr,
    warning,
  };
}
