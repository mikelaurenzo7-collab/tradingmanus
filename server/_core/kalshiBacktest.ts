/**
 * Backtesting Framework for Kalshi Markets
 * Historical strategy validation, Monte Carlo simulation, walk-forward analysis
 */

export interface BacktestTrade {
  marketId: string;
  entryPrice: number;
  exitPrice: number;
  size: number;
  entryTime: number;
  exitTime: number;
  pnl: number;
  pnlPercent: number;
  side: string;
}

export interface BacktestResults {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  averageWin: number;
  averageLoss: number;
  trades: BacktestTrade[];
}

/**
 * Simulate trades based on historical data
 */
export function simulateTrades(
  signals: Array<{ marketId: string; side: string; confidence: number }>,
  historicalPrices: Map<string, number[]>,
  entryIndex: number,
  exitIndex: number,
  positionSize: number
): BacktestTrade[] {
  const trades: BacktestTrade[] = [];

  signals.forEach((signal) => {
    const prices = historicalPrices.get(signal.marketId);
    if (!prices || entryIndex >= prices.length || exitIndex > prices.length) {
      return;
    }

    const entryPrice = prices[entryIndex];
    const exitPrice = prices[Math.min(exitIndex, prices.length - 1)];

    const pnl =
      signal.side === "yes"
        ? (exitPrice - entryPrice) * positionSize
        : (entryPrice - exitPrice) * positionSize;

    trades.push({
      marketId: signal.marketId,
      entryPrice,
      exitPrice,
      size: positionSize,
      entryTime: entryIndex,
      exitTime: Math.min(exitIndex, prices.length - 1),
      pnl,
      pnlPercent: pnl / (entryPrice * positionSize),
      side: signal.side,
    });
  });

  return trades;
}

/**
 * Calculate backtest statistics
 */
export function calculateBacktestStats(trades: BacktestTrade[]): BacktestResults {
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalPnL: 0,
      totalReturn: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      profitFactor: 0,
      averageWin: 0,
      averageLoss: 0,
      trades: [],
    };
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);

  const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
  const totalCapital = trades.reduce((sum, t) => sum + t.size * t.entryPrice, 0);
  const totalReturn = totalCapital > 0 ? totalPnL / totalCapital : 0;

  const returns = trades.map((t) => t.pnlPercent);
  const sharpeRatio = calculateSharpeFromReturns(returns);

  const equity = calculateEquityCurve(trades);
  const maxDrawdown = calculateMaxDrawdown(equity);

  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

  const averageWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const averageLoss = losses.length > 0 ? grossLoss / losses.length : 0;

  return {
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: wins.length / trades.length,
    totalPnL,
    totalReturn,
    sharpeRatio,
    maxDrawdown,
    profitFactor,
    averageWin,
    averageLoss,
    trades,
  };
}

/**
 * Calculate equity curve from trades
 */
export function calculateEquityCurve(
  trades: BacktestTrade[],
  startingCapital = 0
): number[] {
  const equity: number[] = [startingCapital];
  let currentEquity = startingCapital;

  trades.forEach((trade) => {
    currentEquity += trade.pnl;
    equity.push(Math.max(0, currentEquity)); // Prevent negative equity
  });

  return equity;
}

/**
 * Calculate Sharpe ratio from returns
 */
function calculateSharpeFromReturns(returns: number[]): number {
  if (returns.length < 2) return 0;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) /
    returns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;
  return (mean * 252) / stdDev; // Annualized
}

/**
 * Calculate maximum drawdown
 */
function calculateMaxDrawdown(equity: number[]): number {
  if (equity.length < 2) return 0;

  let maxDrawdown = 0;
  let peak = equity[0];

  for (let i = 1; i < equity.length; i++) {
    const drawdown = (peak - equity[i]) / peak;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    peak = Math.max(peak, equity[i]);
  }

  return maxDrawdown;
}

/**
 * Monte Carlo simulation for strategy robustness
 */
export function monteCarloSimulation(
  trades: BacktestTrade[],
  iterations = 1000
): { avgReturn: number; stdDev: number; worstCase: number; bestCase: number } {
  if (trades.length === 0) {
    return { avgReturn: 0, stdDev: 0, worstCase: 0, bestCase: 0 };
  }

  const returns = trades.map((t) => t.pnlPercent);
  const results: number[] = [];

  for (let i = 0; i < iterations; i++) {
    let totalReturn = 0;
    for (let j = 0; j < trades.length; j++) {
      const randomIndex = Math.floor(Math.random() * returns.length);
      totalReturn += returns[randomIndex];
    }
    results.push(totalReturn);
  }

  const avgReturn = results.reduce((a, b) => a + b, 0) / results.length;
  const variance =
    results.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
    results.length;
  const stdDev = Math.sqrt(variance);

  return {
    avgReturn,
    stdDev,
    worstCase: Math.min(...results),
    bestCase: Math.max(...results),
  };
}

/**
 * Walk-forward validation
 * Test strategy on different time periods
 */
export function walkForwardValidation(
  allTrades: BacktestTrade[],
  windowSize: number
): BacktestResults[] {
  const results: BacktestResults[] = [];

  for (let i = 0; i + windowSize <= allTrades.length; i += windowSize) {
    const window = allTrades.slice(i, i + windowSize);
    results.push(calculateBacktestStats(window));
  }

  return results;
}

/**
 * Compare strategy performance across periods
 */
export function comparePerformance(
  results: BacktestResults[]
): { consistent: boolean; avgWinRate: number; volatility: number } {
  if (results.length === 0) {
    return { consistent: false, avgWinRate: 0, volatility: 0 };
  }

  const winRates = results.map((r) => r.winRate);
  const avgWinRate = winRates.reduce((a, b) => a + b, 0) / winRates.length;

  const variance =
    winRates.reduce((sum, wr) => sum + Math.pow(wr - avgWinRate, 2), 0) /
    winRates.length;
  const volatility = Math.sqrt(variance);

  const consistent = volatility < 0.1; // Low variance = consistent

  return { consistent, avgWinRate, volatility };
}

// ── Binance-powered crypto strategy backtest ──────────────────────────────────

import type { BinanceKline } from "./binanceClient";
import { computeBSMProbability } from "./cryptoTechnicals";

export interface CryptoBacktestConfig {
  /** Binance trading pair, e.g. "BTCUSDT". */
  symbol: string;
  /** Strike price the Kalshi market resolves around. */
  strikePrice: number;
  /** "yes" = bet BTC closes ABOVE strike; "no" = bet BELOW. */
  side: "yes" | "no";
  /** Width of the look-back window in 15m candles. Default 96 (= 24 h). */
  lookbackCandles?: number;
  /** How many 15m candles to hold before checking resolution. Default 96. */
  resolutionCandles?: number;
  /** Minimum edge required to enter a trade (raw probability – 0.5). Default 0.07. */
  minEdge?: number;
  /** Simulated Kalshi contract cost per trade (as a probability, 0–1). Default 0.5. */
  kalshiEntryPrice?: number;
}

export interface CryptoBacktestResult extends BacktestResults {
  symbol: string;
  strikePrice: number;
  side: "yes" | "no";
  signalCount: number;
  filteredByEdge: number;
}

/**
 * Backtest the 15m Binance → Kalshi crypto strategy against historical klines.
 *
 * Simulation logic (per 15m candle i, starting at lookbackCandles):
 *   1. Slice the preceding `lookbackCandles` candles as the analysis window.
 *   2. Call `computeBSMProbability` (the same model used in live trading).
 *   3. If probability advantage > minEdge, simulate a Kalshi binary trade:
 *      - Entry price = kalshiEntryPrice (simulated Kalshi market price).
 *      - Resolution close = klines[i + resolutionCandles].close.
 *      - PnL = (exitPrice − entryPrice) × positionSize.
 *   4. Collect all simulated trades and return CryptoBacktestResult.
 *
 * The `klines` array must be pre-fetched from Binance via `fetchBinanceKlines`.
 * Use at least `lookbackCandles + resolutionCandles + 1` candles for meaningful
 * results (e.g. 1000 candles covers ~10 days of 15m data).
 */
export function backtestCryptoStrategy(
  klines: BinanceKline[],
  config: CryptoBacktestConfig,
): CryptoBacktestResult {
  const {
    symbol,
    strikePrice,
    side,
    lookbackCandles = 96,
    resolutionCandles = 96,
    minEdge = 0.07,
    kalshiEntryPrice = 0.5,
  } = config;

  const direction = side === "yes" ? "above" : "below";
  const positionSize = 1; // 1 contract per trade — caller can scale
  const trades: BacktestTrade[] = [];
  let signalCount = 0;
  let filteredByEdge = 0;

  // Walk forward: entry at candle i, resolution close at candle i + resolutionCandles.
  // Loop bound: i + resolutionCandles < klines.length  ↔  i < klines.length - resolutionCandles.
  const endIdx = klines.length - resolutionCandles;
  for (let i = lookbackCandles; i < endIdx; i++) {
    const window = klines.slice(i - lookbackCandles, i);

    // hoursToResolution: resolutionCandles × 15 min / 60 min per hour.
    const hoursToResolution = (resolutionCandles * 15) / 60;

    const prob = computeBSMProbability(window, strikePrice, direction, hoursToResolution);
    if (prob === null) continue;

    signalCount++;
    const edge = prob - kalshiEntryPrice;
    if (edge < minEdge) {
      filteredByEdge++;
      continue;
    }

    // Resolution: check the close price exactly `resolutionCandles` candles ahead.
    // Index is i + resolutionCandles; the loop guarantees this is within bounds.
    const resolutionKline = klines[i + resolutionCandles];
    const entryKline = klines[i];
    if (!resolutionKline || !entryKline) continue;

    const resolutionClose = resolutionKline.close;
    const resolvedYes =
      side === "yes"
        ? resolutionClose >= strikePrice
        : resolutionClose < strikePrice;

    const exitPrice = resolvedYes ? 1.0 : 0.0;
    const pnl = (exitPrice - kalshiEntryPrice) * positionSize;

    trades.push({
      marketId: `${symbol}-${strikePrice}-${side}-@${i}`,
      entryPrice: kalshiEntryPrice,
      exitPrice,
      size: positionSize,
      entryTime: entryKline.openTime,
      exitTime: resolutionKline.closeTime,
      pnl,
      pnlPercent: pnl / kalshiEntryPrice,
      side,
    });
  }

  const stats = calculateBacktestStats(trades);
  return {
    ...stats,
    symbol,
    strikePrice,
    side,
    signalCount,
    filteredByEdge,
  };
}
