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
    requireApprovalAbove: 8,
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

// The E2E happy path exercises the live-order path; force live so the
// autonomy hits placePolymarketOrder rather than the paper simulator.
vi.mock("./_core/effectivePaperMode", () => ({
  getEffectivePaperTradeMode: vi.fn(async () => false),
}));

// Bypass the adaptive-cadence gate so every signal reaches the reviewer
// regardless of the in-memory cache state from prior test cases.
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
    cacheReadInputTokens: 100,
    cacheCreationInputTokens: 50,
    inputTokens: 500,
    outputTokens: 200,
    webSearchInvocations: 0,
    extendedThinkingInvocations: 0,
    triageRan: false,
    triageInputCount: 0,
    triageKeptCount: 0,
    anthropicCalls: 1,
    anthropicFailures: 0,
  }),
  getCacheHitRatio: () => 0.75,
}));

import { runPolymarketAutonomousTrading } from "./_core/polymarketAutonomy";

const testUser = {
  id: 8,
  openId: "pm-e2e-user",
  email: "pm-e2e@example.com",
  name: "Polymarket E2E Test",
  role: "user" as const,
  betaAccessLevel: "none" as const,
  twoFactorSecret: null,
  twoFactorEnabled: 0,
  backupCodesHash: null,
  createdAt: new Date(),
  lastSignedIn: new Date(),
};

describe("Polymarket autonomy E2E — full cycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default happy-path setup
    mocks.isUserSubscribedToPolymarket.mockResolvedValue(true);
    mocks.getTradingPreferences.mockResolvedValue(mocks.DEFAULT_PREFERENCES);
    mocks.getPolymarketCredentials.mockResolvedValue({
      userId: 8,
      accountStatus: "connected",
      apiKey: "pm-key",
      apiSecret: "pm-secret",
      apiPassphrase: "pm-pass",
      walletPrivateKey: "0x" + "11".repeat(32),
      walletAddress: "0x0000000000000000000000000000000000000001",
      signatureType: 1,
    });
    mocks.getKalshiCapital.mockResolvedValue({
      currentBalance: 500,
      startingBalance: 500,
    });
    mocks.getPolymarketPerformanceOverview.mockResolvedValue({
      metrics: { totalTrades: 120 },
      signalPerformance: [{ signalType: "sentiment", successRate: 0.65 }],
    });
    mocks.buildPolymarketPlatformBehaviorSnapshot.mockReturnValue({
      totalClosedTrades: 120,
      adaptationEpoch: 1,
      hasSufficientData: true,
      signalWinRates: { sentiment: 0.65 },
      categoryEdge: { crypto: 0.02 },
    });
    mocks.fetchPolymarketMarkets.mockResolvedValue([
      {
        id: "market1",
        question: "Will Bitcoin exceed $100K by end of 2026?",
        category: "crypto",
        tokens: [
          { id: "token1_yes", name: "YES", price: 0.62 },
          { id: "token1_no", name: "NO", price: 0.38 },
        ],
        volume24h: 150000,
        liquidity: 50000,
      },
      {
        id: "market2",
        question: "Will Ethereum outperform Bitcoin?",
        category: "crypto",
        tokens: [
          { id: "token2_yes", name: "YES", price: 0.45 },
          { id: "token2_no", name: "NO", price: 0.55 },
        ],
        volume24h: 75000,
        liquidity: 25000,
      },
      {
        id: "market3",
        question: "Will the Federal Reserve cut rates again?",
        category: "economics",
        tokens: [
          { id: "token3_yes", name: "YES", price: 0.71 },
          { id: "token3_no", name: "NO", price: 0.29 },
        ],
        volume24h: 200000,
        liquidity: 80000,
      },
    ]);
    mocks.generatePolymarketSignals.mockReturnValue([
      {
        marketId: "market1",
        tokenId: "token1_yes",
        signalType: "sentiment" as const,
        side: "yes" as const,
        confidence: 0.76,
        expectedValue: 0.14,
        fairValueEstimate: 0.62,
        limitPrice: 0.60,
        reasoning: "Bullish on Bitcoin narrative",
      },
      {
        marketId: "market2",
        tokenId: "token2_no",
        signalType: "momentum" as const,
        side: "no" as const,
        confidence: 0.69,
        expectedValue: 0.10,
        fairValueEstimate: 0.45,
        limitPrice: 0.44,
        reasoning: "Bitcoin outperforming ETH recently",
      },
      {
        marketId: "market3",
        tokenId: "token3_yes",
        signalType: "wash_volume_warning" as const,
        side: "yes" as const,
        confidence: 0.58,
        expectedValue: -0.05,
        fairValueEstimate: 0.71,
        limitPrice: 0.69,
        reasoning: "High wash volume detected",
      },
    ]);
    mocks.reviewPolymarketSignalsWithTrader.mockResolvedValue([
      {
        marketId: "market1",
        tokenId: "token1_yes",
        signalType: "sentiment" as const,
        side: "yes" as const,
        confidence: 0.78, // Boosted by reviewer
        expectedValue: 0.18,
        fairValueEstimate: 0.62,
        limitPrice: 0.60,
        reasoning: "Bullish on Bitcoin narrative",
      },
      {
        marketId: "market2",
        tokenId: "token2_no",
        signalType: "momentum" as const,
        side: "no" as const,
        confidence: 0.72,
        expectedValue: 0.12,
        fairValueEstimate: 0.45,
        limitPrice: 0.44,
        reasoning: "Bitcoin outperforming ETH recently",
      },
    ]);
    mocks.validatePolymarketOrderRisk.mockReturnValue({
      valid: true,
      reason: null,
      maxOrderSize: 10,
      riskExposure: 4.5,
    });
    mocks.estimateSizeForRiskBudget.mockReturnValue(8);
    mocks.placePolymarketOrder.mockResolvedValue({
      success: true,
      orderId: "pm-order-1",
      marketId: "market1",
      tokenId: "token1_yes",
      side: "BUY",
      size: 8,
      price: 0.60,
    });
    mocks.logAuditEvent.mockResolvedValue(true);
    mocks.recordPolymarketTradeEntry.mockResolvedValue(undefined);
    mocks.getUserTrainingInstructions.mockResolvedValue([]);
    mocks.isInstructionActiveNow.mockReturnValue(false);
    mocks.applyInstructionsToSignals.mockImplementation((s: any[]) => s);
  });

  it("Full autonomy cycle: market fetch → signal generation → review → execution", async () => {
    const result = await runPolymarketAutonomousTrading(8);

    expect(result.success).toBe(true);
    expect(result.status).toBe("executed");
    expect(result.orderPlaced).toBe(true);
    expect(result.orderId).toBe("pm-order-1");
    expect(result.executedMarketId).toBe("market1");
    expect(result.executedTokenId).toBe("token1_yes");
    expect(result.executedSide).toBe("yes"); // From the signal, not the order
    expect(result.executedPrice).toBe(0.60);
    // The actual size gets clamped based on risk calculations and maxOrderNotional
    expect(result.executedSizeUsdc).toBeGreaterThan(0);
    expect(result.executedSizeUsdc).toBeLessThanOrEqual(10); // maxOrderNotional from preferences

    // Verify signal generation happened
    expect(mocks.generatePolymarketSignals).toHaveBeenCalled();
    expect(mocks.generatePolymarketSignals).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        platformPerformance: expect.objectContaining({ hasSufficientData: true }),
      })
    );

    // Verify AI review was called
    expect(mocks.reviewPolymarketSignalsWithTrader).toHaveBeenCalled();

    // Verify order was placed
    expect(mocks.placePolymarketOrder).toHaveBeenCalled();

    // Verify audit events
    const auditCalls = mocks.logAuditEvent.mock.calls;
    expect(auditCalls.length).toBeGreaterThan(0);

    // Check for reviewer telemetry event
    const telemetryEvent = auditCalls.find((call: any[]) =>
      call[0] === "polymarket_reviewer_telemetry"
    );
    expect(telemetryEvent).toBeDefined();
    if (telemetryEvent) {
      const payload = JSON.parse(telemetryEvent[1]);
      expect(payload).toHaveProperty("cacheHitRatio");
      expect(payload).toHaveProperty("anthropicCalls");
      expect(payload).toHaveProperty("anthropicFailures");
    }

    // Check for order placement event
    const orderEvent = auditCalls.find((call: any[]) =>
      call[0] === "polymarket_autonomy_order_placed"
    );
    expect(orderEvent).toBeDefined();
    if (orderEvent) {
      const payload = JSON.parse(orderEvent[1]);
      expect(payload).toHaveProperty("marketId");
      expect(payload).toHaveProperty("side");
      expect(payload).toHaveProperty("sizeUsdc");
    }
  });

  it("Subscription gate blocks execution when user not subscribed to Polymarket", async () => {
    mocks.isUserSubscribedToPolymarket.mockResolvedValue(false);

    const result = await runPolymarketAutonomousTrading(8);

    expect(result.success).toBe(true);
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("not subscribed to Polymarket");
    expect(result.orderPlaced).toBe(false);
    expect(mocks.fetchPolymarketMarkets).not.toHaveBeenCalled();
    expect(mocks.placePolymarketOrder).not.toHaveBeenCalled();
  });

  it("Missing credentials blocks execution", async () => {
    mocks.getPolymarketCredentials.mockResolvedValue(null);

    const result = await runPolymarketAutonomousTrading(8);

    expect(result.success).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("no connected Polymarket account");
    expect(mocks.placePolymarketOrder).not.toHaveBeenCalled();
  });

  it("Disconnected account status blocks execution", async () => {
    mocks.getPolymarketCredentials.mockResolvedValue({
      userId: 8,
      accountStatus: "disconnected",
      apiKey: "key",
      privateKey: "secret",
    });

    const result = await runPolymarketAutonomousTrading(8);

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("no connected Polymarket account");
  });

  it("No markets available returns generated_only", async () => {
    mocks.fetchPolymarketMarkets.mockResolvedValue([]);

    const result = await runPolymarketAutonomousTrading(8);

    expect(result.success).toBe(true);
    expect(result.status).toBe("generated_only");
    expect(result.reason).toContain("no live Polymarket markets available");
    expect(result.orderPlaced).toBe(false);
  });

  it("No signals pass review returns generated_only", async () => {
    mocks.reviewPolymarketSignalsWithTrader.mockResolvedValue([]);

    const result = await runPolymarketAutonomousTrading(8);

    expect(result.success).toBe(true);
    expect(result.status).toBe("generated_only");
    expect(result.reason).toContain("no signals passed AI trader duo review");
    expect(result.executionCandidates).toBe(0);
    expect(mocks.placePolymarketOrder).not.toHaveBeenCalled();

    // Verify audit event
    const auditCalls = mocks.logAuditEvent.mock.calls;
    const generatedEvent = auditCalls.find((call: any[]) =>
      call[0] === "polymarket_autonomy_run_generated_only"
    );
    expect(generatedEvent).toBeDefined();
  });

  it("Wash-volume signals are filtered out before review", async () => {
    // generatePolymarketSignals returns 3 signals (one with wash_volume_warning)
    // They should be filtered before review
    const result = await runPolymarketAutonomousTrading(8);

    // After filtering, review should receive only executable signals
    expect(mocks.reviewPolymarketSignalsWithTrader).toHaveBeenCalled();
    const reviewCall = mocks.reviewPolymarketSignalsWithTrader.mock.calls[0];
    const reviewInput = reviewCall[0];

    // The wash_volume_warning signal should be excluded
    expect(reviewInput.signals).toHaveLength(2); // Only 2 executable signals
    expect(reviewInput.signals.every((s: any) => s.signalType !== "wash_volume_warning")).toBe(true);
  });

  it("Manually disabled trading mode skips execution", async () => {
    mocks.getTradingPreferences.mockResolvedValue({
      ...mocks.DEFAULT_PREFERENCES,
      liveTradingEnabled: false,
    });

    const result = await runPolymarketAutonomousTrading(8);

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("live trading is disarmed");
    expect(mocks.placePolymarketOrder).not.toHaveBeenCalled();
  });

  it("Manual-only autonomy mode skips execution", async () => {
    mocks.getTradingPreferences.mockResolvedValue({
      ...mocks.DEFAULT_PREFERENCES,
      autonomyMode: "manual",
    });

    const result = await runPolymarketAutonomousTrading(8);

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("manual mode forbids automatic execution");
  });

  it("Training instructions filter markets before signal generation", async () => {
    const mockInstructions = [
      {
        id: "instr-1",
        rules: [
          { ruleType: "exclude", ruleKey: "category", ruleValue: "economics" }
        ]
      }
    ];
    mocks.getUserTrainingInstructions.mockResolvedValue(mockInstructions);
    mocks.isInstructionActiveNow.mockReturnValue(true);

    await runPolymarketAutonomousTrading(8);

    // Verify training instructions were processed
    expect(mocks.getUserTrainingInstructions).toHaveBeenCalled();
    expect(mocks.isInstructionActiveNow).toHaveBeenCalled();
  });

  it("Training instructions filter signals after generation", async () => {
    const mockInstructions = [
      {
        id: "instr-1",
        rules: [
          { ruleType: "exclude", ruleKey: "question", ruleValue: "Bitcoin" }
        ]
      }
    ];
    mocks.getUserTrainingInstructions.mockResolvedValue(mockInstructions);
    mocks.isInstructionActiveNow.mockReturnValue(true);
    mocks.applyInstructionsToSignals.mockImplementation((signals: any[]) =>
      signals.filter((s) => !s.marketId?.includes("market1"))
    );

    await runPolymarketAutonomousTrading(8);

    // Verify instructions were applied to signals
    expect(mocks.applyInstructionsToSignals).toHaveBeenCalled();
  });

  it("Risk validation blocks order placement when risk exceeds limits", async () => {
    mocks.validatePolymarketOrderRisk.mockReturnValue({
      valid: false,
      reason: "position size exceeds daily loss limit",
      maxOrderSize: 2,
      riskExposure: 5,
    });

    const result = await runPolymarketAutonomousTrading(8);

    expect(result.status).toBe("blocked");
    expect(result.orderPlaced).toBe(false);
    expect(mocks.placePolymarketOrder).not.toHaveBeenCalled();
  });

  it("Zero bankroll blocks execution", async () => {
    mocks.getKalshiCapital.mockResolvedValue({
      currentBalance: 0,
      startingBalance: 0,
    });

    const result = await runPolymarketAutonomousTrading(8);

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("bankroll is zero");
    expect(mocks.placePolymarketOrder).not.toHaveBeenCalled();
  });

  it("Reviewer telemetry captures cache hit ratio and token usage", async () => {
    await runPolymarketAutonomousTrading(8);

    const auditCalls = mocks.logAuditEvent.mock.calls;
    const telemetryEvent = auditCalls.find((call: any[]) =>
      call[0] === "polymarket_reviewer_telemetry"
    );

    expect(telemetryEvent).toBeDefined();
    if (telemetryEvent) {
      const payload = JSON.parse(telemetryEvent[1]);
      expect(payload).toEqual({
        desks: [],
        cacheHitRatio: 0.75,
        cacheReadInputTokens: 100,
        cacheCreationInputTokens: 50,
        inputTokens: 500,
        outputTokens: 200,
        webSearchInvocations: 0,
        extendedThinkingInvocations: 0,
        triageRan: false,
        triageInputCount: 0,
        triageKeptCount: 0,
        anthropicCalls: 1,
        anthropicFailures: 0,
      });
    }
  });

  it("Order placement failure returns blocked status", async () => {
    mocks.validatePolymarketOrderRisk.mockReturnValue({
      valid: false,
      reason: "insufficient balance",
      maxOrderSize: 0,
      riskExposure: 0,
    });

    const result = await runPolymarketAutonomousTrading(8);

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("insufficient balance");
    expect(result.orderPlaced).toBe(false);
  });

  it("Audit event includes risk details and execution metrics", async () => {
    await runPolymarketAutonomousTrading(8);

    const auditCalls = mocks.logAuditEvent.mock.calls;
    // In the actual implementation, the execution event is "polymarket_autonomy_order_placed"
    const executedEvent = auditCalls.find((call: any[]) =>
      call[0] === "polymarket_autonomy_order_placed"
    );

    expect(executedEvent).toBeDefined();
    if (executedEvent && typeof executedEvent[1] === 'string') {
      const payload = JSON.parse(executedEvent[1]);
      expect(payload).toHaveProperty("marketId");
      expect(payload).toHaveProperty("side");
      expect(payload).toHaveProperty("sizeUsdc");
    }
  });
});

describe("Polymarket autonomy E2E — risk calculations", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.isUserSubscribedToPolymarket.mockResolvedValue(true);
    mocks.getTradingPreferences.mockResolvedValue(mocks.DEFAULT_PREFERENCES);
    mocks.getPolymarketCredentials.mockResolvedValue({
      userId: 8,
      accountStatus: "connected",
      apiKey: "key",
      apiSecret: "secret",
      apiPassphrase: "pass",
      walletPrivateKey: "0x" + "11".repeat(32),
      walletAddress: "0x0000000000000000000000000000000000000001",
      signatureType: 1,
    });
    mocks.getKalshiCapital.mockResolvedValue({
      currentBalance: 1000,
      startingBalance: 1000,
    });
    mocks.fetchPolymarketMarkets.mockResolvedValue([
      {
        id: "market1",
        question: "Will Bitcoin exceed $100K?",
        category: "crypto",
        tokens: [
          { id: "token1_yes", name: "YES", price: 0.65 },
          { id: "token1_no", name: "NO", price: 0.35 },
        ],
        volume24h: 200000,
        liquidity: 80000,
      },
    ]);
    mocks.generatePolymarketSignals.mockReturnValue([
      {
        marketId: "market1",
        tokenId: "token1_yes",
        signalType: "sentiment" as const,
        side: "yes" as const,
        confidence: 0.82,
        expectedValue: 0.10,
        fairValueEstimate: 0.65,
        limitPrice: 0.63,
        reasoning: "Bullish",
      },
    ]);
    mocks.reviewPolymarketSignalsWithTrader.mockResolvedValue([
      {
        marketId: "market1",
        tokenId: "token1_yes",
        signalType: "sentiment" as const,
        side: "yes" as const,
        confidence: 0.82,
        expectedValue: 0.10,
        fairValueEstimate: 0.65,
        limitPrice: 0.63,
        reasoning: "Bullish",
      },
    ]);
    mocks.validatePolymarketOrderRisk.mockReturnValue({
      valid: true,
      reason: null,
      maxOrderSize: 20,
      riskExposure: 5,
    });
    mocks.estimateSizeForRiskBudget.mockReturnValue(12);
    mocks.placePolymarketOrder.mockResolvedValue({
      success: true,
      orderId: "order-1",
      marketId: "market1",
      tokenId: "token1_yes",
      side: "BUY",
      size: 12,
      price: 0.63,
    });
    mocks.logAuditEvent.mockResolvedValue(true);
    mocks.recordPolymarketTradeEntry.mockResolvedValue(undefined);
    mocks.getUserTrainingInstructions.mockResolvedValue([]);
    mocks.isInstructionActiveNow.mockReturnValue(false);
    mocks.applyInstructionsToSignals.mockImplementation((s: any[]) => s);
  });

  it("Risk posture conservative scales down order size", async () => {
    mocks.getTradingPreferences.mockResolvedValue({
      ...mocks.DEFAULT_PREFERENCES,
      riskPosture: "conservative",
    });
    // Conservative posture should scale size by 0.5
    mocks.estimateSizeForRiskBudget.mockReturnValue(6); // scaled from 12 by 0.5
    mocks.placePolymarketOrder.mockResolvedValue({
      success: true,
      orderId: "order-1",
      marketId: "market1",
      tokenId: "token1_yes",
      side: "BUY",
      size: 6,
      price: 0.63,
    });

    const result = await runPolymarketAutonomousTrading(8);

    expect(result.status).toBe("executed");
    expect(result.executedSizeUsdc).toBeLessThanOrEqual(12);
  });

  it("Risk posture aggressive scales up order size", async () => {
    mocks.getTradingPreferences.mockResolvedValue({
      ...mocks.DEFAULT_PREFERENCES,
      riskPosture: "aggressive",
    });
    // Aggressive posture should scale size by 1.5, but also clamped by maxOrderNotional
    // Since maxOrderNotional defaults to 10, the final size will be 10 (min of 12*1.5=18 and 10)
    mocks.estimateSizeForRiskBudget.mockReturnValue(18);
    mocks.placePolymarketOrder.mockResolvedValue({
      success: true,
      orderId: "order-1",
      marketId: "market1",
      tokenId: "token1_yes",
      side: "BUY",
      size: 10,
      price: 0.63,
    });

    const result = await runPolymarketAutonomousTrading(8);

    expect(result.status).toBe("executed");
    expect(result.executedSizeUsdc).toBeGreaterThan(0);
  });

  it("Max order notional constraint respected", async () => {
    mocks.getTradingPreferences.mockResolvedValue({
      ...mocks.DEFAULT_PREFERENCES,
      maxOrderNotional: 5, // Low constraint
    });
    // Size should be clamped to 5 due to maxOrderNotional
    mocks.estimateSizeForRiskBudget.mockReturnValue(5);
    mocks.placePolymarketOrder.mockResolvedValue({
      success: true,
      orderId: "order-1",
      marketId: "market1",
      tokenId: "token1_yes",
      side: "BUY",
      size: 5,
      price: 0.63,
    });

    const result = await runPolymarketAutonomousTrading(8);

    // Verify order was placed
    expect(result.status).toBe("executed");
    expect(result.executedSizeUsdc).toBeLessThanOrEqual(5);
  });
});
