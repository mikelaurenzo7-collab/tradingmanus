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

// ── Constants ─────────────────────────────────────────────────────────────────

/** 15m candles per trading day (24 h × 4 per hour). */
const PERIODS_PER_DAY_15M = 96;
/** Calendar days per year used for annualisation. */
const DAYS_PER_YEAR = 365;
/** Hours per year (365 × 24). */
const HOURS_PER_YEAR = 8_760;

// ── Technical indicator helpers ───────────────────────────────────────────────

/**
 * Exponential moving average. Applies to an array of price closes.
 */
export function computeEMA(closes: number[], period: number): number {
  if (closes.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = closes[0] ?? 0;
  for (let i = 1; i < closes.length; i++) {
    ema = (closes[i] ?? ema) * k + ema * (1 - k);
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
  /(?:above|exceed|reach|hit|≥|>=)\s*\$?([\d,]+(?:\.\d+)?)/i,
  /(?:below|under|≤|<=)\s*\$?([\d,]+(?:\.\d+)?)/i,
  /\$?([\d,]+(?:\.\d+)?)\s*(?:or (?:above|more|higher)|or (?:below|less|lower))/i,
  /(?:close|end|finish|settle)\s+(?:at|above|below)\s+\$?([\d,]+(?:\.\d+)?)/i,
  // Fallback: bare 4+ digit number (e.g. "Will Bitcoin hit 100000")
  // Valid only when no dollar-sign pattern matched and the number is within
  // a plausible crypto-price range (100 to 10,000,000).
  /\b(\d{4,9}(?:\.\d+)?)\b/,
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
      // Bare-number fallback: only accept values in a plausible crypto range.
      const isBareFallback = pattern.source.startsWith("\\b(\\d{4,9}");
      if (
        Number.isFinite(strikePrice) &&
        strikePrice > 0 &&
        (!isBareFallback || (strikePrice >= 100 && strikePrice <= 10_000_000))
      ) {
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
  if (/\b(ethereum|eth)\b/.test(text)) return "ETHUSDT";
  if (/\b(solana|sol)\b/.test(text)) return "SOLUSDT";
  if (/\b(xrp|ripple)\b/.test(text)) return "XRPUSDT";
  if (/\b(doge|dogecoin)\b/.test(text)) return "DOGEUSDT";
  if (/\b(pepe)\b/.test(text)) return "PEPEUSDT";
  if (/\b(wif|dogwifhat)\b/.test(text)) return "WIFUSDT";
  if (/\b(avalanche|avax)\b/.test(text)) return "AVAXUSDT";
  if (/\b(cardano|ada)\b/.test(text)) return "ADAUSDT";
  if (/\b(polkadot|dot)\b/.test(text)) return "DOTUSDT";
  if (/\b(chainlink|link)\b/.test(text)) return "LINKUSDT";
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
 * Compute the BSM-style N(d₁) probability for a binary price outcome.
 *
 * Shared by `computeCryptoFundamentalPrior` (live trading) and
 * `backtestCryptoStrategy` (simulation) so the model is maintained in one
 * place.
 *
 * @param klines            15m OHLCV history (min 20 candles).
 * @param strikePrice       The price level the market resolves around.
 * @param direction         "above" or "below" (YES direction).
 * @param hoursToResolution Time until resolution in hours.
 * @returns P(YES) clamped to [0.05, 0.95], or null if inputs are invalid.
 */
export function computeBSMProbability(
  klines: BinanceKline[],
  strikePrice: number,
  direction: "above" | "below",
  hoursToResolution: number,
): number | null {
  if (klines.length < 20 || strikePrice <= 0 || hoursToResolution <= 0) return null;

  const closes = klines.map((k) => k.close);
  const currentPrice = closes[closes.length - 1]!;
  if (currentPrice <= 0) return null;

  const ema9 = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const rsi = computeRSI(closes, 14);
  const atr = computeATR(klines, 14);
  const volumeSMA = computeVolumeSMA(klines, 20);
  const lastVolume = klines[klines.length - 1]!.volume;
  const volumeAboveAverage = lastVolume > volumeSMA * 1.2;

  const trend: "bullish" | "bearish" | "neutral" =
    ema9 > ema21 * 1.001 ? "bullish" : ema9 < ema21 * 0.999 ? "bearish" : "neutral";

  // Annualised σ from ATR(14) on 15m candles.
  // 96 periods/day × √365 days/year gives the annualisation factor.
  // Floor at 1% (0.01) annual vol: below this, the BSM d₁ becomes numerically
  // unstable and real crypto markets never sustain sub-1% annualised volatility.
  const atrFraction = atr / currentPrice;
  const annualizedSigma = Math.max(0.01, atrFraction * Math.sqrt(PERIODS_PER_DAY_15M * DAYS_PER_YEAR));

  // ±10 % drift bias from EMA crossover direction.
  const mu = trend === "bullish" ? 0.1 : trend === "bearish" ? -0.1 : 0.0;

  // Time in years; floored at 1 hour to keep T > 0.
  const T = Math.max(1 / HOURS_PER_YEAR, hoursToResolution / HOURS_PER_YEAR);

  // BSM d₁ → P(S_T > K) = N(d₁).
  const d1 =
    (Math.log(currentPrice / strikePrice) +
      (mu + 0.5 * annualizedSigma ** 2) * T) /
    (annualizedSigma * Math.sqrt(T));

  const pAbove = normalCDF(d1);
  let rawProb = direction === "above" ? pAbove : 1 - pAbove;

  // RSI overbought (>70) / oversold (<30) nudge — standard technical levels.
  // ±0.05 is a conservative 5% adjustment that avoids overriding the BSM
  // geometric prior while still capturing mean-reversion tendencies.
  if (rsi > 70) rawProb -= 0.05;
  if (rsi < 30) rawProb += 0.05;

  // Volume confirmation.  volBias is positive when bullish, negative when
  // bearish — reflecting the direction price is likely to move.  For an
  // "above" market, bullish volume boosts P; for a "below" market it hurts P.
  // The negation for "below" is intentional: −(+0.02) reduces P(below) when
  // the trend is bullish (price moving away from resolving below the strike),
  // and −(−0.02) = +0.02 increases P(below) when trend is bearish.
  if (volumeAboveAverage) {
    const volBias = trend === "bullish" ? 0.02 : trend === "bearish" ? -0.02 : 0;
    rawProb += direction === "above" ? volBias : -volBias;
  }

  return Math.max(0.05, Math.min(0.95, rawProb));
}

/**
 * Estimate P(YES) for a Kalshi crypto binary market using Binance klines.
 *
 * Returns null when:
 *   - Fewer than 20 klines are available (insufficient history).
 *   - The market title cannot be parsed to extract a strike price.
 *   - Current or strike price is non-positive.
 *   - The market has already resolved (hoursToResolution ≤ 0).
 */
export function computeCryptoFundamentalPrior(
  market: KalshiMarket,
  klines: BinanceKline[],
  hoursToResolution: number,
): CryptoTechnicalAnalysis | null {
  if (klines.length < 20 || hoursToResolution <= 0) return null;

  const strikeParse = extractCryptoStrike(market.title ?? "");
  if (!strikeParse) return null;

  const { strikePrice, direction } = strikeParse;
  const closes = klines.map((k) => k.close);
  const currentPrice = closes[closes.length - 1]!;

  if (currentPrice <= 0 || strikePrice <= 0) return null;

  const ema9 = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const rsi = computeRSI(closes, 14);
  const atr = computeATR(klines, 14);
  const volumeSMA = computeVolumeSMA(klines, 20);
  const lastVolume = klines[klines.length - 1]!.volume;
  const volumeAboveAverage = lastVolume > volumeSMA * 1.2;

  const trend: "bullish" | "bearish" | "neutral" =
    ema9 > ema21 * 1.001 ? "bullish" : ema9 < ema21 * 0.999 ? "bearish" : "neutral";

  const probability = computeBSMProbability(klines, strikePrice, direction, hoursToResolution);
  if (probability === null) return null;

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
