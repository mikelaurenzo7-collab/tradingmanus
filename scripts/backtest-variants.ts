/**
 * Exit Strategy Parameter Optimizer
 * Tests different parameter combinations against historical backtest data
 * 
 * Usage:
 *   DATABASE_URL='...' corepack pnpm exec tsx scripts/backtest-variants.ts
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { kalshiMarketSnapshots } from "../drizzle/schema";
import { eq, gte, asc } from "drizzle-orm";
import { logger } from "../server/_core/logger";
import {
  initializeExitStrategy,
  updateTrailingStop,
  applyTimeDecayToStops,
  checkExitConditions,
  type ExitStrategyConfig,
  type ExitReason,
} from "../server/_core/exitStrategy";
import { computeVolatilityFromPrices } from "../server/_core/marketVolatility";

interface ParameterSet {
  name: string;
  INITIAL_STOP_PCT: number;
  TRAILING_STOP_ATR_MULTIPLE: number;
  PROFIT_TARGET_SCALE_1: number;
  PROFIT_TARGET_SCALE_2: number;
  PROFIT_TARGET_SCALE_3: number;
}

interface BacktestResult {
  params: ParameterSet;
  totalTrades: number;
  winRate: number;
  totalPnL: number;
  profitFactor: number;
  averageWin: number;
  averageLoss: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

// Parameter sets to test
const PARAMETER_SETS: ParameterSet[] = [
  {
    name: "BASELINE (current)",
    INITIAL_STOP_PCT: 0.15,
    TRAILING_STOP_ATR_MULTIPLE: 3.0,
    PROFIT_TARGET_SCALE_1: 1.0,
    PROFIT_TARGET_SCALE_2: 2.0,
    PROFIT_TARGET_SCALE_3: 3.0,
  },
  {
    name: "CONSERVATIVE (tighter stop)",
    INITIAL_STOP_PCT: 0.12,
    TRAILING_STOP_ATR_MULTIPLE: 3.0,
    PROFIT_TARGET_SCALE_1: 1.0,
    PROFIT_TARGET_SCALE_2: 2.0,
    PROFIT_TARGET_SCALE_3: 3.0,
  },
  {
    name: "AGGRESSIVE TRAILING",
    INITIAL_STOP_PCT: 0.15,
    TRAILING_STOP_ATR_MULTIPLE: 2.5,
    PROFIT_TARGET_SCALE_1: 1.0,
    PROFIT_TARGET_SCALE_2: 2.0,
    PROFIT_TARGET_SCALE_3: 3.0,
  },
  {
    name: "WIDE TARGETS",
    INITIAL_STOP_PCT: 0.15,
    TRAILING_STOP_ATR_MULTIPLE: 3.0,
    PROFIT_TARGET_SCALE_1: 1.5,
    PROFIT_TARGET_SCALE_2: 3.0,
    PROFIT_TARGET_SCALE_3: 5.0,
  },
  {
    name: "COMBINED OPTIMIZATION",
    INITIAL_STOP_PCT: 0.12,
    TRAILING_STOP_ATR_MULTIPLE: 2.5,
    PROFIT_TARGET_SCALE_1: 1.5,
    PROFIT_TARGET_SCALE_2: 3.0,
    PROFIT_TARGET_SCALE_3: 5.0,
  },
];

const PRICE_MIN = 0.02;
const PRICE_MAX = 0.98;

function clamp(value: number): number {
  return Math.min(PRICE_MAX, Math.max(PRICE_MIN, value));
}

interface SnapshotRow {
  marketId: string;
  yesPrice: number;
  noPrice: number;
  snapshotTime: Date;
}

async function loadSnapshots(): Promise<SnapshotRow[]> {
  const db = await getDb();
  if (!db) {
    console.log("[Backtest] database not available");
    process.exit(1);
  }

  const now = new Date();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const windowStart = new Date(now.getTime() - ninetyDaysMs);

  const rows = await db
    .select({
      marketId: kalshiMarketSnapshots.marketId,
      yesPrice: kalshiMarketSnapshots.yesPrice,
      noPrice: kalshiMarketSnapshots.noPrice,
      snapshotTime: kalshiMarketSnapshots.snapshotTime,
    })
    .from(kalshiMarketSnapshots)
    .where(gte(kalshiMarketSnapshots.snapshotTime, windowStart))
    .orderBy(asc(kalshiMarketSnapshots.snapshotTime));

  return rows as SnapshotRow[];
}

interface Trade {
  pnl: number;
}

function calculateStats(trades: Trade[]) {
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      winRate: 0,
      totalPnL: 0,
      profitFactor: 0,
      averageWin: 0,
      averageLoss: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
    };
  }

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);
  const profitFactor = losses.length > 0
    ? Math.abs(wins.reduce((sum, t) => sum + t.pnl, 0) / losses.reduce((sum, t) => sum + t.pnl, 0))
    : (wins.length > 0 ? 999 : 0);

  const averageWin = wins.length > 0
    ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length
    : 0;

  const averageLoss = losses.length > 0
    ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length)
    : 0;

  // Simplified Sharpe ratio
  const returns = trades.map(t => t.pnl);
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;

  // Max drawdown
  let cumulativePnL = 0;
  let maxCumulativePnL = 0;
  let maxDrawdown = 0;
  for (const trade of trades) {
    cumulativePnL += trade.pnl;
    if (cumulativePnL > maxCumulativePnL) {
      maxCumulativePnL = cumulativePnL;
    }
    const drawdown = maxCumulativePnL - cumulativePnL;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return {
    totalTrades: trades.length,
    winRate: wins.length / trades.length,
    totalPnL: Number(totalPnL.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(3)),
    averageWin: Number(averageWin.toFixed(2)),
    averageLoss: Number(averageLoss.toFixed(2)),
    sharpeRatio: Number(sharpeRatio.toFixed(3)),
    maxDrawdown: Number(maxDrawdown.toFixed(2)),
  };
}

async function runBacktestVariant(params: ParameterSet, snapshots: SnapshotRow[]): Promise<BacktestResult> {
  // Group snapshots by market
  const marketSnapshots = new Map<string, SnapshotRow[]>();
  for (const snapshot of snapshots) {
    if (!marketSnapshots.has(snapshot.marketId)) {
      marketSnapshots.set(snapshot.marketId, []);
    }
    marketSnapshots.get(snapshot.marketId)!.push(snapshot);
  }

  const trades: Trade[] = [];

  for (const [marketId, mSnapshots] of marketSnapshots) {
    if (mSnapshots.length < 5) continue;

    // Test both sides
    for (const side of ["yes", "no"] as const) {
      // Every-N entry policy: entry every 2 snapshots
      for (let entryIdx = 0; entryIdx < mSnapshots.length - 1; entryIdx += 2) {
        const entrySnapshot = mSnapshots[entryIdx];
        const entryPrice = side === "yes" ? entrySnapshot.yesPrice : entrySnapshot.noPrice;

        // Calculate volatility from window
        const prices = mSnapshots.map(s => side === "yes" ? s.yesPrice : s.noPrice);
        const volatility = computeVolatilityFromPrices(prices);

        // Initialize strategy
        let state = initializeExitStrategy({
          entryPrice,
          side,
          initialRisk: 100,
          volatility,
        });

        let exitPrice: number | null = null;
        let exitIdx = -1;

        // Walk forward
        for (let i = entryIdx + 1; i < mSnapshots.length; i++) {
          const currentSnapshot = mSnapshots[i];
          const currentPrice = side === "yes" ? currentSnapshot.yesPrice : currentSnapshot.noPrice;
          const atr = 0.01; // Simplified

          // Update trailing stop
          state = updateTrailingStop(state, currentPrice, atr, side);

          // Check exit conditions
          const decision = checkExitConditions(state, currentPrice, {
            entryPrice,
            side,
            initialRisk: 100,
            volatility,
          });

          if (decision.shouldExit) {
            exitPrice = decision.exitPrice ?? currentPrice;
            exitIdx = i;
            break;
          }
        }

        if (exitPrice === null) {
          // Exited at end of window
          exitPrice = side === "yes"
            ? mSnapshots[mSnapshots.length - 1].yesPrice
            : mSnapshots[mSnapshots.length - 1].noPrice;
          exitIdx = mSnapshots.length - 1;
        }

        // Calculate PnL (simplified: $100 per trade, profit is price difference)
        const pnl = side === "yes"
          ? (exitPrice - entryPrice) * 100
          : (entryPrice - exitPrice) * 100;

        trades.push({ pnl });
      }
    }
  }

  const stats = calculateStats(trades);
  return { params, ...stats };
}

async function main() {
  console.log("[Backtest Variants] loading snapshots...");
  const snapshots = await loadSnapshots();

  console.log(`[Backtest Variants] loaded ${snapshots.length} snapshots`);
  if (snapshots.length === 0) {
    console.log("[Backtest Variants] no data; seeding first");
    process.exit(1);
  }

  console.log("\n" + "=".repeat(140));
  console.log("EXIT STRATEGY PARAMETER COMPARISON");
  console.log("=".repeat(140));

  const results: BacktestResult[] = [];

  for (const params of PARAMETER_SETS) {
    console.log(`\n▶ Testing: ${params.name}`);
    const result = await runBacktestVariant(params, snapshots);
    results.push(result);

    console.log(
      `  Trades: ${result.totalTrades} | ` +
      `PnL: $${result.totalPnL} | ` +
      `Win%: ${(result.winRate * 100).toFixed(1)}% | ` +
      `PF: ${result.profitFactor} | ` +
      `Sharpe: ${result.sharpeRatio}`
    );
  }

  console.log("\n" + "=".repeat(140));
  console.log("SUMMARY TABLE");
  console.log("=".repeat(140));

  const baselineResult = results[0];
  console.log(
    "\nName".padEnd(35) +
    "Trades".padStart(10) +
    "PnL ($)".padStart(12) +
    "Win %".padStart(10) +
    "Profit Factor".padStart(15) +
    "Sharpe".padStart(10) +
    "vs Baseline".padStart(15)
  );
  console.log("-".repeat(140));

  for (const result of results) {
    const vs = result === baselineResult
      ? "BASELINE"
      : result.totalPnL > baselineResult.totalPnL
      ? `+${(result.totalPnL - baselineResult.totalPnL).toFixed(2)} (+${(((result.totalPnL / baselineResult.totalPnL) - 1) * 100).toFixed(1)}%)`
      : `${(result.totalPnL - baselineResult.totalPnL).toFixed(2)} (${(((result.totalPnL / baselineResult.totalPnL) - 1) * 100).toFixed(1)}%)`;

    console.log(
      result.params.name.padEnd(35) +
      String(result.totalTrades).padStart(10) +
      result.totalPnL.toFixed(2).padStart(12) +
      (result.winRate * 100).toFixed(1).padStart(9) + "%" +
      result.profitFactor.toFixed(3).padStart(15) +
      result.sharpeRatio.toFixed(3).padStart(10) +
      vs.padStart(15)
    );
  }

  console.log("\n✅ Analysis complete");
}

main().catch(err => {
  console.error("[Backtest Variants] error:", err);
  process.exit(1);
});
