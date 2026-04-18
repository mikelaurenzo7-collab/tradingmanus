/**
 * Market Data Sync Service
 * Orchestrates fetching market data from adapters and storing in database
 * Manages data freshness, quality tracking, and error recovery
 */

import { getDb } from "../db";
import { marketDataSnapshots, dataConnectors } from "../../drizzle/schema";
import {
  fetchQuoteWithFallback,
  calculateDataQuality,
  type QuoteData,
} from "./marketDataAdapter";
import { eq } from "drizzle-orm";

export interface SyncResult {
  success: boolean;
  symbol: string;
  quote?: QuoteData;
  error?: string;
  quality?: {
    isStale: boolean;
    confidence: number;
  };
}

/**
 * Sync a single symbol's market data
 */
export async function syncMarketData(
  symbol: string,
  market: "stocks" | "crypto" = "stocks",
  preferredSource?: "polygon" | "alpha_vantage" | "kraken"
): Promise<SyncResult> {
  try {
    // Fetch quote from adapter
    const quote = await fetchQuoteWithFallback(symbol, market, preferredSource);

    if (!quote) {
      return {
        success: false,
        symbol,
        error: "Could not fetch quote from any source",
      };
    }

    // Store in database
    const db = await getDb();
    if (!db) {
      return {
        success: false,
        symbol,
        error: "Database not available",
      };
    }

    await db.insert(marketDataSnapshots).values({
      symbol: quote.symbol,
      market: quote.market,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: quote.close,
      volume: quote.volume,
      source: quote.source,
      timestamp: quote.timestamp,
    });

    // Calculate data quality
    const quality = calculateDataQuality(quote.timestamp);

    return {
      success: true,
      symbol,
      quote,
      quality: {
        isStale: quality.isStale,
        confidence: quality.confidence,
      },
    };
  } catch (error) {
    return {
      success: false,
      symbol,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Sync multiple symbols in parallel
 */
export async function syncMultipleSymbols(
  symbols: Array<{ symbol: string; market: "stocks" | "crypto" }>,
  concurrency: number = 3
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const queue = [...symbols];
  const active: Promise<void>[] = [];

  while (queue.length > 0 || active.length > 0) {
    // Fill up to concurrency limit
    while (active.length < concurrency && queue.length > 0) {
      const item = queue.shift()!;
      const promise = syncMarketData(item.symbol, item.market).then((result) => {
        results.push(result);
      });
      active.push(promise);
    }

    // Wait for at least one to complete
    if (active.length > 0) {
      await Promise.race(active);
      active.splice(
        active.findIndex((p) => p === Promise.resolve()),
        1
      );
    }
  }

  return results;
}

/**
 * Update data connector status based on sync results
 */
export async function updateConnectorStatus(
  connectorId: number,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(dataConnectors)
    .set({
      status: success ? "connected" : "error",
      lastSyncAt: new Date(),
      errorMessage: errorMessage || null,
    })
    .where(eq(dataConnectors.id, connectorId));
}

/**
 * Detect stale data for a symbol
 */
export async function detectStaleData(
  symbol: string,
  maxAgeMinutes: number = 5
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const result = await db
    .select()
    .from(marketDataSnapshots)
    .where(eq(marketDataSnapshots.symbol, symbol))
    .orderBy(marketDataSnapshots.recordedAt)
    .limit(1);

  const latest = result[0];
  if (!latest) return true;

  const ageMs = Date.now() - latest.recordedAt.getTime();
  const ageMinutes = ageMs / (1000 * 60);

  return ageMinutes > maxAgeMinutes;
}

/**
 * Get latest quote for a symbol with quality metrics
 */
export async function getLatestQuoteWithQuality(symbol: string) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(marketDataSnapshots)
    .where(eq(marketDataSnapshots.symbol, symbol))
    .orderBy(marketDataSnapshots.recordedAt)
    .limit(1);

  const latest = result[0];

  if (!latest) return null;

  const quality = calculateDataQuality(latest.recordedAt);

  return {
    quote: latest,
    quality,
  };
}

/**
 * Scheduled sync job (run periodically via cron or interval)
 */
export async function runScheduledSync(symbols: string[]): Promise<{
  total: number;
  successful: number;
  failed: number;
  avgConfidence: number;
}> {
  const results = await syncMultipleSymbols(
    symbols.map((s) => ({
      symbol: s,
      market: s.includes("USD") || s.includes("BTC") ? "crypto" : "stocks",
    })),
    5 // 5 concurrent requests
  );

  const successful = results.filter((r) => r.success).length;
  const avgConfidence =
    results.reduce((sum, r) => sum + (r.quality?.confidence || 0), 0) /
    results.length;

  return {
    total: results.length,
    successful,
    failed: results.length - successful,
    avgConfidence,
  };
}
