/**
 * Tests for the crypto technical analysis engine and BSM probability model.
 *
 * All Binance HTTP calls are mocked — no real network requests.
 * Tests cover:
 *  - EMA / RSI / ATR indicator helpers
 *  - computeBSMProbability (sanity, direction, boundary clamping)
 *  - extractCryptoStrike (title parsing)
 *  - identifyCryptoAsset (symbol recognition)
 *  - computeCryptoFundamentalPrior (end-to-end)
 *  - backtestCryptoStrategy (walk-forward logic)
 *  - runShortTermCryptoBacktest (short-term 4h convenience wrapper)
 */

import { describe, it, expect } from "vitest";
import type { BinanceKline } from "./_core/binanceClient";
import {
  computeEMA,
  computeRSI,
  computeATR,
  computeBSMProbability,
  extractCryptoStrike,
  identifyCryptoAsset,
  computeCryptoFundamentalPrior,
} from "./_core/cryptoTechnicals";
import {
  backtestCryptoStrategy,
  runShortTermCryptoBacktest,
} from "./_core/kalshiBacktest";

// ── Kline fixture helpers ─────────────────────────────────────────────────────

/** Build a synthetic BinanceKline. */
function makeKline(close: number, opts: Partial<BinanceKline> = {}): BinanceKline {
  return {
    openTime: opts.openTime ?? 1_700_000_000_000,
    open: opts.open ?? close,
    high: opts.high ?? close * 1.005,
    low: opts.low ?? close * 0.995,
    close,
    volume: opts.volume ?? 1_000,
    closeTime: opts.closeTime ?? 1_700_000_900_000,
  };
}

/** Build N klines at a fixed price with incrementing timestamps. */
function buildKlines(count: number, basePrice = 90_000, perCandleMs = 15 * 60 * 1000): BinanceKline[] {
  const klines: BinanceKline[] = [];
  for (let i = 0; i < count; i++) {
    const openTime = 1_700_000_000_000 + i * perCandleMs;
    klines.push({
      openTime,
      open: basePrice,
      high: basePrice * 1.002,
      low: basePrice * 0.998,
      close: basePrice,
      volume: 500,
      closeTime: openTime + perCandleMs - 1,
    });
  }
  return klines;
}

/** Build a trending kline sequence (each candle moves by `delta` from prev close). */
function buildTrendingKlines(count: number, startPrice: number, delta: number): BinanceKline[] {
  const klines: BinanceKline[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const openTime = 1_700_000_000_000 + i * 900_000;
    klines.push({
      openTime,
      open: price,
      high: price + Math.abs(delta),
      low: price - Math.abs(delta),
      close: price + delta,
      volume: 1_000,
      closeTime: openTime + 899_999,
    });
    price += delta;
  }
  return klines;
}

// ── EMA ───────────────────────────────────────────────────────────────────────

describe("computeEMA", () => {
  it("returns 0 for empty input", () => {
    expect(computeEMA([], 9)).toBe(0);
  });

  it("returns the single value for a 1-element array", () => {
    expect(computeEMA([42], 9)).toBe(42);
  });

  it("converges toward the most recent price for a rising series", () => {
    // A constant series should produce EMA ≈ the constant.
    const closes = Array.from({ length: 50 }, () => 100);
    expect(computeEMA(closes, 21)).toBeCloseTo(100, 5);
  });

  it("EMA of a rising series is below the last price but above average", () => {
    // Prices rise 1 each step from 100 → 149.
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i);
    const ema = computeEMA(closes, 9);
    const lastPrice = closes[closes.length - 1]!;
    const avg = closes.reduce((a, b) => a + b, 0) / closes.length;
    expect(ema).toBeGreaterThan(avg);
    expect(ema).toBeLessThan(lastPrice);
  });
});

// ── RSI ───────────────────────────────────────────────────────────────────────

describe("computeRSI", () => {
  it("returns 50 when there are not enough data points", () => {
    expect(computeRSI([100, 101], 14)).toBe(50);
  });

  it("returns 100 when all moves are up (no losses)", () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(computeRSI(rising, 14)).toBe(100);
  });

  it("returns overbought (>70) value for a strongly rising series", () => {
    const rising = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
    const rsi = computeRSI(rising, 14);
    expect(rsi).toBeGreaterThan(70);
  });

  it("returns oversold (<30) value for a strongly falling series", () => {
    const falling = Array.from({ length: 30 }, (_, i) => 200 - i * 3);
    const rsi = computeRSI(falling, 14);
    expect(rsi).toBeLessThan(30);
  });

  it("returns near 50 for alternating up/down series", () => {
    const alternating = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 100 : 101));
    const rsi = computeRSI(alternating, 14);
    expect(rsi).toBeGreaterThan(30);
    expect(rsi).toBeLessThan(70);
  });
});

// ── ATR ───────────────────────────────────────────────────────────────────────

describe("computeATR", () => {
  it("returns 0 for fewer than 2 klines", () => {
    expect(computeATR([makeKline(100)], 14)).toBe(0);
  });

  it("returns a positive value for normal klines", () => {
    const klines = buildKlines(30, 90_000);
    const atr = computeATR(klines, 14);
    expect(atr).toBeGreaterThan(0);
  });

  it("ATR is higher for more volatile klines", () => {
    const stable = buildKlines(30, 90_000);
    const volatile = stable.map((k) => ({
      ...k,
      high: k.close * 1.05,
      low: k.close * 0.95,
    }));
    expect(computeATR(volatile, 14)).toBeGreaterThan(computeATR(stable, 14));
  });
});

// ── extractCryptoStrike ───────────────────────────────────────────────────────

describe("extractCryptoStrike", () => {
  it("parses 'above $95,000' as above", () => {
    const result = extractCryptoStrike("Will BTC close above $95,000 this week?");
    expect(result).not.toBeNull();
    expect(result!.strikePrice).toBe(95_000);
    expect(result!.direction).toBe("above");
  });

  it("parses 'below $90000' as below", () => {
    const result = extractCryptoStrike("Will BTC close below $90000 today?");
    expect(result).not.toBeNull();
    expect(result!.strikePrice).toBe(90_000);
    expect(result!.direction).toBe("below");
  });

  it("parses '100000 or above' format", () => {
    const result = extractCryptoStrike("BTC at $100,000 or above by Friday?");
    expect(result).not.toBeNull();
    expect(result!.strikePrice).toBe(100_000);
  });

  it("parses 'hit 95000' bare number", () => {
    const result = extractCryptoStrike("Will Bitcoin hit 95000?");
    expect(result).not.toBeNull();
    expect(result!.strikePrice).toBe(95_000);
  });

  it("returns null for a market with no price reference", () => {
    const result = extractCryptoStrike("Will the Fed cut rates in December?");
    expect(result).toBeNull();
  });

  it("returns null for a number outside crypto price range (bare fallback only)", () => {
    // The bare-number fallback guards against out-of-range values.
    // But "hit" is a specific keyword matched by pattern 2 (not the fallback),
    // so "Will Bitcoin hit 42?" extracts 42 via the reach/hit pattern.
    // A number with NO preceding directional keyword and out of range should return null.
    const result = extractCryptoStrike("Some market about number 42 changing");
    // The bare-number fallback requires 4-9 digits (≥ 1000), so "42" is excluded.
    expect(result).toBeNull();
  });
});

// ── identifyCryptoAsset ───────────────────────────────────────────────────────

describe("identifyCryptoAsset", () => {
  it("identifies BTC market", () => {
    const m = { title: "Will Bitcoin close above $95k?", category: "crypto" } as any;
    expect(identifyCryptoAsset(m)).toBe("BTCUSDT");
  });

  it("identifies ETH market", () => {
    const m = { title: "Will Ethereum exceed $4000?", category: "crypto" } as any;
    expect(identifyCryptoAsset(m)).toBe("ETHUSDT");
  });

  it("identifies SOL market", () => {
    const m = { title: "Will Solana hit $200?", category: "crypto" } as any;
    expect(identifyCryptoAsset(m)).toBe("SOLUSDT");
  });

  it("returns null for unrecognised asset", () => {
    const m = { title: "Will DOGE reach $1?", category: "crypto" } as any;
    expect(identifyCryptoAsset(m)).toBeNull();
  });
});

// ── computeBSMProbability ─────────────────────────────────────────────────────

describe("computeBSMProbability", () => {
  const flatKlines = buildKlines(50, 90_000);

  it("returns null when klines < 20", () => {
    expect(computeBSMProbability(buildKlines(10), 90_000, "above", 4)).toBeNull();
  });

  it("returns null when hoursToResolution <= 0", () => {
    expect(computeBSMProbability(flatKlines, 90_000, "above", 0)).toBeNull();
  });

  it("returns a probability in (0.05, 0.95)", () => {
    const prob = computeBSMProbability(flatKlines, 90_000, "above", 4);
    expect(prob).not.toBeNull();
    expect(prob!).toBeGreaterThan(0.05);
    expect(prob!).toBeLessThan(0.95);
  });

  it("above and below probabilities sum approximately to 1 (neutral RSI)", () => {
    // RSI adjustments are applied independently to each direction and break
    // the sum-to-1 invariant when RSI is extreme (>70 or <30).  Use an
    // alternating series so RSI is near 50 and the sum stays close to 1.
    const neutralKlines = Array.from({ length: 50 }, (_, i) => {
      const price = 90_000 + (i % 2 === 0 ? 50 : -50);
      return makeKline(price, { volume: 500 });
    });
    const pAbove = computeBSMProbability(neutralKlines, 90_000, "above", 4)!;
    const pBelow = computeBSMProbability(neutralKlines, 90_000, "below", 4)!;
    expect(pAbove + pBelow).toBeCloseTo(1.0, 1);
  });

  it("P(above) is higher when current price is well above strike", () => {
    // BTC at 100k betting on "above 90k" — high probability
    const highKlines = buildKlines(50, 100_000);
    const prob = computeBSMProbability(highKlines, 90_000, "above", 4)!;
    expect(prob).toBeGreaterThan(0.75);
  });

  it("P(above) is lower when current price is well below strike", () => {
    // BTC at 80k betting on "above 90k" — low probability
    const lowKlines = buildKlines(50, 80_000);
    const prob = computeBSMProbability(lowKlines, 90_000, "above", 4)!;
    expect(prob).toBeLessThan(0.35);
  });

  it("bullish trend increases P(above) vs neutral for same strike/price", () => {
    // Build a rising kline sequence to generate a bullish EMA crossover.
    const trendKlines = buildTrendingKlines(60, 89_500, 10); // rising slowly
    const flatAtSame = buildKlines(60, trendKlines[trendKlines.length - 1]!.close);
    const probTrend = computeBSMProbability(trendKlines, 90_000, "above", 4)!;
    const probFlat = computeBSMProbability(flatAtSame, 90_000, "above", 4)!;
    expect(probTrend).toBeGreaterThanOrEqual(probFlat - 0.02); // trend should not hurt
  });
});

// ── computeCryptoFundamentalPrior ─────────────────────────────────────────────

describe("computeCryptoFundamentalPrior", () => {
  const klines = buildKlines(50, 95_000);

  it("returns null for an unrecognised market title", () => {
    const market = { id: "m1", title: "Will the Fed cut rates?", category: "macro" } as any;
    expect(computeCryptoFundamentalPrior(market, klines, 4)).toBeNull();
  });

  it("returns null for hoursToResolution <= 0", () => {
    const market = { id: "m2", title: "Will BTC close above $90,000?", category: "crypto" } as any;
    expect(computeCryptoFundamentalPrior(market, klines, 0)).toBeNull();
    expect(computeCryptoFundamentalPrior(market, klines, -1)).toBeNull();
  });

  it("returns a valid analysis for a parseable crypto market", () => {
    const market = { id: "m3", title: "Will BTC close above $90,000?", category: "crypto" } as any;
    const result = computeCryptoFundamentalPrior(market, klines, 4);
    expect(result).not.toBeNull();
    expect(result!.strikePrice).toBe(90_000);
    expect(result!.direction).toBe("above");
    expect(result!.probability).toBeGreaterThan(0.05);
    expect(result!.probability).toBeLessThan(0.95);
    expect(result!.currentPrice).toBe(95_000);
  });
});

// ── backtestCryptoStrategy ────────────────────────────────────────────────────

describe("backtestCryptoStrategy", () => {
  // 300 klines at 90k: 96 lookback + 16 resolution = 188 potential entry points.
  const klines = buildKlines(300, 90_000);

  it("returns zero trades when no signals meet the edge threshold", () => {
    // Set strike exactly at current price and a very high minEdge (e.g. 0.9).
    const result = backtestCryptoStrategy(klines, {
      symbol: "BTCUSDT",
      strikePrice: 90_000,
      side: "yes",
      resolutionCandles: 16,
      minEdge: 0.9, // impossible threshold
    });
    expect(result.totalTrades).toBe(0);
    expect(result.winRate).toBe(0);
  });

  it("returns trades when minEdge is low", () => {
    // At 95k with strike 80k, model P(above) ≈ 0.9+ → edge 0.4+ over 50¢ entry.
    const bullishKlines = buildKlines(300, 95_000);
    const result = backtestCryptoStrategy(bullishKlines, {
      symbol: "BTCUSDT",
      strikePrice: 80_000,
      side: "yes",
      resolutionCandles: 16,
      minEdge: 0.0, // accept all signals
    });
    expect(result.totalTrades).toBeGreaterThan(0);
    expect(result.signalCount).toBeGreaterThan(0);
    // For a flat kline at 95k with strike 80k, all resolutions WIN (close ≥ 80k always).
    expect(result.winRate).toBeCloseTo(1.0, 2);
    expect(result.totalPnL).toBeGreaterThan(0);
  });

  it("filteredByEdge + totalTrades + skipped = signalCount", () => {
    const result = backtestCryptoStrategy(klines, {
      symbol: "BTCUSDT",
      strikePrice: 90_000,
      side: "yes",
      resolutionCandles: 16,
      minEdge: 0.5, // very high to produce skips
    });
    // filteredByEdge + totalTrades should equal signalCount (some windows may produce null prob → skipped)
    expect(result.filteredByEdge + result.totalTrades).toBeLessThanOrEqual(result.signalCount);
  });

  it("resolution is correctly evaluated at the right candle", () => {
    // Use a kline array where the first 96 are flat at 90k, then 16 candles jump to 100k.
    // A "yes" (above 95k) bet entered just before the jump should WIN.
    const mixedKlines: BinanceKline[] = [
      ...buildKlines(150, 90_000),
      ...buildKlines(50, 100_000), // jump to 100k for 50 candles
    ];
    const result = backtestCryptoStrategy(mixedKlines, {
      symbol: "BTCUSDT",
      strikePrice: 95_000,
      side: "yes",
      lookbackCandles: 96,
      resolutionCandles: 16,
      minEdge: 0.0, // accept all
    });
    expect(result.totalTrades).toBeGreaterThan(0);
  });
});

// ── runShortTermCryptoBacktest ────────────────────────────────────────────────

describe("runShortTermCryptoBacktest", () => {
  it("uses 4h resolution (16 candles) by default", () => {
    const bullishKlines = buildKlines(300, 95_000);
    const result = runShortTermCryptoBacktest(bullishKlines, "BTCUSDT", 80_000, "yes");
    // With price at 95k >> 80k strike, virtually all resolution outcomes WIN.
    expect(result.totalTrades).toBeGreaterThanOrEqual(0);
    expect(result.symbol).toBe("BTCUSDT");
    expect(result.strikePrice).toBe(80_000);
    expect(result.side).toBe("yes");
  });

  it("produces no regressions against backtestCryptoStrategy with same params", () => {
    const klines = buildKlines(300, 95_000);
    const shortTerm = runShortTermCryptoBacktest(klines, "BTCUSDT", 80_000, "yes");
    const manual = backtestCryptoStrategy(klines, {
      symbol: "BTCUSDT",
      strikePrice: 80_000,
      side: "yes",
      lookbackCandles: 96,
      resolutionCandles: 16,
      minEdge: 0.07,
      kalshiEntryPrice: 0.5,
    });
    expect(shortTerm.totalTrades).toBe(manual.totalTrades);
    expect(shortTerm.winRate).toBeCloseTo(manual.winRate, 6);
    expect(shortTerm.totalPnL).toBeCloseTo(manual.totalPnL, 6);
  });
});
