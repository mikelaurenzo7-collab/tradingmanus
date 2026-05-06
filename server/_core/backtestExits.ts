/**
 * Exit-strategy backtest harness.
 *
 * Replays the exit pipeline (initializeExitStrategy → updateTrailingStop →
 * applyTimeDecayToStops → checkExitConditions) against historical
 * kalshiMarketSnapshots data so the operator can answer the question:
 *
 *   "If I'd entered at price P on each market over the last N days,
 *    what would my exit strategy have produced?"
 *
 * Scope intentionally limited to the EXIT side of the pipeline because:
 *   1. The signal generators depend on live sentiment + market-feed
 *      context that isn't in our snapshot history; faithfully
 *      replaying them would be a multi-pass effort.
 *   2. The exit strategy is the new addition (last few passes) and
 *      the one whose tuning has the most P&L impact on existing
 *      positions.
 *
 * Methodology:
 *   - For each marketId with ≥ MIN_SNAPSHOTS rows in the window:
 *       • Sort snapshots ascending by snapshotTime.
 *       • For each (entryIndex, side) combination requested:
 *           - Use the snapshot at entryIndex as the entry price.
 *           - Walk forward through subsequent snapshots, applying
 *             updateTrailingStop + applyTimeDecayToStops + checkExit-
 *             Conditions using the SAME volatility helper the live
 *             system uses (estimateMarketVolatility on the historical
 *             window, not the current).
 *           - Record an exit at the first triggered condition, OR at
 *             the last snapshot if no exit triggered.
 *   - Aggregate via calculateBacktestStats.
 *
 * The result includes a per-trade ledger and the full BacktestResults
 * shape (winRate, sharpe, max drawdown, profit factor, etc.).
 */

import { kalshiMarketSnapshots, kalshiMarkets } from "../../drizzle/schema";
import { eq, gte, asc, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { logger } from "./logger";
import {
  initializeExitStrategy,
  updateTrailingStop,
  applyTimeDecayToStops,
  checkExitConditions,
  type ExitStrategyConfig,
  type ExitReason,
} from "./exitStrategy";
import { computeVolatilityFromPrices } from "./marketVolatility";
import { calculateBacktestStats, type BacktestResults, type BacktestTrade } from "./kalshiBacktest";

const MIN_SNAPSHOTS_PER_MARKET = 5;
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_ATR = 0.01;
const DEFAULT_INITIAL_RISK_USD = 100;

export interface BacktestEntryPolicy {
  /** "first" → enter at the first snapshot of each market.
   *  "every-n" → enter at every Nth snapshot (windowed pseudo-Monte-Carlo). */
  kind: "first" | "every-n";
  /** Used when kind === "every-n" — minimum gap (in snapshots) between entries. */
  stride?: number;
}

export interface BacktestRunOptions {
  /** Window of snapshot history to backtest, measured from now. Default 30. */
  windowDays?: number;
  /** Subset of marketIds to backtest.  Defaults to every market with >= MIN snapshots. */
  marketIdFilter?: string[];
  /** Which side(s) of each market to evaluate. */
  sides?: Array<"yes" | "no">;
  /** How to pick entry timestamps within each market's snapshot series. */
  entryPolicy?: BacktestEntryPolicy;
  /** Notional risk per simulated trade (USD).  Used in PnL calculations. */
  initialRiskUsd?: number;
}

export interface ExitBacktestSummary extends BacktestResults {
  windowDays: number;
  marketsEvaluated: number;
  snapshotsLoaded: number;
  exitReasonBreakdown: Record<ExitReason | "no_exit", number>;
  /** First few illustrative trades to surface in the audit / log output. */
  sampleTrades: BacktestTrade[];
}

interface SnapshotRow {
  marketId: string;
  yesPrice: number;
  noPrice: number;
  snapshotTime: Date;
}

interface MarketRow {
  marketId: string;
  resolutionDate: Date | null;
}

async function loadSnapshots(
  windowMs: number,
  marketIdFilter?: string[],
): Promise<SnapshotRow[]> {
  const database = await getDb();
  if (!database) return [];
  const since = new Date(Date.now() - windowMs);

  let rows: Array<Record<string, unknown>>;
  if (marketIdFilter && marketIdFilter.length > 0) {
    rows = (await database
      .select({
        marketId: kalshiMarketSnapshots.marketId,
        yesPrice: kalshiMarketSnapshots.yesPrice,
        noPrice: kalshiMarketSnapshots.noPrice,
        snapshotTime: kalshiMarketSnapshots.snapshotTime,
      })
      .from(kalshiMarketSnapshots)
      .where(
        inArray(kalshiMarketSnapshots.marketId, marketIdFilter),
      )
      .orderBy(asc(kalshiMarketSnapshots.snapshotTime))) as Array<Record<string, unknown>>;
  } else {
    rows = (await database
      .select({
        marketId: kalshiMarketSnapshots.marketId,
        yesPrice: kalshiMarketSnapshots.yesPrice,
        noPrice: kalshiMarketSnapshots.noPrice,
        snapshotTime: kalshiMarketSnapshots.snapshotTime,
      })
      .from(kalshiMarketSnapshots)
      .where(gte(kalshiMarketSnapshots.snapshotTime, since))
      .orderBy(asc(kalshiMarketSnapshots.snapshotTime))) as Array<Record<string, unknown>>;
  }

  return rows.map((r) => ({
    marketId: String(r.marketId),
    yesPrice: Number(r.yesPrice ?? 0),
    noPrice: Number(r.noPrice ?? 0),
    snapshotTime: new Date(String(r.snapshotTime)),
  }));
}

async function loadMarketMeta(marketIds: string[]): Promise<Map<string, MarketRow>> {
  const out = new Map<string, MarketRow>();
  if (marketIds.length === 0) return out;
  const database = await getDb();
  if (!database) return out;
  const rows = (await database
    .select({
      marketId: kalshiMarkets.marketId,
      resolutionDate: kalshiMarkets.resolutionDate,
    })
    .from(kalshiMarkets)
    .where(inArray(kalshiMarkets.marketId, marketIds))) as Array<Record<string, unknown>>;
  for (const r of rows) {
    const id = String(r.marketId);
    out.set(id, {
      marketId: id,
      resolutionDate: r.resolutionDate ? new Date(String(r.resolutionDate)) : null,
    });
  }
  return out;
}

function pickEntryIndices(snapshotCount: number, policy: BacktestEntryPolicy): number[] {
  if (snapshotCount < MIN_SNAPSHOTS_PER_MARKET) return [];
  if (policy.kind === "first") return [0];
  // every-n: leave at least 2 forward bars after each entry so an exit
  // has somewhere to fire.
  const stride = Math.max(1, Math.floor(policy.stride ?? Math.max(2, Math.floor(snapshotCount / 5))));
  const indices: number[] = [];
  for (let i = 0; i + 2 < snapshotCount; i += stride) indices.push(i);
  return indices;
}

function priceForSide(snapshot: SnapshotRow, side: "yes" | "no"): number {
  return side === "yes" ? snapshot.yesPrice : snapshot.noPrice;
}

interface SimulatedExit {
  exitIndex: number;
  exitPrice: number;
  reason: ExitReason | "no_exit";
}

function simulateOneExit(
  series: SnapshotRow[],
  entryIndex: number,
  side: "yes" | "no",
  resolutionDate: Date | null,
  volatility: number,
): SimulatedExit | null {
  const entryPrice = priceForSide(series[entryIndex], side);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || entryPrice >= 1) {
    return null;
  }

  const config: ExitStrategyConfig = {
    entryPrice,
    side,
    initialRisk: 1, // unit risk; PnL scaled by initialRiskUsd at the trade level
    volatility,
    resolutionDate: resolutionDate ?? undefined,
  };
  let state = initializeExitStrategy(config);

  for (let i = entryIndex + 1; i < series.length; i++) {
    const currentPrice = priceForSide(series[i], side);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0 || currentPrice >= 1) continue;

    state = updateTrailingStop(state, currentPrice, DEFAULT_ATR, side);
    state = applyTimeDecayToStops(state, config, series[i].snapshotTime);

    const decision = checkExitConditions(state, currentPrice, config);
    if (decision.shouldExit && decision.reason) {
      return { exitIndex: i, exitPrice: currentPrice, reason: decision.reason };
    }
  }

  // No exit triggered — close at last snapshot price for accounting.
  const lastIndex = series.length - 1;
  const lastPrice = priceForSide(series[lastIndex], side);
  return {
    exitIndex: lastIndex,
    exitPrice: Number.isFinite(lastPrice) && lastPrice > 0 && lastPrice < 1 ? lastPrice : entryPrice,
    reason: "no_exit",
  };
}

export async function runExitStrategyBacktest(
  options: BacktestRunOptions = {},
): Promise<ExitBacktestSummary> {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const sides = options.sides ?? ["yes", "no"];
  const entryPolicy: BacktestEntryPolicy = options.entryPolicy ?? { kind: "first" };
  const initialRiskUsd = options.initialRiskUsd ?? DEFAULT_INITIAL_RISK_USD;

  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  let snapshots: SnapshotRow[] = [];
  try {
    snapshots = await loadSnapshots(windowMs, options.marketIdFilter);
  } catch (err) {
    logger.error({ err, windowDays }, "[Backtest] failed to load snapshots");
    snapshots = [];
  }

  // Group snapshots by marketId, keeping ascending time order (already
  // ordered by the SELECT).
  const byMarket = new Map<string, SnapshotRow[]>();
  for (const s of snapshots) {
    let bucket = byMarket.get(s.marketId);
    if (!bucket) {
      bucket = [];
      byMarket.set(s.marketId, bucket);
    }
    bucket.push(s);
  }

  // Drop markets with insufficient history.
  for (const [id, series] of byMarket) {
    if (series.length < MIN_SNAPSHOTS_PER_MARKET) byMarket.delete(id);
  }

  const marketMeta = await loadMarketMeta(Array.from(byMarket.keys()));

  const trades: BacktestTrade[] = [];
  const reasonCounts: Record<ExitReason | "no_exit", number> = {
    stop_loss: 0,
    trailing_stop: 0,
    profit_target_1: 0,
    profit_target_2: 0,
    profit_target_3: 0,
    time_decay: 0,
    volatility_adjustment: 0,
    no_exit: 0,
  };

  for (const [marketId, series] of byMarket) {
    const yesPrices = series.map((s) => s.yesPrice);
    const volatility = computeVolatilityFromPrices(yesPrices);
    const resolutionDate = marketMeta.get(marketId)?.resolutionDate ?? null;
    const entryIndices = pickEntryIndices(series.length, entryPolicy);

    for (const entryIdx of entryIndices) {
      for (const side of sides) {
        const exit = simulateOneExit(series, entryIdx, side, resolutionDate, volatility);
        if (!exit) continue;

        const entryPrice = priceForSide(series[entryIdx], side);
        // Per-trade PnL: side-aware proportional return on the notional risk.
        // For a YES entry at $p that exits at $q, the PnL fraction is
        // (q - p) / p.  For NO, it's the inverse.
        const pnlFraction = side === "yes"
          ? (exit.exitPrice - entryPrice) / entryPrice
          : (entryPrice - exit.exitPrice) / entryPrice;
        const pnl = pnlFraction * initialRiskUsd;

        reasonCounts[exit.reason] += 1;
        trades.push({
          marketId,
          entryPrice,
          exitPrice: exit.exitPrice,
          size: initialRiskUsd / entryPrice,
          entryTime: series[entryIdx].snapshotTime.getTime(),
          exitTime: series[exit.exitIndex].snapshotTime.getTime(),
          pnl,
          pnlPercent: pnlFraction,
          side,
        });
      }
    }
  }

  const stats = calculateBacktestStats(trades);
  const sampleTrades = trades.slice(0, 10);

  logger.info(
    {
      windowDays,
      marketsEvaluated: byMarket.size,
      trades: stats.totalTrades,
      winRate: Number(stats.winRate.toFixed(3)),
      totalPnL: Number(stats.totalPnL.toFixed(2)),
      sharpe: Number(stats.sharpeRatio.toFixed(3)),
      maxDrawdown: Number(stats.maxDrawdown.toFixed(3)),
      reasonBreakdown: reasonCounts,
    },
    "[Backtest] exit-strategy backtest complete",
  );

  return {
    ...stats,
    windowDays,
    marketsEvaluated: byMarket.size,
    snapshotsLoaded: snapshots.length,
    exitReasonBreakdown: reasonCounts,
    sampleTrades,
  };
}
