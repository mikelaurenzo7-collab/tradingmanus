/**
 * Crypto technical analysis for Kalshi binary markets.
 *
 * Computes standard technical indicators from Binance 15m OHLCV klines and
 * converts them into a calibrated probability estimate for the typical Kalshi
 * crypto binary: "Will BTC/ETH close above/below $X at resolution time?"
 *
 * Probability model — simplified log-normal (Black-Scholes N(d₁)):
 *   σ  = ATR(14) annualised via √(96 × 365) to match the 15m period.
 *   μ  = ±10 % annualised drift bias from EMA(9)/EMA(21) crossover direction.
 *   T  = hoursToResolution / 8760 (time in years).
 *   d₁ = (ln(S/K) + (μ + ½σ²)T) / (σ√T)
 *   P(above) = N(d₁) ; P(below) = 1 − N(d₁)
 *
 * Lightweight adjustments applied after the model:
 *   - RSI(14) overbought/oversold: ±0.05
 *   - Above-average volume confirming trend direction: ±0.02
 *
 * All computations are deterministic (no LLM). Following Rule 5 — "use
 * code for deterministic transforms, not the model."
 */

import type { BinanceKline } from "./binanceClient";
import type { KalshiMarket } from "./kalshiMarketData";

// ── Technical indicator helpers ───────────────────────────────────────────────

/**
 * Exponential moving average. Applies to an array of price closes.
 */
export function computeEMA(closes: number[], period: number): number {
  if (closes.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = closes[0]!;
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i]! * k + ema * (1 - k);
  }
  return ema;
}

/**
 * Average True Range (ATR) — volatility proxy.
 * Uses the trailing `period` true-range values.
 */
export function computeATR(klines: BinanceKline[], period = 14): number {
  if (klines.length < 2) return 0;

  const trValues: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const curr = klines[i]!;
    const prev = klines[i - 1]!;
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close),
    );
    trValues.push(tr);
  }

  const window = trValues.slice(-period);
  return window.length > 0
    ? window.reduce((a, b) => a + b, 0) / window.length
    : 0;
}

/**
 * Relative Strength Index (RSI-14). Returns a value in [0, 100].
 * Falls back to 50 when there are insufficient data points.
 */
export function computeRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

/** Simple moving average of volume over the last `period` candles. */
function computeVolumeSMA(klines: BinanceKline[], period = 20): number {
  const window = klines.slice(-period);
  if (window.length === 0) return 0;
  return window.reduce((sum, k) => sum + k.volume, 0) / window.length;
}

/**
 * Abramowitz & Stegun normal CDF approximation.
 * Maximum error: 7.5 × 10⁻⁸.
 */
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return x >= 0 ? 1 - p : p;
}

// ── Strike price extraction ───────────────────────────────────────────────────

// Patterns ordered from most-specific to least to avoid false matches.
const STRIKE_PATTERNS = [
  /(?:at or above|at or below|equal to or above|equal to or below)\s*\$?([\d,]+(?:\.\d+)?)/i,
  /(?:above|exceed|reach|≥|>=)\s*\$?([\d,]+(?:\.\d+)?)/i,
  /(?:below|under|≤|<=)\s*\$?([\d,]+(?:\.\d+)?)/i,
  /\$?([\d,]+(?:\.\d+)?)\s*(?:or (?:above|more|higher)|or (?:below|less|lower))/i,
  /(?:close|end|finish|settle)\s+(?:at|above|below)\s+\$?([\d,]+(?:\.\d+)?)/i,
];

/**
 * Extract strike price and direction from a Kalshi market title.
 * Returns null when the title doesn't match a price-prediction format.
 */
export function extractCryptoStrike(
  title: string,
): { strikePrice: number; direction: "above" | "below" } | null {
  const normalized = title.trim();
  const isBelow = /\b(below|under|less than|not reach|fail(?:s)? to reach)\b/i.test(normalized);

  for (const pattern of STRIKE_PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const strikePrice = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(strikePrice) && strikePrice > 0) {
        return { strikePrice, direction: isBelow ? "below" : "above" };
      }
    }
  }

  return null;
}

/**
 * Identify which crypto asset a Kalshi market tracks.
 * Returns a Binance trading-pair symbol or null if unrecognised.
 */
export function identifyCryptoAsset(market: KalshiMarket): string | null {
  const text = `${market.title ?? ""} ${market.category ?? ""}`.toLowerCase();
  if (/\b(bitcoin|btc)\b/.test(text)) return "BTCUSDT";
  if (/\b(ethereum|eth(?!\w))\b/.test(text)) return "ETHUSDT";
  if (/\b(solana|sol(?!\w))\b/.test(text)) return "SOLUSDT";
  if (/\b(xrp|ripple)\b/.test(text)) return "XRPUSDT";
  return null;
}

// ── Probability model ─────────────────────────────────────────────────────────

export interface CryptoTechnicalAnalysis {
  /** Most recent 15m close from Binance. */
  currentPrice: number;
  /** Strike price extracted from the Kalshi market title. */
  strikePrice: number;
  /** Market resolves YES if price is above (or below) the strike. */
  direction: "above" | "below";
  /** Calibrated P(YES) in [0.05, 0.95]. */
  probability: number;
  /** EMA9/EMA21 trend signal. */
  trend: "bullish" | "bearish" | "neutral";
  /** RSI(14) at the time of analysis. */
  rsi: number;
  /** ATR(14) in price units. */
  atr: number;
  /** True when the last candle's volume exceeds the 20-period average. */
  volumeAboveAverage: boolean;
}

/**
 * Estimate P(YES) for a Kalshi crypto binary market using Binance klines.
 *
 * Returns null when:
 *   - Fewer than 20 klines are available (insufficient history).
 *   - The market title cannot be parsed to extract a strike price.
 *   - Current or strike price is non-positive.
 */
export function computeCryptoFundamentalPrior(
  market: KalshiMarket,
  klines: BinanceKline[],
  hoursToResolution: number,
): CryptoTechnicalAnalysis | null {
  if (klines.length < 20) return null;

  const strikeParse = extractCryptoStrike(market.title ?? "");
  if (!strikeParse) return null;

  const { strikePrice, direction } = strikeParse;
  const closes = klines.map((k) => k.close);
  const currentPrice = closes[closes.length - 1]!;

  if (currentPrice <= 0 || strikePrice <= 0) return null;

  // ── Indicators ──────────────────────────────────────────────────────────
  const ema9 = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const rsi = computeRSI(closes, 14);
  const atr = computeATR(klines, 14);
  const volumeSMA = computeVolumeSMA(klines, 20);
  const lastVolume = klines[klines.length - 1]!.volume;
  const volumeAboveAverage = lastVolume > volumeSMA * 1.2;

  // 0.1 % separation required to declare a crossover (avoids noise at flat).
  const trend: "bullish" | "bearish" | "neutral" =
    ema9 > ema21 * 1.001 ? "bullish" : ema9 < ema21 * 0.999 ? "bearish" : "neutral";

  // ── Log-normal BSM probability ───────────────────────────────────────────
  // 96 × 15 m periods per trading day; annualise with √365.
  const periodsPerDay = 96;
  const atrFraction = atr / currentPrice;
  const dailySigma = atrFraction * Math.sqrt(periodsPerDay);
  const annualizedSigma = Math.max(0.01, dailySigma * Math.sqrt(365));

  // Drift: ±10 % annualised bias based on EMA crossover direction.
  const mu = trend === "bullish" ? 0.1 : trend === "bearish" ? -0.1 : 0.0;

  // Time to resolution in years (floor at 15 m so T > 0 always).
  const T = Math.max(1 / (365 * 24), hoursToResolution / 8760);

  // BSM d₁ — P(S_T > K) = N(d₁) under GBM.
  const d1 =
    (Math.log(currentPrice / strikePrice) +
      (mu + 0.5 * annualizedSigma ** 2) * T) /
    (annualizedSigma * Math.sqrt(T));

  const pAbove = normalCDF(d1);
  let rawProb = direction === "above" ? pAbove : 1 - pAbove;

  // ── Bounded adjustments ──────────────────────────────────────────────────
  // RSI extreme nudge: overbought → mean-revert down; oversold → up.
  if (rsi > 70) rawProb -= 0.05;
  if (rsi < 30) rawProb += 0.05;

  // Volume confirmation aligns with the EMA trend direction.
  if (volumeAboveAverage) {
    const volBias = trend === "bullish" ? 0.02 : trend === "bearish" ? -0.02 : 0;
    // For an "above" market: bullish volume → higher P; for "below": lower P.
    rawProb += direction === "above" ? volBias : -volBias;
  }

  const probability = Math.max(0.05, Math.min(0.95, rawProb));

  return {
    currentPrice,
    strikePrice,
    direction,
    probability,
    trend,
    rsi,
    atr,
    volumeAboveAverage,
  };
}
