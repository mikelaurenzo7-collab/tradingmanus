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
