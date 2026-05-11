/**
 * Binance public klines (OHLCV) client.
 *
 * Fetches historical candle data from Binance's unauthenticated public REST
 * API. Used to compute technical indicators (EMA, RSI, ATR) that feed into
 * the crypto fundamental-probability model for Kalshi binary markets.
 *
 * No authentication is required for historical klines. No trading calls are
 * made here — this is a read-only data layer.
 *
 * Wrapped in the same CircuitBreaker + fetchWithRetry pattern used by
 * kalshiMarketData.ts so a Binance outage fails fast rather than cascading
 * timeouts into the autonomy loop.
 */

import { CircuitBreaker } from "./circuitBreaker";
import { fetchWithRetry } from "./fetchWithRetry";
import { logger } from "./logger";

const BINANCE_BASE_URL = "https://api.binance.com";
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_LIMIT = 1_000;
/** Maximum candles fetchBinanceKlinesHistory will accumulate across pages. */
const MAX_HISTORY_CANDLES = 5_000;

export interface BinanceKline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export type BinanceInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

// One shared breaker per process — trips after 5 failures in 30 s,
// cooldown 30 s (same defaults as kalshiBreaker in kalshiMarketData.ts).
const binanceBreaker = new CircuitBreaker({
  name: "binance.klines",
  failureThreshold: 5,
  windowMs: 30_000,
  cooldownMs: 30_000,
});

function parseKlineArray(raw: unknown, symbol: string): BinanceKline[] {
  if (!Array.isArray(raw)) {
    logger.warn({ symbol }, "[BinanceClient] Unexpected klines response shape");
    return [];
  }

  const klines: BinanceKline[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 7) continue;

    const openTime = Number(entry[0]);
    const open = Number(entry[1]);
    const high = Number(entry[2]);
    const low = Number(entry[3]);
    const close = Number(entry[4]);
    const volume = Number(entry[5]);
    const closeTime = Number(entry[6]);

    if (
      !Number.isFinite(openTime) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      !Number.isFinite(volume) ||
      open <= 0 ||
      close <= 0
    ) {
      continue;
    }

    klines.push({ openTime, open, high, low, close, volume, closeTime });
  }

  return klines;
}

/**
 * Fetch historical klines from Binance's public REST API.
 *
 * @param symbol   Trading pair, e.g. "BTCUSDT" or "ETHUSDT".
 * @param interval Candle interval.
 * @param limit    Number of candles to fetch (max 1000, returned oldest-first).
 * @returns Array of validated klines, or throws on failure.
 */
export async function fetchBinanceKlines(
  symbol: string,
  interval: BinanceInterval = "15m",
  limit = 100,
): Promise<BinanceKline[]> {
  const safeLimit = Math.max(1, Math.min(MAX_LIMIT, limit));
  const url =
    `${BINANCE_BASE_URL}/api/v3/klines` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&limit=${safeLimit}`;

  return binanceBreaker.execute(async () => {
    const response = await fetchWithRetry(
      url,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) },
      { maxAttempts: 2, baseDelayMs: 300, label: `binance.klines.${symbol}.${interval}` },
    );

    if (!response.ok) {
      throw new Error(
        `[BinanceClient] ${symbol}/${interval} failed: HTTP ${response.status}`,
      );
    }

    const raw: unknown = await response.json();
    return parseKlineArray(raw, symbol);
  });
}

/**
 * Fetch klines for multiple symbols in parallel.
 *
 * Returns a Map of symbol -> klines. Symbols that fail are excluded from the map.
 */
export async function fetchMultipleCryptoKlines(
  symbols: string[],
  interval: BinanceInterval = "15m",
  limit = 200,
): Promise<Map<string, BinanceKline[]>> {
  const results = await Promise.allSettled(
    symbols.map((symbol) => fetchBinanceKlines(symbol, interval, limit)),
  );

  const klinesMap = new Map<string, BinanceKline[]>();
  
  results.forEach((result, index) => {
    const symbol = symbols[index]!;
    if (result.status === "fulfilled") {
      klinesMap.set(symbol, result.value);
    } else {
      logger.warn({ err: result.reason, symbol }, "[BinanceClient] Fetch failed");
    }
  });

  return klinesMap;
}

/**
 * Fetch a deep history of klines by paginating backwards from the current
 * time.  Each Binance request returns at most 1,000 candles; this function
 * issues up to ceil(totalCandles / 1000) sequential requests and concatenates
 * the results in chronological (oldest-first) order.
 *
 * Use this for backtesting where you need weeks of data:
 *   - 15m candles: 1,000 = ~10.4 days / 5,000 = ~52 days
 *   - 1h  candles: 1,000 = ~41.7 days / 5,000 = ~208 days
 *
 * The fetch is serialised (not parallel) to avoid hitting Binance's IP rate
 * limits with burst requests from the backtest runner.
 *
 * @param symbol        Binance trading pair, e.g. "BTCUSDT".
 * @param interval      Candle interval.
 * @param totalCandles  Desired number of candles (capped at MAX_HISTORY_CANDLES = 5,000).
 * @returns Oldest-first array of validated klines.
 */
export async function fetchBinanceKlinesHistory(
  symbol: string,
  interval: BinanceInterval = "15m",
  totalCandles = 1_000,
): Promise<BinanceKline[]> {
  const target = Math.max(1, Math.min(MAX_HISTORY_CANDLES, totalCandles));
  const allKlines: BinanceKline[] = [];

  // Walk backwards in time: each page ends at the earliest openTime fetched
  // so far, giving us the preceding batch of candles.
  let endTime: number | undefined;

  while (allKlines.length < target) {
    const remaining = target - allKlines.length;
    const batchSize = Math.min(MAX_LIMIT, remaining);

    let url =
      `${BINANCE_BASE_URL}/api/v3/klines` +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${encodeURIComponent(interval)}` +
      `&limit=${batchSize}`;

    if (endTime !== undefined) {
    // The comment says "subtract 1 ms so this batch doesn't overlap with the
    // next batch backwards": since we're paging backwards, we end each new
    // request just before the earliest candle seen so far.
    url += `&endTime=${endTime - 1}`;
    }

    // Each batch goes through the shared breaker so sustained failures trip
    // the circuit rather than hammering Binance for every page.
    const batch = await binanceBreaker.execute(async () => {
      const response = await fetchWithRetry(
        url,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) },
        { maxAttempts: 2, baseDelayMs: 400, label: `binance.history.${symbol}.${interval}` },
      );
      if (!response.ok) {
        throw new Error(
          `[BinanceClient] history ${symbol}/${interval} page failed: HTTP ${response.status}`,
        );
      }
      const raw: unknown = await response.json();
      return parseKlineArray(raw, symbol);
    });

    if (batch.length === 0) break; // Binance returned no more data

    // Prepend: batch is oldest-first, allKlines accumulates oldest-first.
    allKlines.unshift(...batch);

    // Update the cursor to the earliest candle in this batch.
    endTime = batch[0]!.openTime;

    logger.debug(
      { symbol, interval, fetched: allKlines.length, target, batchSize: batch.length },
      "[BinanceClient] klines history page fetched",
    );

    if (batch.length < batchSize) break; // Server returned less than requested — no more history
  }

  // Return the most-recent `target` candles in case we slightly overshot.
  return allKlines.length > target ? allKlines.slice(allKlines.length - target) : allKlines;
}
