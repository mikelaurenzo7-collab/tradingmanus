/**
 * Polymarket Learning Loop
 * Tracks trades, analyzes outcomes, and learns from performance
 * 
 * Mirrors kalshiLearning.ts capabilities but adapted for Polymarket CLOB:
 * - Trade records stored as Polymarket positions
 * - P&L calculations based on USDC outcomes
 * - Signal performance analysis
 * - Performance metrics tracking
 */

import * as db from "../db";
import * as polyDb from "../db.polymarket";
import { assertPositiveIntegerUserId } from "./userScope";
import { logger } from "./logger";
import {
  applyOnlineLearningUpdate,
  deriveModelFromUpdates,
  type TradeOutcome,
} from "./onlineLearning";
import { calculateAttributionBreakdown } from "./performanceAttribution";

export interface PolymarketTradeRecord {
  id: string;
  marketId: string;
  tokenId: string;
  signalId: string;
  signalType: string;
  side: "yes" | "no";
  entryPrice: number;
  entrySizeUsdc: number;
  exitPrice?: number;
  exitSizeUsdc?: number;
  pnl?: number;
  pnlPercent?: number;
  outcome?: "win" | "loss" | "breakeven";
  entryTime: Date;
  exitTime?: Date;
  reasoning: string;
  status: "open" | "closed" | "partial";
}

export interface PolymarketPerformanceMetrics {
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

export interface PolymarketSignalPerformance {
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
  sizeUsdc?: number | null;
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
  metadata?: {
    marketCategory?: string | null;
  } | null;
};

export interface PolymarketPlatformBehaviorSnapshot {
  totalClosedTrades: number;
  adaptationEpoch: number;
  hasSufficientData: boolean;
  signalWinRates: Record<string, number>;
  categoryEdge: Record<string, number>;
}

export interface PolymarketPerformanceOverview {
  startingBalance: number;
  currentBalance: number;
  metrics: PolymarketPerformanceMetrics;
  signalPerformance: PolymarketSignalPerformance[];
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
): PolymarketPerformanceMetrics {
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
        Number(trade.entryPrice ?? 0) * Number(trade.sizeUsdc ?? 0)
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
): PolymarketSignalPerformance[] {
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

  const signalMap = new Map<string, PolymarketSignalPerformance>();

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
      const recommendation: PolymarketSignalPerformance["recommendation"] =
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

export function buildPolymarketPlatformBehaviorSnapshot(
  metrics: PolymarketPerformanceMetrics,
  signalPerformance: PolymarketSignalPerformance[],
  signals: SignalLike[] = []
): PolymarketPlatformBehaviorSnapshot {
  const signalWinRates: Record<string, number> = {};
  for (const item of signalPerformance) {
    signalWinRates[item.signalType] = item.successRate;
  }

  const categoryEdge: Record<string, number> = {};
  const categoryCounts = new Map<string, number>();
  const categoryExpectedValues = new Map<string, number>();

  for (const signal of signals) {
    const category = signal.metadata?.marketCategory?.trim().toLowerCase();
    if (!category) continue;
    const ev = Number(signal.expectedValue ?? 0);
    if (!Number.isFinite(ev)) continue;

    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    categoryExpectedValues.set(category, (categoryExpectedValues.get(category) ?? 0) + ev);
  }

  for (const [category, count] of categoryCounts.entries()) {
    if (count < 5) continue;
    const avgEv = (categoryExpectedValues.get(category) ?? 0) / count;
    categoryEdge[category] = Math.max(-0.05, Math.min(0.05, avgEv * 0.25));
  }

  const totalClosedTrades = metrics.totalTrades;
  return {
    totalClosedTrades,
    adaptationEpoch: Math.floor(totalClosedTrades / 100),
    hasSufficientData: totalClosedTrades >= 100,
    signalWinRates,
    categoryEdge,
  };
}

/**
 * Get comprehensive performance overview for a user's Polymarket trading
 */
export async function getPolymarketPerformanceOverview(
  userId: number
): Promise<PolymarketPerformanceOverview> {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getPolymarketPerformanceOverview userId"
  );

  // Use Polymarket-specific positions for accurate performance tracking.
  // Positions carry realized/unrealized P&L and lifecycle status, which is what
  // calculatePerformanceMetricsFromTrades expects.
  const [allPositions, signals] = await Promise.all([
    polyDb.getPolymarketPositions(scopedUserId),
    db.getRecentSignals(1000, scopedUserId),
  ]);
  const openPositions = allPositions.filter(
    (p) => p.positionStatus === "open" || p.positionStatus === "closing"
  );

  // Starting balance is the total capital deployed into all positions (sum of
  // sizeUsdc).  This is the most accurate proxy for Polymarket initial capital
  // until a dedicated polymarketCapital table is added.
  const startingBalance = allPositions.reduce(
    (sum, p) => sum + Number(p.sizeUsdc ?? 0),
    0,
  );

  const metrics = calculatePerformanceMetricsFromTrades(allPositions, {
    startingBalance,
    openPositions,
  });

  // Current balance = deployed capital + total realized P&L.
  // Unrealized P&L is tracked separately inside the metrics object and should
  // not be folded into the account balance (which reflects closed results only).
  const totalRealizedPnl = allPositions.reduce(
    (sum, p) => sum + Number(p.realizedPnl ?? 0),
    0,
  );
  const currentBalance = startingBalance + totalRealizedPnl;

  return {
    startingBalance,
    currentBalance,
    metrics,
    signalPerformance: analyzeSignalPerformanceFromData(signals, allPositions),
  };
}

/**
 * Record a new Polymarket trade entry from a signal
 */
export async function recordPolymarketTradeEntry(
  userId: number,
  marketId: string,
  tokenId: string,
  signalId: string,
  signalType: string,
  side: "yes" | "no",
  entryPrice: number,
  entrySizeUsdc: number,
  reasoning: string
): Promise<PolymarketTradeRecord> {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "recordPolymarketTradeEntry userId"
  );
  const tradeId = `pm-trade-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const trade: PolymarketTradeRecord = {
    id: tradeId,
    marketId,
    tokenId,
    signalId,
    signalType,
    side,
    entryPrice,
    entrySizeUsdc,
    entryTime: new Date(),
    reasoning,
    status: "open",
  };

  // Log the trade entry in audit log
  await db.logAuditEvent(
    "polymarket_trade_entry",
    JSON.stringify({
      tradeId,
      marketId,
      tokenId,
      side,
      entryPrice,
      entrySizeUsdc,
      signalType,
      reasoning,
    }),
    `user:${scopedUserId}`
  );

  logger.info(
    { tradeId, signalType, side, entryPrice, entrySizeUsdc },
    "[PolymarketLearning] Trade recorded: %s - %s %s @ $%d (%d USDC)",
    tradeId, signalType, side, entryPrice, entrySizeUsdc
  );
  return trade;
}

/**
 * Record Polymarket trade exit and calculate P&L.
 *
 * Optionally writes to the per-desk learning tape when `tradeContext` is
 * provided.  Polymarket markets aren't cached locally so the caller must
 * supply the market title + category tag + side + entry/exit prices from
 * the original trade record so we can classify which desk this lesson
 * belongs to.  When omitted, exit is logged but no memory write occurs
 * (degrades gracefully — preserves prior behavior for legacy callers).
 */
export async function recordPolymarketTradeExit(
  userId: number,
  tradeId: string,
  exitPrice: number,
  exitSizeUsdc: number,
  tradeContext?: {
    marketId: string;
    marketTitle?: string | null;
    marketCategoryTag?: string | null;
    side: "yes" | "no";
    entryPrice: number;
    realizedPnl: number;
  },
): Promise<void> {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "recordPolymarketTradeExit userId"
  );

  await db.logAuditEvent(
    "polymarket_trade_exit",
    JSON.stringify({
      tradeId,
      exitPrice,
      exitSizeUsdc,
    }),
    `user:${scopedUserId}`
  );

  if (tradeContext) {
    const { tryRecordPolymarketCloseToDeskMemory } = await import("../db.desk-memory");
    await tryRecordPolymarketCloseToDeskMemory({
      userId: scopedUserId,
      marketId: tradeContext.marketId,
      marketTitle: tradeContext.marketTitle,
      marketCategoryTag: tradeContext.marketCategoryTag,
      side: tradeContext.side,
      entryPrice: tradeContext.entryPrice,
      exitPrice,
      sizeUsdc: exitSizeUsdc,
      realizedPnl: tradeContext.realizedPnl,
    });

    try {
      const outcome: TradeOutcome = tradeContext.realizedPnl > 0 ? "win" : tradeContext.realizedPnl < 0 ? "loss" : "breakeven";
      const recentLearning = await db.getRecentOnlineLearningUpdates(scopedUserId, "polymarket", 200);
      const model = deriveModelFromUpdates({
        userId: scopedUserId,
        platform: "polymarket",
        updates: recentLearning.map((row: any) => ({
          signalType: String(row.signalType),
          outcome: row.outcome as TradeOutcome,
          pnl: Number(row.pnl),
        })),
      });
      const learningUpdate = applyOnlineLearningUpdate(model, {
        signalType: "polymarket",
        outcome,
        pnl: tradeContext.realizedPnl,
      });

      await db.saveOnlineLearningUpdate({
        userId: scopedUserId,
        platform: "polymarket",
        signalType: "polymarket",
        outcome,
        pnl: tradeContext.realizedPnl,
        weightBefore: learningUpdate.weightBefore,
        weightAfter: learningUpdate.weightAfter,
        emaPnl: learningUpdate.nextModel.emaPnl,
        driftDetected: learningUpdate.driftDetected,
        explorationTaken: learningUpdate.explorationTaken,
        confidenceLower: learningUpdate.confidenceLower,
        confidenceUpper: learningUpdate.confidenceUpper,
        modelVersion: learningUpdate.nextModel.modelVersion,
      });

      const attribution = calculateAttributionBreakdown({
        side: tradeContext.side,
        entryPrice: tradeContext.entryPrice,
        exitPrice,
        quantity: exitSizeUsdc,
        signalConfidence: 0.5,
        benchmarkWinRate: 0.5,
      });

      await db.savePerformanceAttribution({
        userId: scopedUserId,
        platform: "polymarket",
        marketId: tradeContext.marketId,
        signalType: "polymarket",
        category: String(tradeContext.marketCategoryTag ?? "unknown"),
        ...attribution,
      });
    } catch (err) {
      logger.debug({ err, tradeId }, "non-critical polymarket learning/attribution update failed");
    }
  }

  logger.info(
    { tradeId, exitPrice, exitSizeUsdc },
    "[PolymarketLearning] Trade closed: %s @ $%d (%d USDC)",
    tradeId, exitPrice, exitSizeUsdc
  );
}

/**
 * Calculate comprehensive performance metrics for Polymarket trading
 */
export async function calculatePolymarketPerformanceMetrics(
  userId: number
): Promise<PolymarketPerformanceMetrics> {
  const overview = await getPolymarketPerformanceOverview(userId);
  return overview.metrics;
}

/**
 * Analyze performance by signal type for Polymarket
 */
export async function analyzePolymarketSignalPerformance(
  userId: number
): Promise<PolymarketSignalPerformance[]> {
  const overview = await getPolymarketPerformanceOverview(userId);
  return overview.signalPerformance;
}

/**
 * Get Polymarket trade history with filtering
 */
export async function getPolymarketTradeHistory(
  userId: number,
  filters?: {
    status?: "open" | "closed" | "partial";
    signalType?: string;
    outcome?: "win" | "loss" | "breakeven";
    limit?: number;
  }
): Promise<PolymarketTradeRecord[]> {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getPolymarketTradeHistory userId"
  );
  // Use Polymarket positions (not Kalshi orders).  positions carry the
  // entry/current price + realizedPnl / status fields this view shape needs.
  const positions = await polyDb.getPolymarketPositions(scopedUserId);
  const limit = filters?.limit ?? 50;
  return positions.slice(0, limit).map((t) => {
    const entryPrice = Number(t.entryPrice) || 0;
    const exitPrice = Number(t.currentPrice) || entryPrice;
    const sizeUsdc = Number(t.sizeUsdc) || 0;
    const realizedPnl = Number(t.realizedPnl) || 0;
    const pnlPercent =
      entryPrice * sizeUsdc > 0 ? (realizedPnl / (entryPrice * sizeUsdc)) * 100 : 0;
    return {
      id: `pm-trade-${t.id}`,
      marketId: t.marketId,
      tokenId: t.tokenId,
      signalId: "",
      signalType: "momentum",
      side: t.side,
      entryPrice,
      entrySizeUsdc: sizeUsdc,
      exitPrice,
      exitSizeUsdc: sizeUsdc,
      pnl: realizedPnl,
      pnlPercent,
      outcome:
        realizedPnl > 0 ? "win" : realizedPnl < 0 ? "loss" : "breakeven",
      entryTime: t.openedAt || new Date(),
      exitTime: t.closedAt ?? undefined,
      reasoning: "",
      // Map drizzle's positionStatus enum (open|closing|closed) to the trade-
      // record's narrower (open|closed|partial) shape; treat 'closing' as
      // 'partial' since a SELL is in flight but the row isn't closed yet.
      status: t.positionStatus === "closing" ? ("partial" as const) : t.positionStatus,
    };
  });
}

/**
 * Calculate win/loss streaks for Polymarket trading
 */
export async function calculatePolymarketStreaks(userId: number): Promise<{
  currentWinStreak: number;
  maxWinStreak: number;
  currentLossStreak: number;
  maxLossStreak: number;
}> {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "calculatePolymarketStreaks userId"
  );
  const positions = await polyDb.getPolymarketPositions(scopedUserId);
  const closedTrades = positions.filter((p) => p.positionStatus === "closed");

  let currentWinStreak = 0;
  let maxWinStreak = 0;
  let currentLossStreak = 0;
  let maxLossStreak = 0;

  for (const trade of closedTrades) {
    const pnl = Number(trade.realizedPnl) || 0;
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
