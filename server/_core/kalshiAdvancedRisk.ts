/**
 * Advanced Risk Management for Kalshi Markets
 * Dynamic position sizing, volatility-based limits, drawdown monitoring
 */

export interface RiskMetrics {
  volatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
  recoveryFactor: number;
  profitFactor: number;
  riskPerTrade: number;
}

export interface RiskLimits {
  maxLossPerTrade: number;
  maxLossPerDay: number;
  maxLossPerWeek: number;
  maxDrawdown: number;
  maxPositionSize: number;
  maxCorrelation: number;
}

export interface PositionRisk {
  marketId: string;
  size: number;
  riskAmount: number;
  riskPercent: number;
  maxLoss: number;
  stopLoss: number;
  takeProfit: number;
}

/**
 * Calculate volatility from returns
 */
export function calculateVolatility(returns: number[]): number {
  if (returns.length < 2) return 0;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) /
    returns.length;
  return Math.sqrt(variance);
}

/**
 * Calculate Sharpe Ratio (risk-adjusted returns)
 */
export function calculateSharpeRatio(
  returns: number[],
  riskFreeRate = 0.02
): number {
  if (returns.length < 2) return 0;

  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const volatility = calculateVolatility(returns);

  if (volatility === 0) return 0;
  return (avgReturn - riskFreeRate) / volatility;
}

/**
 * Calculate maximum drawdown
 */
export function calculateMaxDrawdown(equity: number[]): number {
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
 * Calculate recovery factor (profit / max loss)
 */
export function calculateRecoveryFactor(
  totalProfit: number,
  maxLoss: number
): number {
  if (maxLoss === 0) return 0;
  return totalProfit / Math.abs(maxLoss);
}

/**
 * Calculate profit factor (gross profit / gross loss)
 */
export function calculateProfitFactor(
  wins: number[],
  losses: number[]
): number {
  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

  if (grossLoss === 0) return 0;
  return grossProfit / grossLoss;
}

/**
 * Dynamic position sizing based on volatility
 * Higher volatility = smaller positions
 */
export function calculateVolatilityAdjustedSize(
  baseSize: number,
  volatility: number,
  targetVolatility = 0.02
): number {
  if (volatility === 0) return baseSize;
  return baseSize * (targetVolatility / volatility);
}

/**
 * Check if position violates risk limits
 */
export function checkRiskLimits(
  position: PositionRisk,
  limits: RiskLimits,
  currentDrawdown: number,
  dailyLoss: number,
  weeklyLoss: number
): { allowed: boolean; reason?: string } {
  if (position.riskPercent > limits.maxLossPerTrade / 100) {
    return { allowed: false, reason: "Exceeds max loss per trade" };
  }

  if (dailyLoss > limits.maxLossPerDay) {
    return { allowed: false, reason: "Exceeds max daily loss" };
  }

  if (weeklyLoss > limits.maxLossPerWeek) {
    return { allowed: false, reason: "Exceeds max weekly loss" };
  }

  if (currentDrawdown > limits.maxDrawdown) {
    return { allowed: false, reason: "Exceeds max drawdown" };
  }

  if (position.size > limits.maxPositionSize) {
    return { allowed: false, reason: "Exceeds max position size" };
  }

  return { allowed: true };
}

/**
 * Calculate stop loss and take profit levels
 */
export function calculateStopLevels(
  entryPrice: number,
  confidence: number,
  riskPercent = 0.02
): { stopLoss: number; takeProfit: number } {
  // Risk-reward ratio based on confidence
  const riskRewardRatio = 1 / (confidence * 2); // Higher confidence = better ratio

  const riskAmount = entryPrice * riskPercent;
  const stopLoss = entryPrice - riskAmount;
  const takeProfit = entryPrice + riskAmount * riskRewardRatio;

  return { stopLoss, takeProfit };
}

/**
 * Monitor and alert on risk thresholds
 */
export function generateRiskAlerts(
  currentMetrics: RiskMetrics,
  limits: RiskLimits
): string[] {
  const alerts: string[] = [];

  if (currentMetrics.maxDrawdown > limits.maxDrawdown * 0.8) {
    alerts.push(
      `WARNING: Drawdown at ${(currentMetrics.maxDrawdown * 100).toFixed(1)}% (limit: ${(limits.maxDrawdown * 100).toFixed(1)}%)`
    );
  }

  if (currentMetrics.sharpeRatio < 0.5) {
    alerts.push("WARNING: Sharpe ratio below 0.5 - poor risk-adjusted returns");
  }

  if (currentMetrics.profitFactor < 1.5) {
    alerts.push(
      "WARNING: Profit factor below 1.5 - losses approaching profits"
    );
  }

  if (currentMetrics.volatility > 0.1) {
    alerts.push(
      `WARNING: High volatility detected (${(currentMetrics.volatility * 100).toFixed(1)}%)`
    );
  }

  return alerts;
}

/**
 * Recommend position adjustments based on risk
 */
export function recommendAdjustments(
  metrics: RiskMetrics,
  limits: RiskLimits
): string[] {
  const recommendations: string[] = [];

  if (metrics.maxDrawdown > limits.maxDrawdown * 0.7) {
    recommendations.push("Consider reducing position sizes");
  }

  if (metrics.volatility > 0.08) {
    recommendations.push("Reduce exposure due to high volatility");
  }

  if (metrics.sharpeRatio < 1.0) {
    recommendations.push("Review strategy - risk-adjusted returns are weak");
  }

  if (metrics.profitFactor < 2.0) {
    recommendations.push("Tighten stop losses to improve profit factor");
  }

  return recommendations;
}

// ── Portfolio-Level Volatility Targeting ──────────────────────────────────────

const TARGET_VOL_ANNUAL = 0.15;         // 15% annual target vol
const TRADING_DAYS_PER_YEAR = 252;
const VOL_LOOKBACK_DAYS = 30;          // rolling window for returns-based vol
const VOL_HIGH_THRESHOLD_1 = 0.20;     // >20% → reduce 30%
const VOL_HIGH_THRESHOLD_2 = 0.25;     // >25% → reduce 50%, block high-risk
const VOL_LOW_THRESHOLD = 0.10;        // <10% → increase 20%
const VOL_HARD_CAP = 0.30;            // >30% → block all new positions

export interface PositionVolData {
  positionId: string;
  weight: number;     // fraction of portfolio (0-1)
  dailyVol: number;   // daily volatility (0-1 scale)
  /** Daily returns (use last 30 days; longer arrays are sliced internally) */
  returns: number[];
}

export interface PortfolioVolResult {
  portfolioVolatility: number;
  dailyVol: number;
  volScalingFactor: number;
  isHighVol: boolean;
  isExtremeVol: boolean;
  isHardBlocked: boolean;
  isLowVol: boolean;
  shouldBlockHighRiskSignals: boolean;
}

/**
 * Calculate standard deviation of an array of numbers.
 * Returns 0 if fewer than 2 values.
 */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Calculate Pearson correlation between two return series.
 * Returns 0 if either series has fewer than 2 values or zero standard deviation.
 */
export function calculateCorrelation(returns1: number[], returns2: number[]): number {
  const n = Math.min(returns1.length, returns2.length);
  if (n < 2) return 0;

  const r1 = returns1.slice(0, n);
  const r2 = returns2.slice(0, n);

  const mean1 = r1.reduce((a, b) => a + b, 0) / n;
  const mean2 = r2.reduce((a, b) => a + b, 0) / n;

  let cov = 0;
  let var1 = 0;
  let var2 = 0;
  for (let i = 0; i < n; i++) {
    const d1 = r1[i] - mean1;
    const d2 = r2[i] - mean2;
    cov += d1 * d2;
    var1 += d1 * d1;
    var2 += d2 * d2;
  }

  const denom = Math.sqrt(var1 * var2);
  if (denom === 0) return 0;
  return cov / denom;
}

/**
 * Calculate portfolio volatility using the variance-covariance matrix.
 * Uses returns data when available; falls back to position.dailyVol.
 */
export function calculatePortfolioVol(positions: PositionVolData[]): number {
  if (positions.length === 0) return 0;

  // Per-position sigma: prefer stdDev of last 30 returns if available
  const sigmas = positions.map((p) => {
    const sliced = p.returns.slice(-VOL_LOOKBACK_DAYS);
    if (sliced.length >= 2) return stdDev(sliced);
    return p.dailyVol;
  });

  // Portfolio variance = sum_i sum_j w_i * w_j * cov(i,j)
  let portfolioVariance = 0;
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      const ri = positions[i].returns.slice(-VOL_LOOKBACK_DAYS);
      const rj = positions[j].returns.slice(-VOL_LOOKBACK_DAYS);
      const rho = i === j ? 1 : calculateCorrelation(ri, rj);
      portfolioVariance += positions[i].weight * positions[j].weight * rho * sigmas[i] * sigmas[j];
    }
  }

  return Math.sqrt(Math.max(0, portfolioVariance));
}

/**
 * Determine vol scaling factor and constraint flags from current annualized vol.
 */
export function getVolScalingFactor(annualizedVol: number): Pick<
  PortfolioVolResult,
  "volScalingFactor" | "isHighVol" | "isExtremeVol" | "isHardBlocked" | "isLowVol" | "shouldBlockHighRiskSignals"
> {
  if (annualizedVol > VOL_HARD_CAP) {
    return { volScalingFactor: 0, isHighVol: true, isExtremeVol: true, isHardBlocked: true, isLowVol: false, shouldBlockHighRiskSignals: true };
  }
  if (annualizedVol > VOL_HIGH_THRESHOLD_2) {
    return { volScalingFactor: 0.50, isHighVol: true, isExtremeVol: true, isHardBlocked: false, isLowVol: false, shouldBlockHighRiskSignals: true };
  }
  if (annualizedVol > VOL_HIGH_THRESHOLD_1) {
    return { volScalingFactor: 0.70, isHighVol: true, isExtremeVol: false, isHardBlocked: false, isLowVol: false, shouldBlockHighRiskSignals: false };
  }
  if (annualizedVol < VOL_LOW_THRESHOLD) {
    return { volScalingFactor: 1.20, isHighVol: false, isExtremeVol: false, isHardBlocked: false, isLowVol: true, shouldBlockHighRiskSignals: false };
  }
  return { volScalingFactor: 1.00, isHighVol: false, isExtremeVol: false, isHardBlocked: false, isLowVol: false, shouldBlockHighRiskSignals: false };
}

/**
 * Main entry point: calculate full portfolio volatility result from position data.
 * Annualizes daily vol using sqrt(TRADING_DAYS_PER_YEAR).
 */
export function calculatePortfolioVolatility(positions: PositionVolData[]): PortfolioVolResult {
  const dailyVol = calculatePortfolioVol(positions);
  const portfolioVolatility = dailyVol * Math.sqrt(TRADING_DAYS_PER_YEAR);
  const scaling = getVolScalingFactor(portfolioVolatility);
  return {
    portfolioVolatility,
    dailyVol,
    ...scaling,
  };
}

export { TARGET_VOL_ANNUAL, TRADING_DAYS_PER_YEAR };
