import { describe, expect, it } from "vitest";
import { buildLiquidityRow, summarizeLiquidityRows } from "./liquidityAnalytics";

const feed = {
  marketId: "FED_CUT_JUN",
  status: "open",
  dataQualityScore: 0.9,
  currentSnapshot: {
    yesPrice: 0.56,
    noPrice: 0.43,
    yesVolume: 1800,
    noVolume: 1200,
    impliedProbability: 0.56,
    timestamp: 2,
  },
  priceHistory: [
    { impliedProbability: 0.51, timestamp: 1 },
    { impliedProbability: 0.56, timestamp: 2 },
  ],
  volumeHistory: [
    { yesVolume: 1000, noVolume: 1000, timestamp: 1 },
    { yesVolume: 1800, noVolume: 1200, timestamp: 2 },
  ],
};

describe("liquidityAnalytics", () => {
  it("derives richer liquidity diagnostics from a live market feed snapshot", () => {
    const row = buildLiquidityRow(feed)!;

    expect(row.marketId).toBe("FED_CUT_JUN");
    expect(row.totalVolume).toBe(3000);
    expect(row.depthMomentum).toBeCloseTo(0.5, 5);
    expect(row.momentum).toBeCloseTo(0.05, 5);
    expect(row.tradabilityScore).toBeGreaterThan(0);
    expect(row.microstructurePressure).toBeGreaterThan(0);
  });

  it("summarizes the enriched liquidity rows for analytics header cards", () => {
    const row = buildLiquidityRow(feed)!;
    expect(summarizeLiquidityRows([row])).toEqual({
      tracked: 1,
      avgLiquidity: 3000,
      avgSpread: Math.abs(0.56 + 0.43 - 1),
      avgTradability: row.tradabilityScore,
      avgPressure: row.microstructurePressure,
    });
  });
});
