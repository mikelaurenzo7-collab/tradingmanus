/**
 * Strategy backtest engine.
 *
 * Replays the platform's actual signal generators (Kalshi + Polymarket) over
 * a sequence of price snapshots, simulates fills with configurable fees and
 * slippage, and reports realized PnL, win rate, Sharpe, drawdown, and
 * per-trade detail.
 *
 * The point is to validate alpha BEFORE risking capital.  Run it against
 * the synthetic generator (server/_core/syntheticMarkets.ts) to check that
 * the strategy can extract edge from data with a known true probability.
 * If the strategy can't profit on synthetic markets that are deterministically
 * mispriced, it certainly won't profit on real ones.
 *
 * The engine intentionally only uses the value-play side of each generator
 * for v1: momentum requires a live MarketFeed (order book history) which
 * is non-trivial to synthesize, and sentiment requires external news APIs.
 * Value-play maps cleanly onto the (price, fundamental) pair the synthetic
 * generator already provides.
 */

import { generateSignalsForMarket, type KalshiSignal } from "./kalshiSignals";
import { generatePolymarketSignals, type PolymarketSignal } from "./polymarketSignals";
import {
  generateSyntheticDataset,
  toKalshiSnapshot,
  toPolymarketSnapshot,
  type SyntheticConfig,
  type SyntheticMarketSeries,
} from "./syntheticMarkets";
import {
  calculateBacktestStats,
  type BacktestResults,
  type BacktestTrade,
} from "./kalshiBacktest";

export type BacktestPlatform = "kalshi" | "polymarket";

export type StrategyBacktestConfig = {
  platform: BacktestPlatform;
  /** Synthetic-data parameters; see DEFAULT_SYNTHETIC_CONFIG. */
  synthetic?: Partial<SyntheticConfig>;
  /** Per-leg fee charged on entry and exit (e.g., 0.005 = 50 bps). */
  feePerLeg: number;
  /** Per-leg slippage worsening the fill price (e.g., 0.0025 = 25 bps). */
  slippagePerLeg: number;
  /** Notional dollars deployed per trade (used for sizing only). */
  positionSizeUsd: number;
  /** Confidence floor: signals below this are ignored. */
  minConfidence: number;
  /**
   * After how many ticks of holding do we forcibly exit before resolution?
   * `Infinity` → hold to resolution.  Otherwise we close at price-at-tick.
   */
  maxHoldTicks: number;
  /**
   * If true the backtest may overlap multiple positions in the same market
   * (taking each new signal that fires).  In v1 we keep at most one open
   * position per market — that matches autonomy behavior.
   */
  allowMultiplePositionsPerMarket?: boolean;
  /**
   * Optional whitelist of signal types to consider.  When set, signals
   * whose signalType is not in this list are dropped.  Useful for isolating
   * the contribution of one strategy at a time (e.g., test value_play
   * alone without the contrarian heuristic interfering on extreme prices).
   * When omitted, every signal type the generator emits is eligible.
   */
  signalTypeAllowlist?: string[];
};

export const DEFAULT_BACKTEST_CONFIG: StrategyBacktestConfig = {
  platform: "kalshi",
  feePerLeg: 0.005,
  slippagePerLeg: 0.0025,
  positionSizeUsd: 10,
  minConfidence: 0.55,
  maxHoldTicks: Number.POSITIVE_INFINITY,
};

/**
 * What we record about each simulated entry until we know how to close it.
 */
type OpenPosition = {
  marketId: string;
  series: SyntheticMarketSeries;
  side: "yes" | "no";
  entryPrice: number;
  entryTick: number;
  size: number;
  signalConfidence: number;
};

/**
 * Apply slippage + fee to an entry price.  Slippage moves the price against
 * us; fees subtract from notional.  We bake both into the effective entry
 * price so PnL math stays clean.
 */
function effectiveEntryPrice(
  marketPrice: number,
  side: "yes" | "no",
  feePerLeg: number,
  slippagePerLeg: number,
): number {
  // Buying YES: pay marketPrice + slippage + fee*marketPrice.
  // Buying NO: pay (1 - marketPrice) + slippage + fee*(1-marketPrice).
  const basePrice = side === "yes" ? marketPrice : 1 - marketPrice;
  const slipped = basePrice + slippagePerLeg;
  return Math.max(0.01, Math.min(0.99, slipped + slipped * feePerLeg));
}

function effectiveExitPrice(
  marketPrice: number,
  side: "yes" | "no",
  feePerLeg: number,
  slippagePerLeg: number,
): number {
  const basePrice = side === "yes" ? marketPrice : 1 - marketPrice;
  const slipped = basePrice - slippagePerLeg;
  return Math.max(0.01, Math.min(0.99, slipped - slipped * feePerLeg));
}

/**
 * Convert synthetic market resolution into the side's terminal payout.
 * YES side pays $1 if resolution = 1, else $0.  NO side is the inverse.
 */
function terminalPayout(
  resolution: 0 | 1,
  side: "yes" | "no",
  feePerLeg: number,
): number {
  const raw = side === "yes" ? resolution : 1 - resolution;
  // Resolution payouts have no slippage but still pay an exit/settlement fee.
  return Math.max(0, raw - raw * feePerLeg);
}

/**
 * Build a fundamentals map keyed by marketId.  For synthetic markets the
 * "fundamental probability" equals the (hidden-from-the-strategy) true
 * probability — that's the whole point: the strategy is given a
 * fundamental estimate and has to act on the divergence between fundamental
 * and market price.
 */
function buildFundamentalsMap(dataset: SyntheticMarketSeries[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const series of dataset) {
    map.set(series.marketId, series.trueProbability);
  }
  return map;
}

async function generateKalshiSignalsForTick(
  series: SyntheticMarketSeries,
  tick: number,
  fundamentals: Map<string, number>,
  allowlist?: string[],
): Promise<KalshiSignal[]> {
  const market = toKalshiSnapshot(series, tick);
  const signals = await generateSignalsForMarket(
    market,
    undefined,
    fundamentals.get(series.marketId),
  );
  if (!allowlist || allowlist.length === 0) return signals;
  return signals.filter((s) => allowlist.includes(s.signalType));
}

function generatePolymarketSignalsForTick(
  series: SyntheticMarketSeries,
  tick: number,
  fundamentals: Map<string, number>,
  minConfidence: number,
  allowlist?: string[],
): PolymarketSignal[] {
  const market = toPolymarketSnapshot(series, tick);
  const signals = generatePolymarketSignals([market], {
    minConfidence,
    minLiquidity: 0,
    fairValues: fundamentals,
  });
  if (!allowlist || allowlist.length === 0) return signals;
  return signals.filter((s) => allowlist.includes(s.signalType));
}

/**
 * Pick the highest-confidence signal that passes the floor.  If none, null.
 */
function selectSignal<T extends { confidence: number; side: "yes" | "no" }>(
  signals: T[],
  minConfidence: number,
): T | null {
  let best: T | null = null;
  for (const sig of signals) {
    if (sig.confidence < minConfidence) continue;
    if (!best || sig.confidence > best.confidence) best = sig;
  }
  return best;
}

export type StrategyBacktestResult = BacktestResults & {
  platform: BacktestPlatform;
  /** Number of synthetic markets the engine replayed. */
  marketsReplayed: number;
  /** Total signals emitted across all ticks (including ones we skipped). */
  signalsEmitted: number;
  /** Signals that survived the confidence floor and led to entries. */
  positionsOpened: number;
  /** Average confidence of executed signals. */
  averageSignalConfidence: number;
  /** Hidden truth check: how often the entered side matched resolution. */
  realizedAccuracy: number;
  /** Per-leg fee used. */
  feePerLeg: number;
  /** Per-leg slippage used. */
  slippagePerLeg: number;
};

/**
 * Run a strategy backtest end-to-end.  Caller supplies a config; the engine
 * generates a synthetic dataset, replays the chosen platform's signal
 * generator across every tick, simulates entries and exits with fees and
 * slippage, and returns aggregated stats.
 *
 * Flow:
 *   for each market:
 *     for each tick:
 *       run signal generator on (market_state, fundamental)
 *       if a high-confidence signal fires and we have no open position:
 *         enter at effective price (fee + slippage)
 *       if we have an open position:
 *         maybe exit (max-hold, or signal flip)
 *     resolve any open position at terminal payout
 *   aggregate trades into BacktestResults
 *
 * Synchronous from the caller's perspective (returns Promise because the
 * Kalshi generator is async).
 */
export async function runStrategyBacktest(
  configIn: Partial<StrategyBacktestConfig> = {},
): Promise<StrategyBacktestResult> {
  const config: StrategyBacktestConfig = { ...DEFAULT_BACKTEST_CONFIG, ...configIn };
  const dataset = generateSyntheticDataset(config.synthetic);
  const fundamentals = buildFundamentalsMap(dataset);

  const trades: BacktestTrade[] = [];
  let signalsEmitted = 0;
  let positionsOpened = 0;
  let totalConfidence = 0;
  let correctSides = 0;

  for (const series of dataset) {
    let openPosition: OpenPosition | null = null;
    const ticks = series.series.length;

    for (let tick = 0; tick < ticks; tick++) {
      const signals: Array<{ confidence: number; side: "yes" | "no" }> =
        config.platform === "kalshi"
          ? await generateKalshiSignalsForTick(
              series,
              tick,
              fundamentals,
              config.signalTypeAllowlist,
            )
          : generatePolymarketSignalsForTick(
              series,
              tick,
              fundamentals,
              config.minConfidence,
              config.signalTypeAllowlist,
            );

      signalsEmitted += signals.length;
      const chosen = selectSignal(signals, config.minConfidence);

      // Exit logic: if max hold reached, or a strong signal in the opposite
      // direction fires, close at current tick.
      if (openPosition) {
        const heldFor = tick - openPosition.entryTick;
        const oppositeSignal =
          chosen && chosen.side !== openPosition.side && chosen.confidence >= config.minConfidence;
        if (heldFor >= config.maxHoldTicks || oppositeSignal) {
          const exitPrice = effectiveExitPrice(
            series.series[tick]!,
            openPosition.side,
            config.feePerLeg,
            config.slippagePerLeg,
          );
          const pnl =
            (exitPrice - openPosition.entryPrice) * openPosition.size;
          const trade: BacktestTrade = {
            marketId: openPosition.marketId,
            entryPrice: openPosition.entryPrice,
            exitPrice,
            size: openPosition.size,
            entryTime: openPosition.entryTick,
            exitTime: tick,
            pnl,
            pnlPercent: pnl / (openPosition.entryPrice * openPosition.size),
            side: openPosition.side,
          };
          trades.push(trade);
          openPosition = null;
        }
      }

      // Entry logic: only open a new position if we don't already have one
      // in this market.  v1 keeps it simple — one position per market.
      if (!openPosition && chosen) {
        const entryPrice = effectiveEntryPrice(
          series.series[tick]!,
          chosen.side,
          config.feePerLeg,
          config.slippagePerLeg,
        );
        openPosition = {
          marketId: series.marketId,
          series,
          side: chosen.side,
          entryPrice,
          entryTick: tick,
          size: config.positionSizeUsd / entryPrice,
          signalConfidence: chosen.confidence,
        };
        positionsOpened += 1;
        totalConfidence += chosen.confidence;

        // Score directional correctness at entry time using the (already
        // sampled) terminal resolution.  This is "would the side I picked
        // have been right at resolution" — independent of when we exit, so
        // mid-market exits still count.  We'd otherwise undercount because
        // accuracy = correctSides / positionsOpened with mid-exits never
        // contributing to the numerator.
        const expectedSide: "yes" | "no" = series.resolution === 1 ? "yes" : "no";
        if (chosen.side === expectedSide) correctSides += 1;
      }
    }

    // End of market: resolve any open position at terminal payout.
    if (openPosition) {
      const payout = terminalPayout(
        series.resolution,
        openPosition.side,
        config.feePerLeg,
      );
      const pnl = (payout - openPosition.entryPrice) * openPosition.size;
      trades.push({
        marketId: openPosition.marketId,
        entryPrice: openPosition.entryPrice,
        exitPrice: payout,
        size: openPosition.size,
        entryTime: openPosition.entryTick,
        exitTime: ticks - 1,
        pnl,
        pnlPercent: pnl / (openPosition.entryPrice * openPosition.size),
        side: openPosition.side,
      });
      openPosition = null;
    }
  }

  const stats = calculateBacktestStats(trades);

  return {
    ...stats,
    platform: config.platform,
    marketsReplayed: dataset.length,
    signalsEmitted,
    positionsOpened,
    averageSignalConfidence:
      positionsOpened === 0 ? 0 : totalConfidence / positionsOpened,
    realizedAccuracy: positionsOpened === 0 ? 0 : correctSides / positionsOpened,
    feePerLeg: config.feePerLeg,
    slippagePerLeg: config.slippagePerLeg,
  };
}

// ---------------------------------------------------------------------------
// Higher-level analytics
//
// Single backtest runs are necessary but not sufficient — they tell you
// whether one specific configuration profits on one specific synthetic
// dataset.  They don't tell you whether the strategy's edge is robust to
// fee/slippage realism, parameter choice, or out-of-sample drift.  The
// helpers below fill those gaps.
// ---------------------------------------------------------------------------

export type SweepAxis = {
  feesPerLeg?: number[];
  slippagesPerLeg?: number[];
  minConfidences?: number[];
  maxHoldTicksOptions?: number[];
};

export type SweepCellResult = {
  feePerLeg: number;
  slippagePerLeg: number;
  minConfidence: number;
  maxHoldTicks: number;
  totalTrades: number;
  totalPnL: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  realizedAccuracy: number;
  positionsOpened: number;
};

export type SweepResult = {
  cells: SweepCellResult[];
  /** Cell with the highest totalPnL. */
  best: SweepCellResult | null;
  /** Cell with the highest Sharpe (risk-adjusted). */
  bestRiskAdjusted: SweepCellResult | null;
  /** Fraction of cells that had positive totalPnL. */
  profitableFraction: number;
};

/**
 * Run the engine across a grid of (fee, slippage, minConfidence, maxHold)
 * configurations and report the per-cell stats.  Use this to validate that
 * the strategy's edge isn't a single fragile point in parameter space.
 *
 * If a strategy only profits at one specific fee + minConfidence combo, it
 * was overfit to that combo on this synthetic dataset.  A robust strategy
 * shows positive PnL across a meaningful fraction of the grid.
 */
export async function runBacktestSweep(
  baseConfig: Partial<StrategyBacktestConfig> = {},
  axes: SweepAxis = {},
): Promise<SweepResult> {
  const fees = axes.feesPerLeg ?? [0.001, 0.005, 0.01];
  const slippages = axes.slippagesPerLeg ?? [0, 0.0025];
  const confidences = axes.minConfidences ?? [0.3, 0.5, 0.7];
  const maxHolds = axes.maxHoldTicksOptions ?? [Number.POSITIVE_INFINITY];

  const cells: SweepCellResult[] = [];
  for (const feePerLeg of fees) {
    for (const slippagePerLeg of slippages) {
      for (const minConfidence of confidences) {
        for (const maxHoldTicks of maxHolds) {
          const result = await runStrategyBacktest({
            ...baseConfig,
            feePerLeg,
            slippagePerLeg,
            minConfidence,
            maxHoldTicks,
          });
          cells.push({
            feePerLeg,
            slippagePerLeg,
            minConfidence,
            maxHoldTicks,
            totalTrades: result.totalTrades,
            totalPnL: result.totalPnL,
            winRate: result.winRate,
            sharpeRatio: result.sharpeRatio,
            maxDrawdown: result.maxDrawdown,
            realizedAccuracy: result.realizedAccuracy,
            positionsOpened: result.positionsOpened,
          });
        }
      }
    }
  }

  const profitableCells = cells.filter((c) => c.totalPnL > 0);
  const best = cells.length === 0
    ? null
    : cells.reduce((acc, c) => (acc && acc.totalPnL >= c.totalPnL ? acc : c), null as SweepCellResult | null);
  const bestRiskAdjusted = cells.length === 0
    ? null
    : cells.reduce((acc, c) => (acc && acc.sharpeRatio >= c.sharpeRatio ? acc : c), null as SweepCellResult | null);

  return {
    cells,
    best,
    bestRiskAdjusted,
    profitableFraction: cells.length === 0 ? 0 : profitableCells.length / cells.length,
  };
}

/**
 * Walk-forward analysis: split the synthetic dataset into N sequential
 * windows, run the engine on each independently, and report per-window
 * stats.  A strategy whose PnL is positive in window 1 but negative in
 * windows 2-5 is overfit to early data; reject it.
 */
export type WalkForwardWindowResult = {
  windowIndex: number;
  startSeed: number;
  numMarkets: number;
  totalTrades: number;
  totalPnL: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
};

export type WalkForwardResult = {
  windows: WalkForwardWindowResult[];
  /** Mean win rate across windows. */
  meanWinRate: number;
  /** StdDev of win rate (lower = more consistent). */
  winRateStdDev: number;
  /** Mean total PnL across windows. */
  meanPnL: number;
  /** Fraction of windows with positive PnL. */
  positivePnlFraction: number;
};

export async function runWalkForwardBacktest(
  baseConfig: Partial<StrategyBacktestConfig> = {},
  numWindows: number = 5,
): Promise<WalkForwardResult> {
  const baseSeed = baseConfig.synthetic?.seed ?? 1;
  const numMarkets = baseConfig.synthetic?.numMarkets ?? 25;
  const windows: WalkForwardWindowResult[] = [];

  for (let i = 0; i < numWindows; i++) {
    // Each window uses a different seed → different synthetic markets,
    // simulating different "time periods".  This is the in-sample/out-of-
    // sample split for synthetic backtesting: if all windows profit, the
    // strategy isn't seed-fragile.
    const seed = baseSeed + i * 1009; // prime offset to avoid LCG correlation
    const result = await runStrategyBacktest({
      ...baseConfig,
      synthetic: { ...(baseConfig.synthetic ?? {}), seed },
    });
    windows.push({
      windowIndex: i,
      startSeed: seed,
      numMarkets,
      totalTrades: result.totalTrades,
      totalPnL: result.totalPnL,
      winRate: result.winRate,
      sharpeRatio: result.sharpeRatio,
      maxDrawdown: result.maxDrawdown,
    });
  }

  const winRates = windows.map((w) => w.winRate);
  const pnls = windows.map((w) => w.totalPnL);
  const meanWinRate =
    winRates.length === 0 ? 0 : winRates.reduce((a, b) => a + b, 0) / winRates.length;
  const winRateVariance =
    winRates.length === 0
      ? 0
      : winRates.reduce((sum, wr) => sum + (wr - meanWinRate) ** 2, 0) / winRates.length;
  const meanPnL =
    pnls.length === 0 ? 0 : pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const positivePnl = windows.filter((w) => w.totalPnL > 0).length;

  return {
    windows,
    meanWinRate,
    winRateStdDev: Math.sqrt(winRateVariance),
    meanPnL,
    positivePnlFraction: windows.length === 0 ? 0 : positivePnl / windows.length,
  };
}

/**
 * Solve for the breakeven fee level: the per-leg fee at which total PnL
 * crosses zero.  Bisection on the fee axis with the same dataset so the
 * only thing varying is cost.  If breakeven fee >> realistic exchange fee
 * (e.g., > 200 bps), the strategy has comfortable margin; if < 50 bps,
 * it's a marginal strategy that won't survive real-world friction.
 *
 * Returns null if even fee=0 isn't profitable (no edge to capture).
 */
export async function findBreakevenFee(
  baseConfig: Partial<StrategyBacktestConfig> = {},
  options: { tolerance?: number; maxIterations?: number; upperBoundFee?: number } = {},
): Promise<{ breakevenFeePerLeg: number; iterations: number } | null> {
  const tolerance = options.tolerance ?? 0.0005; // 5 bps precision
  const maxIterations = options.maxIterations ?? 24;
  let lo = 0;
  let hi = options.upperBoundFee ?? 0.05; // up to 500 bps per leg

  // Sanity: if no edge at fee=0, bail.
  const zeroFee = await runStrategyBacktest({
    ...baseConfig,
    feePerLeg: 0,
    slippagePerLeg: baseConfig.slippagePerLeg ?? 0,
  });
  if (zeroFee.totalPnL <= 0) return null;

  // If the strategy still profits at the upper bound, breakeven is above it.
  const hiProbe = await runStrategyBacktest({
    ...baseConfig,
    feePerLeg: hi,
    slippagePerLeg: baseConfig.slippagePerLeg ?? 0,
  });
  if (hiProbe.totalPnL > 0) return { breakevenFeePerLeg: hi, iterations: 0 };

  let iterations = 0;
  while (hi - lo > tolerance && iterations < maxIterations) {
    const mid = (lo + hi) / 2;
    const probe = await runStrategyBacktest({
      ...baseConfig,
      feePerLeg: mid,
      slippagePerLeg: baseConfig.slippagePerLeg ?? 0,
    });
    if (probe.totalPnL > 0) lo = mid;
    else hi = mid;
    iterations += 1;
  }

  return { breakevenFeePerLeg: (lo + hi) / 2, iterations };
}
