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
 * Fetch BTC and ETH 15m klines in parallel.
 *
 * Returns null for whichever symbol fails so a single exchange hiccup
 * does not block the full crypto-prior computation.
 */
export async function fetchCryptoKlines(
  interval: BinanceInterval = "15m",
  limit = 100,
): Promise<{ btc: BinanceKline[] | null; eth: BinanceKline[] | null }> {
  const [btcResult, ethResult] = await Promise.allSettled([
    fetchBinanceKlines("BTCUSDT", interval, limit),
    fetchBinanceKlines("ETHUSDT", interval, limit),
  ]);

  if (btcResult.status === "rejected") {
    logger.warn({ err: btcResult.reason }, "[BinanceClient] BTCUSDT fetch failed");
  }
  if (ethResult.status === "rejected") {
    logger.warn({ err: ethResult.reason }, "[BinanceClient] ETHUSDT fetch failed");
  }

  return {
    btc: btcResult.status === "fulfilled" ? btcResult.value : null,
    eth: ethResult.status === "fulfilled" ? ethResult.value : null,
  };
}
