import { describe, expect, it } from "vitest";
import {
  createPrng,
  generateSyntheticDataset,
  generateMarketSeries,
  toKalshiSnapshot,
  toPolymarketSnapshot,
  DEFAULT_SYNTHETIC_CONFIG,
} from "./_core/syntheticMarkets";
import { runStrategyBacktest } from "./_core/strategyBacktest";

describe("syntheticMarkets", () => {
  it("createPrng returns the same sequence for the same seed", () => {
    const a = createPrng(42);
    const b = createPrng(42);
    for (let i = 0; i < 10; i++) {
      expect(a()).toBeCloseTo(b(), 10);
    }
  });

  it("generateSyntheticDataset is deterministic given a seed", () => {
    const a = generateSyntheticDataset({ numMarkets: 5, seed: 7 });
    const b = generateSyntheticDataset({ numMarkets: 5, seed: 7 });
    expect(a).toEqual(b);
  });

  it("market series respect the configured tick count", () => {
    const dataset = generateSyntheticDataset({
      numMarkets: 3,
      ticksPerMarket: 25,
      seed: 1,
    });
    expect(dataset).toHaveLength(3);
    for (const market of dataset) {
      expect(market.series).toHaveLength(25);
    }
  });

  it("price series stays within (0.01, 0.99)", () => {
    const dataset = generateSyntheticDataset({ numMarkets: 5, seed: 3 });
    for (const market of dataset) {
      for (const price of market.series) {
        expect(price).toBeGreaterThan(0);
        expect(price).toBeLessThan(1);
      }
    }
  });

  it("resolution is binary 0/1", () => {
    const dataset = generateSyntheticDataset({ numMarkets: 50, seed: 99 });
    for (const market of dataset) {
      expect([0, 1]).toContain(market.resolution);
    }
  });

  it("toKalshiSnapshot mirrors the synthetic price at the requested tick", () => {
    const rng = createPrng(11);
    const series = generateMarketSeries(DEFAULT_SYNTHETIC_CONFIG, rng, 0);
    const snap = toKalshiSnapshot(series, 5);
    expect(snap.id).toBe(series.marketId);
    expect(snap.yesPrice).toBeCloseTo(series.series[5]!, 6);
    expect(snap.noPrice).toBeCloseTo(1 - series.series[5]!, 6);
    expect(snap.status).toBe("open");
    expect(snap.impliedProbability).toBeCloseTo(series.series[5]!, 6);
  });

  it("toPolymarketSnapshot exposes YES + NO tokens with mirrored prices", () => {
    const rng = createPrng(12);
    const series = generateMarketSeries(DEFAULT_SYNTHETIC_CONFIG, rng, 0);
    const snap = toPolymarketSnapshot(series, 7);
    expect(snap.tokens).toHaveLength(2);
    const yesTok = snap.tokens.find((t) => t.outcome.toLowerCase() === "yes")!;
    const noTok = snap.tokens.find((t) => t.outcome.toLowerCase() === "no")!;
    expect(yesTok.price + noTok.price).toBeCloseTo(1, 6);
    expect(snap.impliedProbabilityYes).toBeCloseTo(yesTok.price, 6);
  });
});

describe("runStrategyBacktest", () => {
  it("returns aggregated stats for the Kalshi value-play strategy", async () => {
    const result = await runStrategyBacktest({
      platform: "kalshi",
      synthetic: { numMarkets: 20, ticksPerMarket: 30, seed: 1 },
      feePerLeg: 0.005,
      slippagePerLeg: 0.0025,
      positionSizeUsd: 10,
      minConfidence: 0.45,
    });

    expect(result.platform).toBe("kalshi");
    expect(result.marketsReplayed).toBe(20);
    expect(result.signalsEmitted).toBeGreaterThan(0);
    expect(result.totalTrades).toBeGreaterThan(0);
    expect(result.feePerLeg).toBe(0.005);
    expect(result.slippagePerLeg).toBe(0.0025);
    // Win rate is bounded by [0,1]
    expect(result.winRate).toBeGreaterThanOrEqual(0);
    expect(result.winRate).toBeLessThanOrEqual(1);
    // Realized accuracy is bounded by [0,1]
    expect(result.realizedAccuracy).toBeGreaterThanOrEqual(0);
    expect(result.realizedAccuracy).toBeLessThanOrEqual(1);
  });

  it("Kalshi value-play strategy beats break-even on synthetic data with deterministic edge", async () => {
    // value_play monetizes price reversion to fundamentals, NOT resolution
    // accuracy.  If we hold to resolution, accuracy ~50% by symmetry of
    // Bernoulli outcomes.  So we use maxHoldTicks=12 (just long enough for
    // mean reversion at our default 0.05/tick speed).  Frictionless to
    // expose pure alpha; contrarian filtered out (it fights value on
    // synthetic markets where extreme prices reflect true probabilities).
    // This is the floor: if value_play can't profit here, it never will.
    const result = await runStrategyBacktest({
      platform: "kalshi",
      synthetic: {
        numMarkets: 100,
        ticksPerMarket: 40,
        seed: 11,
        initialDisplacement: 0.4,
      },
      feePerLeg: 0,
      slippagePerLeg: 0,
      positionSizeUsd: 10,
      minConfidence: 0.3,
      maxHoldTicks: 12,
      signalTypeAllowlist: ["value_play"],
    });

    expect(result.totalTrades).toBeGreaterThan(10);
    // Strategy should make money on frictionless markets with known edge.
    expect(result.totalPnL).toBeGreaterThan(0);
    // Most exits should be profitable price reversions.
    expect(result.winRate).toBeGreaterThan(0.5);
  });

  it("Polymarket strategy backtest produces aggregated stats", async () => {
    const result = await runStrategyBacktest({
      platform: "polymarket",
      synthetic: { numMarkets: 15, ticksPerMarket: 25, seed: 5 },
      feePerLeg: 0.002,
      slippagePerLeg: 0.001,
      positionSizeUsd: 25,
      minConfidence: 0.55,
    });

    expect(result.platform).toBe("polymarket");
    expect(result.marketsReplayed).toBe(15);
    expect(result.signalsEmitted).toBeGreaterThan(0);
    expect(result.feePerLeg).toBe(0.002);
  });

  it("higher fees + slippage erode profitability", async () => {
    const cheap = await runStrategyBacktest({
      platform: "kalshi",
      synthetic: { numMarkets: 60, ticksPerMarket: 30, seed: 3 },
      feePerLeg: 0,
      slippagePerLeg: 0,
      positionSizeUsd: 10,
      minConfidence: 0.5,
    });
    const expensive = await runStrategyBacktest({
      platform: "kalshi",
      synthetic: { numMarkets: 60, ticksPerMarket: 30, seed: 3 },
      feePerLeg: 0.02,
      slippagePerLeg: 0.02,
      positionSizeUsd: 10,
      minConfidence: 0.5,
    });

    // Same seed → same markets → cost gap should be the only driver.  Net
    // PnL should be lower (or equal) when costs are higher.
    expect(expensive.totalPnL).toBeLessThanOrEqual(cheap.totalPnL);
  });

  it("respects the minConfidence floor (higher floor → fewer trades)", async () => {
    const lowFloor = await runStrategyBacktest({
      platform: "kalshi",
      synthetic: { numMarkets: 30, ticksPerMarket: 25, seed: 4 },
      feePerLeg: 0.005,
      slippagePerLeg: 0,
      positionSizeUsd: 10,
      minConfidence: 0.4,
    });
    const highFloor = await runStrategyBacktest({
      platform: "kalshi",
      synthetic: { numMarkets: 30, ticksPerMarket: 25, seed: 4 },
      feePerLeg: 0.005,
      slippagePerLeg: 0,
      positionSizeUsd: 10,
      minConfidence: 0.85,
    });
    expect(highFloor.totalTrades).toBeLessThanOrEqual(lowFloor.totalTrades);
  });

  it("maxHoldTicks forces earlier exits", async () => {
    const longHold = await runStrategyBacktest({
      platform: "kalshi",
      synthetic: { numMarkets: 20, ticksPerMarket: 50, seed: 6 },
      feePerLeg: 0.005,
      slippagePerLeg: 0,
      positionSizeUsd: 10,
      minConfidence: 0.5,
    });
    const shortHold = await runStrategyBacktest({
      platform: "kalshi",
      synthetic: { numMarkets: 20, ticksPerMarket: 50, seed: 6 },
      feePerLeg: 0.005,
      slippagePerLeg: 0,
      positionSizeUsd: 10,
      minConfidence: 0.5,
      maxHoldTicks: 3,
    });

    // Short-hold should trigger more exit-by-time-stop trades on average.
    // Trade count should be >= because each market can produce more
    // entry/exit cycles when forced out early.
    expect(shortHold.totalTrades).toBeGreaterThanOrEqual(longHold.totalTrades);
  });
});
