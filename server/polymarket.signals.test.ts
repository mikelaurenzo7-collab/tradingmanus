import { describe, expect, it } from "vitest";
import { generatePolymarketSignals } from "./_core/polymarketSignals";

describe("Polymarket Signal Generation", () => {
  it("applies platform-specific sentiment confidence boost", () => {
    const markets = [
      {
        marketId: "pm-sent-1",
        conditionId: "cond-1",
        question: "Will candidate X win?",
        category: "politics",
        active: true,
        closed: false,
        volume: 2500,
        liquidity: 1500,
        impliedProbabilityYes: 0.45,
        tokens: [
          { token_id: "yes-1", outcome: "Yes", price: 0.45 },
          { token_id: "no-1", outcome: "No", price: 0.55 },
        ],
      },
    ];

    const sentimentScores = new Map<string, number>([["pm-sent-1", 0.8]]);

    const baseSignals = generatePolymarketSignals(markets as any, {
      minConfidence: 0,
      sentimentScores,
    });
    const adaptedSignals = generatePolymarketSignals(markets as any, {
      minConfidence: 0,
      sentimentScores,
      platformPerformance: {
        totalClosedTrades: 220,
        signalWinRates: {
          sentiment: 0.72,
        },
        categoryEdge: {
          politics: 0.03,
        },
      },
    });

    const baseSentiment = baseSignals.find((s) => s.signalType === "sentiment");
    const adaptedSentiment = adaptedSignals.find((s) => s.signalType === "sentiment");

    expect(baseSentiment).toBeDefined();
    expect(adaptedSentiment).toBeDefined();
    expect(adaptedSentiment!.confidence).toBeGreaterThan(baseSentiment!.confidence);
    expect(adaptedSentiment!.metadata?.platformBehaviorProfile?.platform).toBe("polymarket");
    expect(adaptedSentiment!.metadata?.platformBehaviorProfile?.adaptationEpoch).toBe(2);
  });

  it("attaches profile metadata even before adaptation threshold", () => {
    const markets = [
      {
        marketId: "pm-value-1",
        conditionId: "cond-2",
        question: "Will BTC exceed 120k?",
        category: "crypto",
        active: true,
        closed: false,
        volume: 1800,
        liquidity: 1200,
        impliedProbabilityYes: 0.3,
        tokens: [
          { token_id: "yes-2", outcome: "Yes", price: 0.3 },
          { token_id: "no-2", outcome: "No", price: 0.7 },
        ],
      },
    ];

    const signals = generatePolymarketSignals(markets as any, {
      minConfidence: 0,
      fairValues: new Map<string, number>([["pm-value-1", 0.5]]),
      platformPerformance: {
        totalClosedTrades: 42,
      },
    });

    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0].metadata?.platformBehaviorProfile?.sampleSize).toBe(42);
    expect(signals[0].metadata?.platformBehaviorProfile?.hasSufficientData).toBe(false);
  });
});
