/**
 * Verifies that Polymarket paper-trade mode actually short-circuits the
 * live CLOB call.  Before this pass, ENV.paperTradeMode only protected
 * Kalshi — Polymarket orders went straight to the real exchange even
 * with PAPER_TRADE_MODE=true, which made paper validation impossible
 * for half the system.
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
    requireApprovalAbove: 100,
  },
  getTradingPreferences: vi.fn(),
  getPolymarketCredentials: vi.fn(),
  isUserSubscribedToPolymarket: vi.fn(),
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
  simulatePolymarketOrderFill: vi.fn(),
}));

vi.mock("./db.trading-preferences", () => ({
  DEFAULT_TRADING_PREFERENCES: mocks.DEFAULT_PREFERENCES,
  getTradingPreferences: mocks.getTradingPreferences,
}));

vi.mock("./db.polymarket-credentials", () => ({
  getPolymarketCredentials: mocks.getPolymarketCredentials,
  isUserSubscribedToPolymarket: mocks.isUserSubscribedToPolymarket,
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

vi.mock("./_core/paperTrading", () => ({
  simulatePolymarketOrderFill: mocks.simulatePolymarketOrderFill,
}));

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
  mocks.isUserSubscribedToPolymarket.mockResolvedValue(true);
  mocks.getTradingPreferences.mockResolvedValue(mocks.DEFAULT_PREFERENCES);
  mocks.getPolymarketCredentials.mockResolvedValue({
    userId: 8,
    accountStatus: "connected",
    apiKey: "k",
    apiSecret: "s",
    apiPassphrase: "p",
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

describe("Polymarket autonomy — paper mode short-circuit", () => {
  beforeEach(() => {
    delete process.env.PAPER_TRADE_MODE;
    vi.resetModules();
  });

  it("calls the real placePolymarketOrder when PAPER_TRADE_MODE is unset", async () => {
    setupHappyPath();
    mocks.placePolymarketOrder.mockResolvedValue({
      success: true,
      orderId: "real-order-1",
    });

    const { runPolymarketAutonomousTrading } = await import("./_core/polymarketAutonomy");
    const result = await runPolymarketAutonomousTrading(8);

    expect(result.status).toBe("executed");
    expect(mocks.placePolymarketOrder).toHaveBeenCalledTimes(1);
    expect(mocks.simulatePolymarketOrderFill).not.toHaveBeenCalled();
    expect(result.orderId).toBe("real-order-1");
  });

  it("calls the simulator (NOT the live CLOB) when PAPER_TRADE_MODE=true", async () => {
    process.env.PAPER_TRADE_MODE = "true";
    vi.resetModules();
    setupHappyPath();
    mocks.simulatePolymarketOrderFill.mockResolvedValue({
      success: true,
      orderId: "paper-order-1",
    });

    const { runPolymarketAutonomousTrading } = await import("./_core/polymarketAutonomy");
    const result = await runPolymarketAutonomousTrading(8);

    expect(result.status).toBe("executed");
    expect(mocks.simulatePolymarketOrderFill).toHaveBeenCalledTimes(1);
    expect(mocks.placePolymarketOrder).not.toHaveBeenCalled();
    expect(result.orderId).toBe("paper-order-1");

    // Verify the simulator received the right shape.
    const [userId, order, openId] = mocks.simulatePolymarketOrderFill.mock.calls[0];
    expect(userId).toBe(8);
    expect(order.marketId).toBe("market1");
    expect(order.tokenId).toBe("token1_yes");
    expect(order.positionSide).toBe("yes");
    expect(order.price).toBe(0.6);
    // estimateSizeForRiskBudget mock returns 8, but the autonomy clamps
    // to min(maxOrderNotional=10, BASE_RISK_LIMITS.maxLossPerTrade=5, ...)
    // → 5 USDC final size after risk budget.
    expect(order.sizeUsdc).toBe(5);
    expect(typeof openId).toBe("string");
  });
});
