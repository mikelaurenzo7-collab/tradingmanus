/**
 * Phase 6: Learning Loop
 * Tracks trades, analyzes outcomes, and learns from performance
 */

import * as db from "../db";
import { assertPositiveIntegerUserId } from "./userScope";
import { logger } from "./logger";

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
  dailyPnL: number;
  sharpeRatio: number;
  maxDrawdown: number;
  recoveryFactor: number;
  realizedPnL: number;
  unrealizedPnL: number;
  activePositions: number;
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

type TradeLike = {
  marketId?: string | null;
  entryPrice?: number | null;
  quantity?: number | null;
  realizedPnl?: number | null;
  realizedPnL?: number | null;
  closedAt?: Date | string | null;
  positionStatus?: string | null;
};

type OpenPositionLike = {
  unrealizedPnl?: number | null;
  unrealizedPnL?: number | null;
};

type SignalLike = {
  marketId?: string | null;
  signalType?: string | null;
  confidence?: number | null;
  expectedValue?: number | null;
};

export interface PerformanceOverview {
  startingBalance: number;
  currentBalance: number;
  metrics: PerformanceMetrics;
  signalPerformance: SignalPerformance[];
}

function getTradePnL(trade: TradeLike): number {
  return Number(trade.realizedPnl ?? trade.realizedPnL ?? 0);
}

function getPositionUnrealizedPnL(position: OpenPositionLike): number {
  return Number(position.unrealizedPnl ?? position.unrealizedPnL ?? 0);
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isSameTradingDay(date: Date | null, now: Date): boolean {
  if (!date) return false;

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function calculatePerformanceMetricsFromTrades(
  trades: TradeLike[],
  options?: {
    startingBalance?: number;
    openPositions?: OpenPositionLike[];
    now?: Date;
  }
): PerformanceMetrics {
  const now = options?.now ?? new Date();
  const startingBalance = Math.max(
    Number(options?.startingBalance ?? 100),
    0.01
  );
  const openPositions = options?.openPositions ?? [];
  const closedTrades = trades
    .filter(trade => trade.positionStatus === "closed")
    .slice()
    .sort((a, b) => {
      const left = toDate(a.closedAt)?.getTime() ?? 0;
      const right = toDate(b.closedAt)?.getTime() ?? 0;
      return left - right;
    });

  const unrealizedPnL = openPositions.reduce(
    (total, position) => total + getPositionUnrealizedPnL(position),
    0
  );

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
      dailyPnL: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      recoveryFactor: 0,
      realizedPnL: 0,
      unrealizedPnL,
      activePositions: openPositions.length,
    };
  }

  const winningTrades = closedTrades.filter(trade => getTradePnL(trade) > 0);
  const losingTrades = closedTrades.filter(trade => getTradePnL(trade) < 0);
  const breakevenTrades = closedTrades.filter(
    trade => getTradePnL(trade) === 0
  );

  const realizedPnL = closedTrades.reduce(
    (sum, trade) => sum + getTradePnL(trade),
    0
  );
  const totalWins = winningTrades.reduce(
    (sum, trade) => sum + getTradePnL(trade),
    0
  );
  const totalLosses = losingTrades.reduce(
    (sum, trade) => sum + Math.abs(getTradePnL(trade)),
    0
  );
  const avgWin =
    winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
  const avgLoss =
    losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;
  const profitFactor =
    totalLosses > 0
      ? totalWins / totalLosses
      : totalWins > 0
        ? Number.POSITIVE_INFINITY
        : 0;

  const returns = closedTrades
    .map(trade => {
      const entryNotional = Math.abs(
        Number(trade.entryPrice ?? 0) * Number(trade.quantity ?? 0)
      );
      if (entryNotional <= 0) return null;
      return getTradePnL(trade) / entryNotional;
    })
    .filter(
      (value): value is number => value !== null && Number.isFinite(value)
    );

  const meanReturn =
    returns.length > 0
      ? returns.reduce((sum, value) => sum + value, 0) / returns.length
      : 0;
  const variance =
    returns.length > 0
      ? returns.reduce(
          (sum, value) => sum + Math.pow(value - meanReturn, 2),
          0
        ) / returns.length
      : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? meanReturn / stdDev : 0;

  let peakEquity = startingBalance;
  let runningEquity = startingBalance;
  let maxDrawdown = 0;

  for (const trade of closedTrades) {
    runningEquity += getTradePnL(trade);
    peakEquity = Math.max(peakEquity, runningEquity);
    const drawdown =
      peakEquity > 0 ? (peakEquity - runningEquity) / peakEquity : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }

  const dailyPnL = closedTrades.reduce((sum, trade) => {
    return isSameTradingDay(toDate(trade.closedAt), now)
      ? sum + getTradePnL(trade)
      : sum;
  }, 0);

  return {
    totalTrades: closedTrades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    breakevenTrades: breakevenTrades.length,
    winRate:
      closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0,
    avgWin,
    avgLoss,
    profitFactor,
    totalPnL: realizedPnL + unrealizedPnL,
    dailyPnL,
    sharpeRatio,
    maxDrawdown,
    recoveryFactor:
      maxDrawdown > 0 ? realizedPnL / (maxDrawdown * startingBalance) : 0,
    realizedPnL,
    unrealizedPnL,
    activePositions: openPositions.length,
  };
}

export function analyzeSignalPerformanceFromData(
  signals: SignalLike[],
  trades: TradeLike[]
): SignalPerformance[] {
  const latestOutcomesByMarket = new Map<
    string,
    {
      pnl: number;
      won: boolean;
      closedAt: number;
    }
  >();

  for (const trade of trades) {
    if (trade.positionStatus !== "closed" || !trade.marketId) continue;

    const closedAt = toDate(trade.closedAt)?.getTime() ?? 0;
    const pnl = getTradePnL(trade);
    const existing = latestOutcomesByMarket.get(trade.marketId);

    if (!existing || closedAt >= existing.closedAt) {
      latestOutcomesByMarket.set(trade.marketId, {
        pnl,
        won: pnl > 0,
        closedAt,
      });
    }
  }

  const signalMap = new Map<string, SignalPerformance>();

  for (const signal of signals) {
    if (!signal.signalType) continue;

    const signalType = signal.signalType;
    const performance = signalMap.get(signalType) ?? {
      signalType,
      totalSignals: 0,
      successfulSignals: 0,
      successRate: 0,
      avgConfidence: 0,
      totalPnL: 0,
      profitFactor: 0,
      recommendation: "hold" as const,
    };

    performance.totalSignals += 1;
    performance.avgConfidence += Number(signal.confidence ?? 0);

    const outcome = signal.marketId
      ? latestOutcomesByMarket.get(signal.marketId)
      : undefined;
    if (outcome) {
      if (outcome.won) {
        performance.successfulSignals += 1;
      }
      performance.totalPnL += outcome.pnl;
    }

    signalMap.set(signalType, performance);
  }

  return Array.from(signalMap.values())
    .map(performance => {
      const successRate =
        performance.totalSignals > 0
          ? performance.successfulSignals / performance.totalSignals
          : 0;
      const avgConfidence =
        performance.totalSignals > 0
          ? performance.avgConfidence / performance.totalSignals
          : 0;
      const recommendation: SignalPerformance["recommendation"] =
        successRate >= 0.6 && performance.totalPnL > 0
          ? avgConfidence >= 0.8
            ? "strong_buy"
            : "buy"
          : successRate <= 0.4 || performance.totalPnL < 0
            ? avgConfidence <= 0.5
              ? "strong_sell"
              : "sell"
            : "hold";

      return {
        ...performance,
        successRate,
        avgConfidence,
        profitFactor:
          performance.totalSignals > 0
            ? performance.totalPnL / performance.totalSignals
            : 0,
        recommendation,
      };
    })
    .sort(
      (left, right) =>
        right.totalSignals - left.totalSignals || right.totalPnL - left.totalPnL
    );
}

export async function getPerformanceOverview(userId: number): Promise<PerformanceOverview> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getPerformanceOverview userId");
  const [capital, trades, signals, openPositions] = await Promise.all([
    db.getKalshiCapital(scopedUserId),
    db.getKalshiTradeHistory(1000, scopedUserId),
    db.getRecentSignals(1000, scopedUserId),
    db.getOpenKalshiPositions(scopedUserId),
  ]);

  const startingBalance = Number(
    capital?.startingBalance ?? capital?.currentBalance ?? 0
  );
  const metrics = calculatePerformanceMetricsFromTrades(trades, {
    startingBalance,
    openPositions,
  });

  return {
    startingBalance,
    currentBalance: Number(
      capital?.currentBalance ?? startingBalance + metrics.totalPnL
    ),
    metrics,
    signalPerformance: analyzeSignalPerformanceFromData(signals, trades),
  };
}

/**
 * Record a new trade entry from a signal
 */
export async function recordTradeEntry(
  userId: number,
  marketId: string,
  signalId: string,
  signalType: string,
  side: "yes" | "no",
  entryPrice: number,
  entryQuantity: number,
  reasoning: string
): Promise<TradeRecord> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "recordTradeEntry userId");
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
    userId: scopedUserId,
    marketId,
    side,
    quantity: entryQuantity,
    entryPrice,
  });

  logger.info(
    { tradeId, signalType, side, entryPrice },
    "[Learning] Trade recorded",
  );
  return trade;
}

/**
 * Record trade exit and calculate P&L
 */
export async function recordTradeExit(
  userId: number,
  positionId: number,
  exitPrice: number
): Promise<TradeRecord | null> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "recordTradeExit userId");
  // Use existing position close function
  await db.closeKalshiPosition(positionId, exitPrice, scopedUserId);

  logger.info(
    { positionId, exitPrice },
    "[Learning] Trade closed",
  );
  return null; // Return null since we don't have direct access to the trade record
}

/**
 * Calculate comprehensive performance metrics
 */
export async function calculatePerformanceMetrics(userId: number): Promise<PerformanceMetrics> {
  const overview = await getPerformanceOverview(userId);
  return overview.metrics;
}

/**
 * Analyze performance by signal type
 */
export async function analyzeSignalPerformance(userId: number): Promise<SignalPerformance[]> {
  const overview = await getPerformanceOverview(userId);
  return overview.signalPerformance;
}

/**
 * Get trade history with filtering
 */
export async function getTradeHistory(userId: number, filters?: {
  status?: "open" | "closed" | "partial";
  signalType?: string;
  outcome?: "win" | "loss" | "breakeven";
  limit?: number;
}): Promise<TradeRecord[]> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getTradeHistory userId");
  const trades = await db.getKalshiTradeHistory(filters?.limit || 50, scopedUserId);
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
    pnl: getTradePnL(t),
    pnlPercent: getTradePnL(t)
      ? (getTradePnL(t) / (t.entryPrice * t.quantity)) * 100
      : 0,
    outcome:
      getTradePnL(t) > 0 ? "win" : getTradePnL(t) < 0 ? "loss" : "breakeven",
    entryTime: t.createdAt || new Date(),
    exitTime: t.closedAt,
    reasoning: "",
    status: t.positionStatus,
  }));
}

/**
 * Calculate win/loss streaks
 */
export async function calculateStreaks(userId: number): Promise<{
  currentWinStreak: number;
  maxWinStreak: number;
  currentLossStreak: number;
  maxLossStreak: number;
}> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "calculateStreaks userId");
  const trades = await db.getKalshiTradeHistory(1000, scopedUserId);
  const closedTrades = trades.filter((t: any) => t.positionStatus === "closed");

  let currentWinStreak = 0;
  let maxWinStreak = 0;
  let currentLossStreak = 0;
  let maxLossStreak = 0;

  for (const trade of closedTrades) {
    const pnl = getTradePnL(trade);
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
