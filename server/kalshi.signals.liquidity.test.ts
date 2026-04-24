import { describe, expect, it } from "vitest";
import type { MarketFeed } from "./_core/kalshiMarketFeed";
import {
  filterSignalsByMarketConditions,
  generateSignalsForMarket,
  type KalshiSignal,
} from "./_core/kalshiSignals";

const market = {
  id: "FED-RATE-CUT",
  title: "Will the Fed cut rates this quarter?",
  yesPrice: 0.44,
  noPrice: 0.56,
  impliedProbability: 0.44,
  volume24h: 22000,
  liquidity: 15000,
  closeTime: Date.now() + 7 * 24 * 60 * 60 * 1000,
};

function createFeed(overrides: Partial<MarketFeed> = {}): MarketFeed {
  const now = Date.now();
  return {
    marketId: market.id,
    status: "active",
    currentSnapshot: {
      marketId: market.id,
      timestamp: now,
      yesPrice: market.yesPrice,
      noPrice: market.noPrice,
      yesVolume: 2400,
      noVolume: 2200,
      impliedProbability: market.impliedProbability,
    },
    priceHistory: [
      {
        marketId: market.id,
        timestamp: now - 60000,
        yesPrice: 0.39,
        noPrice: 0.61,
        yesVolume: 1200,
        noVolume: 1100,
        impliedProbability: 0.39,
      },
      {
        marketId: market.id,
        timestamp: now,
        yesPrice: market.yesPrice,
        noPrice: market.noPrice,
        yesVolume: 2400,
        noVolume: 2200,
        impliedProbability: market.impliedProbability,
      },
    ],
    volumeHistory: [
      { timestamp: now - 60000, yesVolume: 1200, noVolume: 1100 },
      { timestamp: now, yesVolume: 2400, noVolume: 2200 },
    ],
    dataQualityScore: 0.92,
    ...overrides,
  };
}

describe("liquidity-adjusted signal filtering", () => {
  it("attaches liquidity metadata to generated signals when feed data is available", async () => {
    const signals = await generateSignalsForMarket(market as never, createFeed(), 0.62, {
      topic: market.title,
      newsSentiment: 0.2,
      socialSentiment: 0.1,
      marketSentiment: -0.05,
    });

    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => typeof signal.metadata?.liquidityScore === "number")).toBe(true);
    expect(signals.every((signal) => typeof signal.metadata?.spreadProxy === "number")).toBe(true);
    expect(signals.every((signal) => typeof signal.metadata?.totalVolume === "number")).toBe(true);
  });

  it("filters out thin, poor-quality markets from execution candidates", () => {
    const signals: KalshiSignal[] = [
      {
        marketId: "liquid",
        signalType: "value_play",
        side: "yes",
        confidence: 0.74,
        reasoning: "Liquid setup",
        impliedProbability: 0.42,
        marketPrice: 0.42,
        expectedValue: 0.11,
      },
      {
        marketId: "thin",
        signalType: "momentum",
        side: "yes",
        confidence: 0.8,
        reasoning: "Thin setup",
        impliedProbability: 0.52,
        marketPrice: 0.52,
        expectedValue: 0.09,
      },
    ];

    const feeds = new Map<string, MarketFeed>([
      [
        "liquid",
        createFeed({
          marketId: "liquid",
          currentSnapshot: {
            marketId: "liquid",
            timestamp: Date.now(),
            yesPrice: 0.48,
            noPrice: 0.52,
            yesVolume: 3200,
            noVolume: 2800,
            impliedProbability: 0.48,
          },
        }),
      ],
      [
        "thin",
        createFeed({
          marketId: "thin",
          currentSnapshot: {
            marketId: "thin",
            timestamp: Date.now(),
            yesPrice: 0.66,
            noPrice: 0.5,
            yesVolume: 60,
            noVolume: 40,
            impliedProbability: 0.58,
          },
          dataQualityScore: 0.2,
        }),
      ],
    ]);

    const filtered = filterSignalsByMarketConditions(signals, feeds, 0.35);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].marketId).toBe("liquid");
  });
});
