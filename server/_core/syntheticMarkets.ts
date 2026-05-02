/**
 * Synthetic prediction-market generators for backtesting.
 *
 * Real historical Kalshi/Polymarket data is hard to come by and the bots'
 * signal generators are deterministic functions of market state.  So before
 * we ship anything to live capital we want to validate that, given markets
 * with a known true probability, the signal generators systematically
 * extract profitable trades net of fees and slippage.  If they can't
 * extract edge from data with deterministic edge, they certainly won't
 * from real markets.
 *
 * Each market here has a hidden "true probability" (the eventual fraction
 * of trials that resolve YES) and a price path that meanders around that
 * truth with mean-reverting noise plus drift.  At any point in time the
 * market is, by construction, mispriced relative to truth — exactly the
 * kind of inefficiency a value-play strategy is meant to find.
 */

import type { KalshiMarket } from "./kalshiMarketData";
import type { PolymarketMarket } from "./polymarketAuth";

export type SyntheticConfig = {
  /** How many distinct markets to simulate. */
  numMarkets: number;
  /** Number of price observations per market across its life. */
  ticksPerMarket: number;
  /** Mean-reversion strength toward the true probability per tick. */
  meanReversion: number;
  /** Standard deviation of per-tick noise. */
  noise: number;
  /** Bias added to noise (price drifts toward / away from truth over time). */
  driftToTruth: number;
  /** RNG seed for reproducibility. */
  seed: number;
  /** Optional initial-price displacement scale (how far the price starts from p_true). */
  initialDisplacement: number;
};

export const DEFAULT_SYNTHETIC_CONFIG: SyntheticConfig = {
  numMarkets: 25,
  ticksPerMarket: 60,
  meanReversion: 0.05,
  noise: 0.02,
  driftToTruth: 0.005,
  seed: 1,
  initialDisplacement: 0.18,
};

/**
 * Deterministic 32-bit LCG.  Tests need bit-exact reproducibility from a
 * given seed; `Math.random()` does not provide that.  We don't care about
 * cryptographic quality — we only need a consistent stream of pseudo-random
 * numbers that's stable across runs and platforms.
 */
export function createPrng(seed: number): () => number {
  let state = (seed | 0) || 1;
  return () => {
    // Park-Miller minimal standard
    state = (state * 48271) % 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0.01, Math.min(0.99, value));
}

/**
 * Sample from a Beta(2, 2) approximation (centered around 0.5, smooth).
 * Used to draw "true probabilities" for each synthetic market.  Most
 * markets cluster around 50/50, with fewer near the extremes — this
 * matches the empirical distribution of binary prediction-market priors.
 */
function sampleTrueProbability(rng: () => number): number {
  // Beta(2,2) ~ sum of two uniform(0,1) divided by 2.
  return clamp01((rng() + rng()) / 2);
}

export type SyntheticMarketSnapshot = {
  /** Synthetic market identity (stable across all ticks of one market). */
  marketId: string;
  category: string;
  /** Hidden true probability (only revealed to the backtester for resolution). */
  trueProbability: number;
  /** Current tick index (0..ticksPerMarket-1). */
  tick: number;
  /** Current YES price at this tick. */
  yesPrice: number;
};

export type SyntheticMarketSeries = {
  marketId: string;
  category: string;
  trueProbability: number;
  /** Length === ticksPerMarket; series[i] is the YES price at tick i. */
  series: number[];
  /**
   * Resolution outcome (sampled at series-build time): 1 = YES, 0 = NO.
   * The resolution is stochastic with probability `trueProbability` so a
   * 70%-probability market still resolves NO 30% of the time.
   */
  resolution: 0 | 1;
};

/**
 * Generate a single synthetic market's price path + resolution outcome.
 * The price walks from a random initial displacement back toward the true
 * probability with the configured mean-reversion + noise.
 */
export function generateMarketSeries(
  config: SyntheticConfig,
  rng: () => number,
  marketIndex: number,
): SyntheticMarketSeries {
  const trueProbability = sampleTrueProbability(rng);

  // Initial price is displaced from truth by up to ±initialDisplacement,
  // creating an "inefficient" starting price the value strategy should detect.
  const direction = rng() < 0.5 ? -1 : 1;
  const startPrice = clamp01(
    trueProbability + direction * config.initialDisplacement * (0.5 + rng() * 0.5),
  );

  const series: number[] = [startPrice];
  let price = startPrice;
  for (let t = 1; t < config.ticksPerMarket; t++) {
    const reversion = (trueProbability - price) * config.meanReversion;
    // Box-Muller would be ideal, but a simple uniform-noise approximation
    // gives a similar shape and is faster.
    const noiseSample = (rng() - 0.5) * 2 * config.noise;
    const drift = (trueProbability - price) * config.driftToTruth;
    price = clamp01(price + reversion + drift + noiseSample);
    series.push(price);
  }

  // Resolution is a stochastic Bernoulli with p = trueProbability.  This
  // is what makes a 60%-priced market that resolves NO still "fair" — the
  // strategy's edge has to come from systematic mispricing, not from
  // perfect prediction of every outcome.
  const resolution = rng() < trueProbability ? 1 : 0;

  const categories = ["politics", "sports", "crypto", "economics", "weather"];
  const category = categories[marketIndex % categories.length] ?? "politics";

  return {
    marketId: `SYN-${String(marketIndex + 1).padStart(4, "0")}`,
    category,
    trueProbability,
    series,
    resolution,
  };
}

export function generateSyntheticDataset(
  configIn: Partial<SyntheticConfig> = {},
): SyntheticMarketSeries[] {
  const config: SyntheticConfig = { ...DEFAULT_SYNTHETIC_CONFIG, ...configIn };
  const rng = createPrng(config.seed);
  const dataset: SyntheticMarketSeries[] = [];
  for (let i = 0; i < config.numMarkets; i++) {
    dataset.push(generateMarketSeries(config, rng, i));
  }
  return dataset;
}

/**
 * Build a Kalshi-shaped market snapshot at a particular tick.  This is the
 * payload the Kalshi signal generator expects.
 */
export function toKalshiSnapshot(
  series: SyntheticMarketSeries,
  tick: number,
): KalshiMarket {
  const yesPrice = series.series[tick] ?? series.series[series.series.length - 1]!;
  const noPrice = clamp01(1 - yesPrice);
  return {
    id: series.marketId,
    title: `Synthetic ${series.category} market ${series.marketId}`,
    category: series.category,
    description: "Synthetic market for backtesting",
    resolutionDate: new Date(Date.now() + 86_400_000).toISOString(),
    status: "open",
    yesPrice,
    noPrice,
    yesVolume: 1000,
    noVolume: 1000,
    impliedProbability: yesPrice,
  };
}

/**
 * Build a Polymarket-shaped market snapshot at a particular tick.
 */
export function toPolymarketSnapshot(
  series: SyntheticMarketSeries,
  tick: number,
): PolymarketMarket {
  const yesPrice = series.series[tick] ?? series.series[series.series.length - 1]!;
  const noPrice = clamp01(1 - yesPrice);
  return {
    marketId: series.marketId,
    conditionId: `cond-${series.marketId}`,
    question: `Synthetic ${series.category} question ${series.marketId}?`,
    description: "Synthetic Polymarket market for backtesting",
    category: series.category,
    endDateIso: new Date(Date.now() + 86_400_000).toISOString(),
    active: true,
    closed: false,
    tokens: [
      { token_id: `${series.marketId}-YES`, outcome: "Yes", price: yesPrice },
      { token_id: `${series.marketId}-NO`, outcome: "No", price: noPrice },
    ],
    volume: 5000,
    liquidity: 2000,
    impliedProbabilityYes: yesPrice,
  };
}
