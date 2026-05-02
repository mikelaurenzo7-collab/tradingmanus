import { describe, it, expect } from "vitest";
import {
  mergePlatformSignals,
  executeCrossArbLegs,
  type CrossBotSignal,
} from "./_core/crossBotStrategies";
import type { KalshiSignal } from "./_core/kalshiSignals";
import type { PolymarketSignal } from "./_core/polymarketSignals";
import type { CrossPlatformArbitrageOpportunity } from "./_core/crossPlatformArbitrage";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeKalshiSignal(
  overrides: Partial<KalshiSignal> = {},
): KalshiSignal {
  return {
    marketId: "kalshi-market-1",
    signalType: "value_play",
    side: "yes",
    confidence: 0.7,
    reasoning: "Kalshi value play on politics market",
    impliedProbability: 0.55,
    marketPrice: 0.45,
    expectedValue: 0.18,
    ...overrides,
  };
}

function makePolymarketSignal(
  overrides: Partial<PolymarketSignal> = {},
): PolymarketSignal {
  return {
    marketId: "poly-market-1",
    conditionId: "cond-1",
    question: "Will the election be held on time?",
    signalType: "value_play",
    side: "yes",
    confidence: 0.65,
    reasoning: "Polymarket value play",
    impliedProbabilityYes: 0.45,
    fairValueEstimate: 0.55,
    tokenId: "token-yes-1",
    limitPrice: 0.45,
    expectedValue: 0.22,
    ...overrides,
  };
}

const sampleArbitrageOpp: CrossPlatformArbitrageOpportunity = {
  type: "buy_kalshi_yes_sell_polymarket_yes",
  kalshiMarketId: "kalshi-election-2024",
  kalshiTitle: "Election held on time?",
  polymarketMarketId: "poly-election-2024",
  polymarketQuestion: "Will the election be held on time?",
  kalshiYesPrice: 0.42,
  polymarketYesPrice: 0.55,
  spread: 0.13,
  netEdge: 0.12,
  buyPlatform: "kalshi",
  sellPlatform: "polymarket",
  confidence: 0.8,
  reasoning: "Strong arb",
  minLiquidity: 1000,
};

// ---------------------------------------------------------------------------
// mergePlatformSignals
// ---------------------------------------------------------------------------

describe("mergePlatformSignals", () => {
  it("returns empty results when no signals are provided", () => {
    const result = mergePlatformSignals([], []);
    expect(result.signals).toHaveLength(0);
    expect(result.consensusCount).toBe(0);
    expect(result.kalshiCount).toBe(0);
    expect(result.polymarketCount).toBe(0);
    expect(result.topConviction).toBeNull();
  });

  it("includes Kalshi-only signals", () => {
    const result = mergePlatformSignals(
      [makeKalshiSignal()],
      [],
    );
    expect(result.kalshiCount).toBe(1);
    expect(result.polymarketCount).toBe(0);
    expect(result.signals[0]?.platform).toBe("kalshi");
  });

  it("includes Polymarket-only signals", () => {
    const result = mergePlatformSignals(
      [],
      [makePolymarketSignal()],
    );
    expect(result.polymarketCount).toBe(1);
    expect(result.kalshiCount).toBe(0);
    expect(result.signals[0]?.platform).toBe("polymarket");
  });

  it("filters out signals below minConfidence", () => {
    const result = mergePlatformSignals(
      [makeKalshiSignal({ confidence: 0.3 })],
      [makePolymarketSignal({ confidence: 0.4 })],
      { minConfidence: 0.5 },
    );
    expect(result.signals).toHaveLength(0);
  });

  it("detects consensus when both bots agree on same event and direction", () => {
    const kalshi = makeKalshiSignal({
      marketId: "k-election",
      confidence: 0.72,
    });
    const poly = makePolymarketSignal({
      marketId: "p-election",
      question: "election held on time",
      side: "yes",
      confidence: 0.68,
    });
    const titleMap = new Map([["k-election", "election held on time"]]);

    const result = mergePlatformSignals([kalshi], [poly], {
      minSimilarity: 0.2,
      kalshiTitles: titleMap,
    });

    expect(result.consensusCount).toBe(1);
    const kalshiSig = result.signals.find((s) => s.platform === "kalshi");
    expect(kalshiSig?.consensusPartner).toBeDefined();
    expect(kalshiSig?.consensusPartner?.platform).toBe("polymarket");
    // Conviction should be boosted above raw confidence
    expect(kalshiSig!.convictionScore).toBeGreaterThan(kalshi.confidence);
  });

  it("does NOT detect consensus when sides differ", () => {
    const kalshi = makeKalshiSignal({ side: "yes", confidence: 0.72 });
    const poly = makePolymarketSignal({ side: "no", confidence: 0.68 });
    const titleMap = new Map([["kalshi-market-1", "Will the election be held on time?"]]);

    const result = mergePlatformSignals([kalshi], [poly], {
      minSimilarity: 0.2,
      kalshiTitles: titleMap,
    });

    expect(result.consensusCount).toBe(0);
    expect(result.signals.every((s) => !s.consensusPartner)).toBe(true);
  });

  it("sorts signals by conviction score descending", () => {
    const signals = mergePlatformSignals(
      [
        makeKalshiSignal({ marketId: "k1", confidence: 0.6 }),
        makeKalshiSignal({ marketId: "k2", confidence: 0.9 }),
      ],
      [],
    );
    const scores = signals.signals.map((s) => s.convictionScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]!);
    }
  });

  it("topConviction points to the highest-scoring signal", () => {
    const result = mergePlatformSignals(
      [
        makeKalshiSignal({ marketId: "k1", confidence: 0.6 }),
        makeKalshiSignal({ marketId: "k2", confidence: 0.85 }),
      ],
      [makePolymarketSignal({ confidence: 0.7 })],
    );
    expect(result.topConviction).not.toBeNull();
    expect(result.topConviction!.convictionScore).toBe(
      Math.max(...result.signals.map((s) => s.convictionScore)),
    );
  });

  it("conviction score is clamped to [0, 1]", () => {
    const titleMap = new Map([["k-el", "election held on time"]]);
    const result = mergePlatformSignals(
      [makeKalshiSignal({ marketId: "k-el", confidence: 0.98 })],
      [makePolymarketSignal({ question: "election held on time", side: "yes", confidence: 0.97 })],
      { minSimilarity: 0.1, kalshiTitles: titleMap },
    );
    for (const s of result.signals) {
      expect(s.convictionScore).toBeLessThanOrEqual(1);
      expect(s.convictionScore).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// executeCrossArbLegs
// ---------------------------------------------------------------------------

describe("executeCrossArbLegs", () => {
  it("returns bothLegsExecuted=true when both executors succeed", async () => {
    const result = await executeCrossArbLegs(
      sampleArbitrageOpp,
      {
        kalshiContracts: 5,
        polymarketSizeUsdc: 10,
        polymarketTokenIdYes: "token-yes-123",
        polymarketTokenIdNo: "token-no-123",
      },
      {
        placeKalshiOrder: async (_mid, _side, _qty, _price) => ({
          success: true,
          orderId: "k-order-1",
        }),
        placePolymarketOrder: async (_tid, _side, _price, _size) => ({
          success: true,
          orderId: "p-order-1",
        }),
      },
    );

    expect(result.success).toBe(true);
    expect(result.bothLegsExecuted).toBe(true);
    expect(result.kalshiLeg.success).toBe(true);
    expect(result.polymarketLeg.success).toBe(true);
    expect(result.kalshiLeg.orderId).toBe("k-order-1");
    expect(result.polymarketLeg.orderId).toBe("p-order-1");
    expect(result.reasoning).toContain("Both legs executed");
  });

  it("Kalshi leg failure short-circuits — Polymarket leg is NOT attempted (sequential default)", async () => {
    let polymarketAttempts = 0;
    const result = await executeCrossArbLegs(
      sampleArbitrageOpp,
      {
        kalshiContracts: 5,
        polymarketSizeUsdc: 10,
        polymarketTokenIdYes: "token-yes-123",
        polymarketTokenIdNo: "token-no-123",
      },
      {
        placeKalshiOrder: async () => ({
          success: false,
          error: "Insufficient funds on Kalshi",
        }),
        placePolymarketOrder: async () => {
          polymarketAttempts += 1;
          return { success: true, orderId: "p-order-1" };
        },
      },
    );

    expect(result.success).toBe(false);
    expect(result.bothLegsExecuted).toBe(false);
    expect(result.kalshiLeg.success).toBe(false);
    expect(result.kalshiLeg.attempted).toBe(true);
    // Critical: Polymarket leg must NOT have been attempted, otherwise we'd
    // be naked-long on the Polymarket side.
    expect(polymarketAttempts).toBe(0);
    expect(result.polymarketLeg.success).toBe(false);
    expect(result.polymarketLeg.attempted).toBe(false);
    expect(result.reasoning).toContain("Insufficient funds on Kalshi");
    expect(result.reasoning).toContain("SKIPPED");
  });

  it("parallel mode preserves the legacy concurrent-fire behavior when explicitly opted in", async () => {
    let polymarketAttempts = 0;
    const result = await executeCrossArbLegs(
      sampleArbitrageOpp,
      {
        kalshiContracts: 5,
        polymarketSizeUsdc: 10,
        polymarketTokenIdYes: "token-yes-123",
        polymarketTokenIdNo: "token-no-123",
        parallel: true,
      },
      {
        placeKalshiOrder: async () => ({
          success: false,
          error: "Insufficient funds on Kalshi",
        }),
        placePolymarketOrder: async () => {
          polymarketAttempts += 1;
          return { success: true, orderId: "p-order-1" };
        },
      },
    );

    expect(result.kalshiLeg.success).toBe(false);
    expect(result.polymarketLeg.success).toBe(true);
    expect(polymarketAttempts).toBe(1);
  });

  it("returns bothLegsExecuted=false when Polymarket leg fails", async () => {
    const result = await executeCrossArbLegs(
      sampleArbitrageOpp,
      {
        kalshiContracts: 5,
        polymarketSizeUsdc: 10,
        polymarketTokenIdYes: "token-yes-123",
        polymarketTokenIdNo: "token-no-123",
      },
      {
        placeKalshiOrder: async () => ({
          success: true,
          orderId: "k-order-1",
        }),
        placePolymarketOrder: async () => ({
          success: false,
          error: "Polymarket order rejected",
        }),
      },
    );

    expect(result.success).toBe(false);
    expect(result.bothLegsExecuted).toBe(false);
    expect(result.kalshiLeg.success).toBe(true);
    expect(result.polymarketLeg.success).toBe(false);
    expect(result.reasoning).toContain("Polymarket order rejected");
  });

  it("handles executor exceptions gracefully", async () => {
    const result = await executeCrossArbLegs(
      sampleArbitrageOpp,
      {
        kalshiContracts: 5,
        polymarketSizeUsdc: 10,
        polymarketTokenIdYes: "token-yes-123",
        polymarketTokenIdNo: "token-no-123",
      },
      {
        placeKalshiOrder: async () => {
          throw new Error("Network timeout");
        },
        placePolymarketOrder: async () => ({
          success: true,
          orderId: "p-order-1",
        }),
      },
    );

    expect(result.success).toBe(false);
    expect(result.bothLegsExecuted).toBe(false);
    expect(result.kalshiLeg.attempted).toBe(true);
    expect(result.kalshiLeg.success).toBe(false);
    expect(result.kalshiLeg.error).toContain("Network timeout");
  });

  it("executes correct legs when buyPlatform=polymarket", async () => {
    const oppPolyBuy: CrossPlatformArbitrageOpportunity = {
      ...sampleArbitrageOpp,
      type: "buy_polymarket_yes_sell_kalshi_yes",
      buyPlatform: "polymarket",
      sellPlatform: "kalshi",
      kalshiYesPrice: 0.58,
      polymarketYesPrice: 0.44,
    };

    const kalshiCalls: Array<{ side: string; price: number }> = [];
    const polyCalls: Array<{ tokenId: string; side: string; price: number }> = [];

    await executeCrossArbLegs(
      oppPolyBuy,
      {
        kalshiContracts: 5,
        polymarketSizeUsdc: 10,
        polymarketTokenIdYes: "token-yes-456",
        polymarketTokenIdNo: "token-no-456",
      },
      {
        placeKalshiOrder: async (_mid, side, _qty, price) => {
          kalshiCalls.push({ side, price });
          return { success: true, orderId: "k-1" };
        },
        placePolymarketOrder: async (tokenId, side, price, _size) => {
          polyCalls.push({ tokenId, side, price });
          return { success: true, orderId: "p-1" };
        },
      },
    );

    // Kalshi leg should buy NO (sell YES side) when polymarket is the buy platform
    expect(kalshiCalls[0]?.side).toBe("no");
    // Polymarket leg should buy YES token when buyPlatform=polymarket
    expect(polyCalls[0]?.tokenId).toBe("token-yes-456");
    expect(polyCalls[0]?.side).toBe("BUY");
  });
});
