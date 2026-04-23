/**
 * Phase 6: Learning Loop
 * Tracks trades, analyzes outcomes, and learns from performance
 */

import * as db from "../db";

export interface TradeRecord {
  id: string;
  marketId: string;
  signalId: string;
  signalType: string;
  side: "yes" | "no";
  entryPrice: number;
  entryQuantity: number;
  exitPrice?: number;
  exitQuantity?: number;
  pnl?: number;
  pnlPercent?: number;
  outcome?: "win" | "loss" | "breakeven";
  entryTime: Date;
  exitTime?: Date;
  reasoning: string;
  status: "open" | "closed" | "partial";
}

export interface PerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  totalPnL: number;
  sharpeRatio: number;
  maxDrawdown: number;
  recoveryFactor: number;
}

export interface SignalPerformance {
  signalType: string;
  totalSignals: number;
  successfulSignals: number;
  successRate: number;
  avgConfidence: number;
  totalPnL: number;
  profitFactor: number;
  recommendation: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
}

/**
 * Record a new trade entry from a signal
 */
export async function recordTradeEntry(
  marketId: string,
  signalId: string,
  signalType: string,
  side: "yes" | "no",
  entryPrice: number,
  entryQuantity: number,
  reasoning: string
): Promise<TradeRecord> {
  const tradeId = `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const trade: TradeRecord = {
    id: tradeId,
    marketId,
    signalId,
    signalType,
    side,
    entryPrice,
    entryQuantity,
    entryTime: new Date(),
    reasoning,
    status: "open",
  };

  // Store in database using existing position creation
  await db.createKalshiPosition({
    marketId,
    side,
    quantity: entryQuantity,
    entryPrice,
  });
  
  console.log(`[Learning] Trade recorded: ${tradeId} - ${signalType} ${side} @ $${entryPrice}`);
  return trade;
}

/**
 * Record trade exit and calculate P&L
 */
export async function recordTradeExit(
  positionId: number,
  exitPrice: number
): Promise<TradeRecord | null> {
  // Use existing position close function
  await db.closeKalshiPosition(positionId, exitPrice);
  
  console.log(`[Learning] Trade closed: Position ${positionId} @ $${exitPrice}`);
  return null; // Return null since we don't have direct access to the trade record
}

/**
 * Calculate comprehensive performance metrics
 */
export async function calculatePerformanceMetrics(): Promise<PerformanceMetrics> {
  const trades = await db.getKalshiTradeHistory(1000);
  const closedTrades = trades.filter((t: any) => t.positionStatus === "closed");
  
  if (closedTrades.length === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      breakevenTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      totalPnL: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      recoveryFactor: 0,
    };
  }

  const winningTrades = closedTrades.filter((t: any) => (t.realizedPnl || 0) > 0);
  const losingTrades = closedTrades.filter((t: any) => (t.realizedPnl || 0) < 0);
  const breakevenTrades = closedTrades.filter((t: any) => (t.realizedPnl || 0) === 0);

  const totalPnL = closedTrades.reduce((sum: number, t: any) => sum + (t.realizedPnl || 0), 0);
  const totalWins = winningTrades.reduce((sum: number, t: any) => sum + (t.realizedPnl || 0), 0);
  const totalLosses = losingTrades.reduce((sum: number, t: any) => sum + Math.abs(t.realizedPnl || 0), 0);

  const avgWin = winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

  // Calculate Sharpe Ratio (simplified: using returns and std dev)
  const returns = closedTrades.map((t: any) => {
    const pnl = t.realizedPnL || 0;
    return ((pnl / (t.entryPrice * t.quantity)) * 100);
  });
  const meanReturn = returns.reduce((a: number, b: number) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum: number, r: number) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? meanReturn / stdDev : 0;

  // Calculate Max Drawdown
  let maxDrawdown = 0;
  let peak = 0;
  let cumulative = 0;
  for (const trade of closedTrades) {
    cumulative += trade.realizedPnL || 0;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const recoveryFactor = maxDrawdown > 0 ? totalPnL / maxDrawdown : 0;

  return {
    totalTrades: closedTrades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    breakevenTrades: breakevenTrades.length,
    winRate: (winningTrades.length / closedTrades.length) * 100,
    avgWin,
    avgLoss,
    profitFactor,
    totalPnL,
    sharpeRatio,
    maxDrawdown,
    recoveryFactor,
  };
}

/**
 * Analyze performance by signal type
 */
export async function analyzeSignalPerformance(): Promise<SignalPerformance[]> {
  const trades = await db.getKalshiTradeHistory(1000);
  const signals = await db.getRecentSignals(1000);
  const closedTrades = trades.filter((t: any) => t.positionStatus === "closed");

  const signalMap = new Map<string, SignalPerformance>();

  // Group trades by signal type (using market as proxy)
  for (const trade of closedTrades) {
    const signalType = "momentum"; // Default - in real scenario would link to signal
    if (!signalMap.has(signalType)) {
      signalMap.set(signalType, {
        signalType,
        totalSignals: 0,
        successfulSignals: 0,
        successRate: 0,
        avgConfidence: 0,
        totalPnL: 0,
        profitFactor: 0,
        recommendation: "hold",
      });
    }

    const perf = signalMap.get(signalType)!;
    perf.totalSignals++;
    if ((trade.realizedPnL || 0) > 0) perf.successfulSignals++;
    perf.totalPnL += trade.realizedPnL || 0;
  }

  // Calculate averages and recommendations
  signalMap.forEach((perf) => {
    perf.successRate = perf.totalSignals > 0 ? (perf.successfulSignals / perf.totalSignals) * 100 : 0;

    // Find signals of this type and calculate avg confidence
    const relevantSignals = signals.filter((s: any) => s.signalType === perf.signalType);
    if (relevantSignals.length > 0) {
      perf.avgConfidence = relevantSignals.reduce((sum: number, s: any) => sum + s.confidence, 0) / relevantSignals.length;
    }

    // Generate recommendation
    if (perf.successRate >= 60 && perf.totalPnL > 0) {
      perf.recommendation = perf.avgConfidence > 0.8 ? "strong_buy" : "buy";
    } else if (perf.successRate < 40 || perf.totalPnL < 0) {
      perf.recommendation = perf.avgConfidence < 0.5 ? "strong_sell" : "sell";
    }
  });

  const result: SignalPerformance[] = [];
  signalMap.forEach((perf) => {
    result.push({
      ...perf,
      profitFactor: perf.totalPnL > 0 && perf.totalSignals > 0 ? perf.totalPnL / perf.totalSignals : 0,
    });
  });
  return result;
}

/**
 * Get trade history with filtering
 */
export async function getTradeHistory(filters?: {
  status?: "open" | "closed" | "partial";
  signalType?: string;
  outcome?: "win" | "loss" | "breakeven";
  limit?: number;
}): Promise<TradeRecord[]> {
  const trades = await db.getKalshiTradeHistory(filters?.limit || 50);
  return trades.map((t: any) => ({
    id: `trade-${t.id}`,
    marketId: t.marketId,
    signalId: "",
    signalType: "momentum",
    side: t.side,
    entryPrice: t.entryPrice,
    entryQuantity: t.quantity,
    exitPrice: t.currentPrice,
    exitQuantity: t.quantity,
    pnl: t.realizedPnL,
    pnlPercent: t.realizedPnL ? ((t.realizedPnL / (t.entryPrice * t.quantity)) * 100) : 0,
    outcome: (t.realizedPnL || 0) > 0 ? "win" : (t.realizedPnL || 0) < 0 ? "loss" : "breakeven",
    entryTime: t.createdAt || new Date(),
    exitTime: t.closedAt,
    reasoning: "",
    status: t.positionStatus,
  }));
}

/**
 * Calculate win/loss streaks
 */
export async function calculateStreaks(): Promise<{
  currentWinStreak: number;
  maxWinStreak: number;
  currentLossStreak: number;
  maxLossStreak: number;
}> {
  const trades = await db.getKalshiTradeHistory(1000);
  const closedTrades = trades.filter((t: any) => t.positionStatus === "closed");
  
  let currentWinStreak = 0;
  let maxWinStreak = 0;
  let currentLossStreak = 0;
  let maxLossStreak = 0;

  for (const trade of closedTrades) {
    const pnl = trade.realizedPnL || 0;
    if (pnl > 0) {
      currentWinStreak++;
      currentLossStreak = 0;
      if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
    } else if (pnl < 0) {
      currentLossStreak++;
      currentWinStreak = 0;
      if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
    }
  }

  return {
    currentWinStreak,
    maxWinStreak,
    currentLossStreak,
    maxLossStreak,
  };
}
