/**
 * Post-Trade Attribution
 * Analyzes trade performance by signal type, regime, execution quality, and other factors
 */

import { getDb } from "../db";
import { paperTrades, reasoningLogs } from "../../drizzle/schema";
import { eq, and, gte, lte } from "drizzle-orm";

export interface TradeAttribution {
  tradeId: number;
  symbol: string;
  signalType: string;
  regime: string;
  executionQuality: "excellent" | "good" | "fair" | "poor";
  pnl: number;
  pnlPct: number;
  holdingPeriodHours: number;
  slippageBps: number;
  attributionFactors: {
    signalQuality: number;
    executionQuality: number;
    regimeAlignment: number;
    timingQuality: number;
  };
}

export interface AttributionSummary {
  totalTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  bySignalType: Record<string, { count: number; winRate: number; avgPnL: number }>;
  byRegime: Record<string, { count: number; winRate: number; avgPnL: number }>;
  byExecutionQuality: Record<string, { count: number; winRate: number; avgPnL: number }>;
}

/**
 * Determine execution quality based on slippage and timing
 */
function assessExecutionQuality(slippageBps: number, holdingPeriodHours: number): "excellent" | "good" | "fair" | "poor" {
  if (slippageBps < 2 && holdingPeriodHours > 1) return "excellent";
  if (slippageBps < 5 && holdingPeriodHours > 0.5) return "good";
  if (slippageBps < 10) return "fair";
  return "poor";
}

/**
 * Calculate attribution factors (0-1 scale)
 */
function calculateAttributionFactors(
  trade: any,
  reasoning: any
): TradeAttribution["attributionFactors"] {
  const signalQuality = Math.min(1, (reasoning?.confidenceScore || 50) / 100);
  const executionQuality = trade.exitPrice && trade.entryPrice ? 
    Math.max(0, 1 - Math.abs((trade.exitPrice - trade.entryPrice) / trade.entryPrice)) : 0.5;
  const regimeAlignment = reasoning?.regimeSummary ? 0.8 : 0.3;
  const timingQuality = trade.expectedHoldingPeriod ? 0.7 : 0.4;

  return {
    signalQuality,
    executionQuality,
    regimeAlignment,
    timingQuality,
  };
}

/**
 * Analyze a single trade for attribution
 */
export async function analyzeTradeAttribution(tradeId: number): Promise<TradeAttribution | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const trades = await db.select().from(paperTrades).where(eq(paperTrades.id, tradeId));
    if (!trades.length) return null;

    const trade = trades[0];
    const entryPrice = parseFloat(String(trade.entryPrice || "0"));
    const exitPrice = parseFloat(String(trade.exitPrice || "0"));
    const pnl = exitPrice > 0 ? (exitPrice - entryPrice) * (trade.quantity || 1) : 0;
    const pnlPct = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;

    const holdingPeriodHours = trade.exitedAt && trade.enteredAt
      ? (trade.exitedAt.getTime() - trade.enteredAt.getTime()) / (1000 * 60 * 60)
      : 0;

    const slippageBps = entryPrice > 0 ? Math.abs((exitPrice - entryPrice) / entryPrice) * 10000 : 0;

    const reasoning = await db
      .select()
      .from(reasoningLogs)
      .limit(1);

    const attributionFactors = calculateAttributionFactors(trade, reasoning[0]);

    return {
      tradeId,
      symbol: trade.symbol || "UNKNOWN",
      signalType: reasoning[0]?.signal || "unknown",
      regime: reasoning[0]?.regimeSummary ? "trending" : "ranging",
      executionQuality: assessExecutionQuality(slippageBps, holdingPeriodHours),
      pnl,
      pnlPct,
      holdingPeriodHours,
      slippageBps,
      attributionFactors,
    };
  } catch (error) {
    console.error("[PostTradeAttribution] Error analyzing trade:", error);
    return null;
  }
}

/**
 * Generate attribution summary for a date range
 */
export async function generateAttributionSummary(
  startDate: Date,
  endDate: Date
): Promise<AttributionSummary | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const trades = await db
      .select()
      .from(paperTrades)
      .where(and(gte(paperTrades.enteredAt, startDate), lte(paperTrades.enteredAt, endDate)));

    if (!trades.length) {
      return {
        totalTrades: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        bySignalType: {},
        byRegime: {},
        byExecutionQuality: {},
      };
    }

    const attributions: TradeAttribution[] = [];
    for (const trade of trades) {
      const attr = await analyzeTradeAttribution(trade.id);
      if (attr) attributions.push(attr);
    }

    const winningTrades = attributions.filter(a => a.pnl > 0);
    const losingTrades = attributions.filter(a => a.pnl < 0);

    const bySignalType: Record<string, { count: number; winRate: number; avgPnL: number }> = {};
    const byRegime: Record<string, { count: number; winRate: number; avgPnL: number }> = {};
    const byExecutionQuality: Record<string, { count: number; winRate: number; avgPnL: number }> = {};

    for (const attr of attributions) {
      // By signal type
      if (!bySignalType[attr.signalType]) {
        bySignalType[attr.signalType] = { count: 0, winRate: 0, avgPnL: 0 };
      }
      bySignalType[attr.signalType].count++;
      bySignalType[attr.signalType].avgPnL += attr.pnl;
      if (attr.pnl > 0) bySignalType[attr.signalType].winRate++;
      else bySignalType[attr.signalType].winRate += 0;

      // By regime
      if (!byRegime[attr.regime]) {
        byRegime[attr.regime] = { count: 0, winRate: 0, avgPnL: 0 };
      }
      byRegime[attr.regime].count++;
      byRegime[attr.regime].avgPnL += attr.pnl;
      if (attr.pnl > 0) byRegime[attr.regime].winRate++;
      else byRegime[attr.regime].winRate += 0;

      // By execution quality
      if (!byExecutionQuality[attr.executionQuality]) {
        byExecutionQuality[attr.executionQuality] = { count: 0, winRate: 0, avgPnL: 0 };
      }
      byExecutionQuality[attr.executionQuality].count++;
      byExecutionQuality[attr.executionQuality].avgPnL += attr.pnl;
      if (attr.pnl > 0) byExecutionQuality[attr.executionQuality].winRate++;
      else byExecutionQuality[attr.executionQuality].winRate += 0;
    }

    // Normalize averages and win rates
    for (const key in bySignalType) {
      const group = bySignalType[key];
      group.avgPnL /= group.count;
      group.winRate /= group.count;
    }
    for (const key in byRegime) {
      const group = byRegime[key];
      group.avgPnL /= group.count;
      group.winRate /= group.count;
    }
    for (const key in byExecutionQuality) {
      const group = byExecutionQuality[key];
      group.avgPnL /= group.count;
      group.winRate /= group.count;
    }

    const totalWinPnL = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const totalLossPnL = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = totalLossPnL > 0 ? totalWinPnL / totalLossPnL : totalWinPnL > 0 ? Infinity : 0;

    return {
      totalTrades: attributions.length,
      winRate: winningTrades.length / attributions.length,
      avgWin: winningTrades.length > 0 ? totalWinPnL / winningTrades.length : 0,
      avgLoss: losingTrades.length > 0 ? totalLossPnL / losingTrades.length : 0,
      profitFactor,
      bySignalType,
      byRegime,
      byExecutionQuality,
    };
  } catch (error) {
    console.error("[PostTradeAttribution] Error generating summary:", error);
    return null;
  }
}
