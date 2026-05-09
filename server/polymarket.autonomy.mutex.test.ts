/**
 * Verifies that runPolymarketAutonomousTrading serialises concurrent calls
 * for the same user via withUserLock.
 *
 * The risk-check → size → place sequence is a TOCTOU window: two concurrent
 * runs (e.g. Railway in-process scheduler + Vercel cron firing within the
 * same process) could both pass the capital check and place duplicate orders.
 * This test slows down placePolymarketOrder so any missing serialisation would
 * cause overlapping placements.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  DEFAULT_PREFERENCES: {
    autonomyMode: "fully_autonomous" as const,
    liveTradingEnabled: true,
    executionCadence: "continuous_watch" as const,
    riskPosture: "balanced" as const,
    minSignalConfidence: 0.65,
    maxOrderNotional: 10,
    maxDailyOrders: 5,
    requireApprovalAbove: 100, // never trip the approval gate
  },
  getTradingPreferences: vi.fn(),
  getPolymarketCredentials: vi.fn(),
  isPolymarketConnected: vi.fn(),
  fetchPolymarketMarkets: vi.fn(),
  placePolymarketOrder: vi.fn(),
  generatePolymarketSignals: vi.fn(),
  reviewPolymarketSignalsWithTrader: vi.fn(),
  recordPolymarketTradeEntry: vi.fn(),
  getPolymarketPerformanceOverview: vi.fn(),
  buildPolymarketPlatformBehaviorSnapshot: vi.fn(),
  logAuditEvent: vi.fn(),
  getKalshiCapital: vi.fn(),
  getUserTrainingInstructions: vi.fn(),
  isInstructionActiveNow: vi.fn(),
  applyInstructionsToSignals: vi.fn(),
  validatePolymarketOrderRisk: vi.fn(),
  estimateSizeForRiskBudget: vi.fn(),
}));

vi.mock("./db.trading-preferences", () => ({
  DEFAULT_TRADING_PREFERENCES: mocks.DEFAULT_PREFERENCES,
  getTradingPreferences: mocks.getTradingPreferences,
}));

vi.mock("./db.polymarket-credentials", () => ({
  getPolymarketCredentials: mocks.getPolymarketCredentials,
  isPolymarketConnected: mocks.isPolymarketConnected,
}));

vi.mock("./db", () => ({
  logAuditEvent: mocks.logAuditEvent,
  getKalshiCapital: mocks.getKalshiCapital,
  getRecentSignals: vi.fn(async () => []),
}));

vi.mock("./_core/polymarketAuth", () => ({
  fetchPolymarketMarkets: mocks.fetchPolymarketMarkets,
  placePolymarketOrder: mocks.placePolymarketOrder,
}));

vi.mock("./_core/polymarketSignals", () => ({
  generatePolymarketSignals: mocks.generatePolymarketSignals,
}));

vi.mock("./_core/polymarketSignalReviewer", () => ({
  reviewPolymarketSignalsWithTrader: mocks.reviewPolymarketSignalsWithTrader,
}));

vi.mock("./_core/polymarketLearning", () => ({
  recordPolymarketTradeEntry: mocks.recordPolymarketTradeEntry,
  getPolymarketPerformanceOverview: mocks.getPolymarketPerformanceOverview,
  buildPolymarketPlatformBehaviorSnapshot: mocks.buildPolymarketPlatformBehaviorSnapshot,
}));

vi.mock("./_core/polymarketRisk", () => ({
  validatePolymarketOrderRisk: mocks.validatePolymarketOrderRisk,
  estimateSizeForRiskBudget: mocks.estimateSizeForRiskBudget,
  MAX_POLYMARKET_ORDER_USDC: 100,
}));

vi.mock("./db.training", () => ({
  getUserTrainingInstructions: mocks.getUserTrainingInstructions,
  isInstructionActiveNow: mocks.isInstructionActiveNow,
  applyInstructionsToSignals: mocks.applyInstructionsToSignals,
}));

// The mutex test exercises the live-order path; force live (paper=false)
// so the autonomy hits placePolymarketOrder rather than the simulator.
vi.mock("./_core/effectivePaperMode", () => ({
  getEffectivePaperTradeMode: vi.fn(async () => false),
}));

// Bypass the adaptive-cadence gate; this test re-runs autonomy multiple
// times for the same user/market and would otherwise hit the cache.
vi.mock("./_core/adaptiveCadence", () => ({
  shouldReviewMarketAt: vi.fn(() => true),
  recordMarketReview: vi.fn(),
  getAdaptiveCadenceTelemetry: vi.fn(() => ({
    cachedMarketCount: 0,
    medianAgeMs: 0,
    priceDeltaBps: 50,
    staleTtlMs: 600_000,
  })),
}));

vi.mock("./_core/aiToolbelt", () => ({
  newReviewerTelemetry: () => ({
    desks: [],
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    webSearchInvocations: 0,
    extendedThinkingInvocations: 0,
    triageRan: false,
    triageInputCount: 0,
    triageKeptCount: 0,
    anthropicCalls: 0,
    anthropicFailures: 0,
  }),
  getCacheHitRatio: () => 0,
}));

import { runPolymarketAutonomousTrading } from "./_core/polymarketAutonomy";

const SAMPLE_SIGNAL = {
  marketId: "market1",
  tokenId: "token1_yes",
  signalType: "sentiment" as const,
  side: "yes" as const,
  confidence: 0.8,
  expectedValue: 0.15,
  fairValueEstimate: 0.62,
  limitPrice: 0.6,
  reasoning: "test",
};

function setupHappyPath() {
  vi.clearAllMocks();
  mocks.isPolymarketConnected.mockResolvedValue(true);
  mocks.getTradingPreferences.mockResolvedValue(mocks.DEFAULT_PREFERENCES);
  mocks.getPolymarketCredentials.mockResolvedValue({
    userId: 8,
    accountStatus: "connected",
    apiKey: "k",
    apiSecret: "s",
    apiPassphrase: "p",
    walletPrivateKey: "0x" + "11".repeat(32),
    walletAddress: "0x0000000000000000000000000000000000000001",
    signatureType: 1,
  });
  mocks.getKalshiCapital.mockResolvedValue({ currentBalance: 500, startingBalance: 500 });
  mocks.getPolymarketPerformanceOverview.mockResolvedValue({
    metrics: { totalTrades: 0 },
    signalPerformance: [],
  });
  mocks.buildPolymarketPlatformBehaviorSnapshot.mockReturnValue({
    totalClosedTrades: 0,
    adaptationEpoch: 0,
    hasSufficientData: false,
    signalWinRates: {},
    categoryEdge: {},
  });
  mocks.fetchPolymarketMarkets.mockResolvedValue([
    {
      id: "market1",
      question: "Q",
      category: "crypto",
      tokens: [
        { id: "token1_yes", name: "YES", price: 0.62 },
        { id: "token1_no", name: "NO", price: 0.38 },
      ],
      volume24h: 100000,
      liquidity: 50000,
    },
  ]);
  mocks.generatePolymarketSignals.mockReturnValue([SAMPLE_SIGNAL]);
  mocks.reviewPolymarketSignalsWithTrader.mockResolvedValue([SAMPLE_SIGNAL]);
  mocks.validatePolymarketOrderRisk.mockReturnValue({
    valid: true,
    reason: null,
    maxOrderSize: 10,
    riskExposure: 4.5,
  });
  mocks.estimateSizeForRiskBudget.mockReturnValue(8);
  mocks.logAuditEvent.mockResolvedValue(true);
  mocks.recordPolymarketTradeEntry.mockResolvedValue(undefined);
  mocks.getUserTrainingInstructions.mockResolvedValue([]);
  mocks.isInstructionActiveNow.mockReturnValue(false);
  mocks.applyInstructionsToSignals.mockImplementation((s: any[]) => s);
}

describe("runPolymarketAutonomousTrading — withUserLock serialisation", () => {
  beforeEach(() => {
    setupHappyPath();
  });

  it("never overlaps placePolymarketOrder calls for the same user", async () => {
    let inFlight = 0;
    let maxOverlap = 0;
    let calls = 0;

    mocks.placePolymarketOrder.mockImplementation(async () => {
      inFlight += 1;
      maxOverlap = Math.max(maxOverlap, inFlight);
      calls += 1;
      // Yield a few microtasks so any missing lock would let the second
      // placement start before this one completes.
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return {
        success: true,
        orderId: `pm-order-${calls}`,
        marketId: "market1",
        tokenId: "token1_yes",
        side: "BUY",
        size: 8,
        price: 0.6,
      };
    });

    const [r1, r2, r3] = await Promise.all([
      runPolymarketAutonomousTrading(8),
      runPolymarketAutonomousTrading(8),
      runPolymarketAutonomousTrading(8),
    ]);

    // All three runs reached order placement.
    expect(mocks.placePolymarketOrder).toHaveBeenCalledTimes(3);
    // Critical invariant: at no point did two placements overlap.
    expect(maxOverlap).toBe(1);
    // All three returned an executed status.
    for (const r of [r1, r2, r3]) {
      expect(r.status).toBe("executed");
      expect(r.orderPlaced).toBe(true);
    }
  });

  it("does not serialise across different users", async () => {
    let inFlight = 0;
    let maxOverlap = 0;

    mocks.placePolymarketOrder.mockImplementation(async () => {
      inFlight += 1;
      maxOverlap = Math.max(maxOverlap, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return {
        success: true,
        orderId: "pm-order",
        marketId: "market1",
        tokenId: "token1_yes",
        side: "BUY",
        size: 8,
        price: 0.6,
      };
    });

    await Promise.all([
      runPolymarketAutonomousTrading(1),
      runPolymarketAutonomousTrading(2),
    ]);

    // Different users hold different mutexes, so the two placements run in
    // parallel — observed overlap must be at least 2.
    expect(maxOverlap).toBeGreaterThanOrEqual(2);
  });

  it("releases the lock when order placement throws", async () => {
    let attempt = 0;
    mocks.placePolymarketOrder.mockImplementation(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("boom");
      }
      return {
        success: true,
        orderId: "pm-order-2",
        marketId: "market1",
        tokenId: "token1_yes",
        side: "BUY",
        size: 8,
        price: 0.6,
      };
    });

    const r1 = await runPolymarketAutonomousTrading(7);
    expect(r1.status).toBe("error");

    // Subsequent run for the same user must not be blocked by a stuck lock.
    const r2 = await runPolymarketAutonomousTrading(7);
    expect(r2.status).toBe("executed");
  });
});
