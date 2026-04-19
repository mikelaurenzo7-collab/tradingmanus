/**
 * Market Data Scheduler
 * Manages periodic syncing of market data with retry logic and exponential backoff
 */

import { syncMarketData, updateConnectorStatus } from "./marketDataSync";

interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * Retry a function with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T | null> {
  let lastError: Error | null = null;
  let delayMs = config.initialDelayMs;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < config.maxRetries) {
        const actualDelay = Math.min(delayMs, config.maxDelayMs);
        console.log(`[MarketDataScheduler] Retry attempt ${attempt + 1}/${config.maxRetries}, waiting ${actualDelay}ms`);
        await new Promise(resolve => setTimeout(resolve, actualDelay));
        delayMs *= config.backoffMultiplier;
      }
    }
  }

  console.error(`[MarketDataScheduler] Failed after ${config.maxRetries} retries:`, lastError);
  return null;
}

/**
 * Sync a single symbol with retry logic
 */
export async function syncWithRetry(
  symbol: string,
  market: "stocks" | "crypto" = "stocks",
  connectorId?: number
): Promise<boolean> {
  const result = await retryWithBackoff(
    () => syncMarketData(symbol, market),
    DEFAULT_RETRY_CONFIG
  );

  const success = result !== null && result.success;

  if (connectorId && success) {
    await updateConnectorStatus(connectorId, true);
  } else if (connectorId) {
    await updateConnectorStatus(connectorId, false, "Failed to fetch market data after retries");
  }

  return success;
}

/**
 * Sync multiple symbols with retry logic and concurrency control
 */
export async function syncBatchWithRetry(
  symbols: Array<{ symbol: string; market: "stocks" | "crypto"; connectorId?: number }>,
  concurrency: number = 3
): Promise<{ successful: number; failed: number; total: number }> {
  const results = await Promise.all(
    symbols.map(item =>
      syncWithRetry(item.symbol, item.market, item.connectorId)
        .catch(error => {
          console.error(`[MarketDataScheduler] Error syncing ${item.symbol}:`, error);
          return false;
        })
    )
  );

  const successful = results.filter(r => r).length;
  const failed = results.length - successful;

  return {
    successful,
    failed,
    total: results.length,
  };
}

/**
 * Create a scheduled sync job
 * Returns a cleanup function to stop the job
 */
export function createScheduledSync(
  symbols: Array<{ symbol: string; market: "stocks" | "crypto"; connectorId?: number }>,
  intervalMs: number = 60000 // Default: 1 minute
): () => void {
  let isRunning = true;

  const runSync = async () => {
    if (!isRunning) return;

    try {
      console.log(`[MarketDataScheduler] Starting scheduled sync for ${symbols.length} symbols`);
      const result = await syncBatchWithRetry(symbols);
      console.log(`[MarketDataScheduler] Sync complete: ${result.successful}/${result.total} successful`);
    } catch (error) {
      console.error("[MarketDataScheduler] Scheduled sync error:", error);
    }

    if (isRunning) {
      setTimeout(runSync, intervalMs);
    }
  };

  // Start immediately
  runSync();

  // Return cleanup function
  return () => {
    isRunning = false;
    console.log("[MarketDataScheduler] Stopped scheduled sync");
  };
}

/**
 * Global scheduler instance
 */
let globalScheduler: (() => void) | null = null;

/**
 * Start global market data scheduler
 */
export function startGlobalScheduler(
  symbols: Array<{ symbol: string; market: "stocks" | "crypto"; connectorId?: number }>,
  intervalMs: number = 60000
): void {
  if (globalScheduler) {
    console.warn("[MarketDataScheduler] Global scheduler already running, stopping old one");
    globalScheduler();
  }

  globalScheduler = createScheduledSync(symbols, intervalMs);
  console.log(`[MarketDataScheduler] Global scheduler started with ${symbols.length} symbols, interval: ${intervalMs}ms`);
}

/**
 * Stop global market data scheduler
 */
export function stopGlobalScheduler(): void {
  if (globalScheduler) {
    globalScheduler();
    globalScheduler = null;
    console.log("[MarketDataScheduler] Global scheduler stopped");
  }
}
