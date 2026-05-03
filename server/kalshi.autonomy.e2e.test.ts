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
  getKalshiCredentials: vi.fn(),
  updateKalshiAccountEquity: vi.fn(),
  fetchKalshiAccountEquity: vi.fn(),
  fetchKalshiMarkets: vi.fn(),
  getMarketFeed: vi.fn(),
  generateSignalsForMarkets: vi.fn(),
  filterSignalsByConfidence: vi.fn(),
  filterSignalsByMarketConditions: vi.fn(),
  getTopSignalsForExecution: vi.fn(),
  saveSignals: vi.fn(),
  reviewSignalsWithTrader: vi.fn(),
  getLatestAuditEventByType: vi.fn(),
  getLatestAutonomyRun: vi.fn(),
  getTodayKalshiOrderCount: vi.fn(),
  getKalshiCapital: vi.fn(),
  syncKalshiCapitalWithLiveEquity: vi.fn(),
  getOpenKalshiPositions: vi.fn(),
  getTodayRealizedLoss: vi.fn(),
  getPendingKalshiOrders: vi.fn(),
  logAuditEvent: vi.fn(),
  createAutonomyRun: vi.fn(),
  updateAutonomyRun: vi.fn(),
  placeKalshiOrder: vi.fn(),
  syncPendingOrders: vi.fn(),
  fetchKalshiMarketDetails: vi.fn(),
  isMarketDataStale: vi.fn(),
  getDeskMemory: vi.fn(),
  recordDeskMemoryOutcome: vi.fn(),
  getUserTrainingInstructions: vi.fn(),
  isInstructionActiveNow: vi.fn(),
  applyInstructionsToSignals: vi.fn(),
}));

vi.mock("./db.trading-preferences", () => ({
  DEFAULT_TRADING_PREFERENCES: mocks.DEFAULT_PREFERENCES,
  getTradingPreferences: mocks.getTradingPreferences,
}));

vi.mock("./db.kalshi-credentials", () => ({
  getKalshiCredentials: mocks.getKalshiCredentials,
  updateKalshiAccountEquity: mocks.updateKalshiAccountEquity,
}));

vi.mock("./db", () => ({
  getLatestAuditEventByType: mocks.getLatestAuditEventByType,
  getLatestAutonomyRun: mocks.getLatestAutonomyRun,
  getTodayKalshiOrderCount: mocks.getTodayKalshiOrderCount,
  getKalshiCapital: mocks.getKalshiCapital,
  syncKalshiCapitalWithLiveEquity: mocks.syncKalshiCapitalWithLiveEquity,
  getOpenKalshiPositions: mocks.getOpenKalshiPositions,
  getTodayRealizedLoss: mocks.getTodayRealizedLoss,
  getPendingKalshiOrders: mocks.getPendingKalshiOrders,
  logAuditEvent: mocks.logAuditEvent,
  createAutonomyRun: mocks.createAutonomyRun,
  updateAutonomyRun: mocks.updateAutonomyRun,
}));

vi.mock("./db.desk-memory", () => ({
  getDeskMemory: mocks.getDeskMemory,
  recordDeskMemoryOutcome: mocks.recordDeskMemoryOutcome,
}));

vi.mock("./_core/kalshiAuth", () => ({
  fetchKalshiAccountEquity: mocks.fetchKalshiAccountEquity,
}));

vi.mock("./_core/kalshiMarketData", () => ({
  fetchKalshiMarkets: mocks.fetchKalshiMarkets,
  fetchKalshiMarketDetails: mocks.fetchKalshiMarketDetails,
}));

vi.mock("./_core/kalshiMarketFeed", () => ({
  getMarketFeed: mocks.getMarketFeed,
  isMarketDataStale: mocks.isMarketDataStale,
}));

vi.mock("./_core/kalshiSignals", () => ({
  generateSignalsForMarkets: mocks.generateSignalsForMarkets,
  filterSignalsByConfidence: mocks.filterSignalsByConfidence,
  filterSignalsByMarketConditions: mocks.filterSignalsByMarketConditions,
  getTopSignalsForExecution: mocks.getTopSignalsForExecution,
  saveSignals: mocks.saveSignals,
}));

vi.mock("./_core/tradingReviewer", () => ({
  reviewSignalsWithTrader: mocks.reviewSignalsWithTrader,
}));

vi.mock("./_core/kalshiExecution", () => ({
  placeKalshiOrder: mocks.placeKalshiOrder,
}));

vi.mock("./_core/kalshiOrderSync", () => ({
  syncPendingOrders: mocks.syncPendingOrders,
  syncLivePositions: vi.fn(),
}));

vi.mock("./db.training", () => ({
  getUserTrainingInstructions: mocks.getUserTrainingInstructions,
  isInstructionActiveNow: mocks.isInstructionActiveNow,
  applyInstructionsToSignals: mocks.applyInstructionsToSignals,
}));

import { runScheduledAutonomousTrading } from "./_core/kalshiAutonomy";

const testUser = {
  id: 7,
  openId: "e2e-user-id",
  email: "e2e@example.com",
  name: "E2E Test User",
  role: "user" as const,
  betaAccessLevel: "none" as const,
  twoFactorSecret: null,
  twoFactorEnabled: 0,
  backupCodesHash: null,
  createdAt: new Date(),
  lastSignedIn: new Date(),
};

describe("Kalshi autonomy E2E — full cycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default setup for all happy-path tests
    mocks.getTradingPreferences.mockResolvedValue(mocks.DEFAULT_PREFERENCES);
    mocks.getKalshiCredentials.mockResolvedValue({
      userId: 7,
      accountStatus: "connected",
      apiKey: "live-key",
      privateKey: "live-pk",
    });
    mocks.fetchKalshiAccountEquity.mockResolvedValue({ equity: 1000, error: null });
    mocks.fetchKalshiMarkets.mockResolvedValue([
      {
        id: "KXUSD-250531",
        title: "Will USD drop below 1.00 by May 31?",
        category: "economics",
        yesPrice: 0.38,
        noPrice: 0.62,
        yesVolume: 5000,
        noVolume:5000,
        impliedProbability: 0.62,
        resolutionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "KXTECH-250531",
        title: "Will NVIDIA stock rally >10% by month end?",
        category: "technology",
        yesPrice: 0.51,
        noPrice: 0.49,
        yesVolume: 3500,
        noVolume: 3500,
        impliedProbability: 0.49,
        resolutionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "KXPOL-250531",
        title: "Will the Senate pass the new bill?",
        category: "politics",
        yesPrice: 0.67,
        noPrice: 0.33,
        yesVolume: 2500,
        noVolume: 2500,
        impliedProbability: 0.33,
        resolutionDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);
    mocks.getMarketFeed.mockReturnValue(null);
    mocks.isMarketDataStale.mockReturnValue(false);
    mocks.generateSignalsForMarkets.mockResolvedValue([
      {
        marketId: "KXUSD-250531",
        signalType: "sentiment" as const,
        side: "yes" as const,
        confidence: 0.78,
        reasoning: "Sentiment shift toward lower USD",
        impliedProbability: 0.62,
        marketPrice: 0.38,
        expectedValue: 0.24,
        executionScore: 0.82,
      },
      {
        marketId: "KXTECH-250531",
        signalType: "momentum" as const,
        side: "yes" as const,
        confidence: 0.73,
        reasoning: "Technical momentum bullish",
        impliedProbability: 0.49,
        marketPrice: 0.51,
        expectedValue: -0.02,
        executionScore: 0.71,
      },
      {
        marketId: "KXPOL-250531",
        signalType: "value" as const,
        side: "no" as const,
        confidence: 0.68,
        reasoning: "Market overpriced passage odds",
        impliedProbability: 0.33,
        marketPrice: 0.67,
        expectedValue: -0.34,
        executionScore: 0.55, // Below execution threshold
      },
    ]);
    mocks.filterSignalsByConfidence.mockImplementation((signals: any[]) =>
      signals.filter((s) => s.confidence >= 0.65)
    );
    mocks.filterSignalsByMarketConditions.mockImplementation((signals: any[]) =>
      signals // Pass through all for this test
    );
    mocks.getTopSignalsForExecution.mockReturnValue([
      {
        marketId: "KXUSD-250531",
        signalType: "sentiment" as const,
        side: "yes" as const,
        confidence: 0.78,
        reasoning: "Sentiment shift toward lower USD",
        impliedProbability: 0.62,
        marketPrice: 0.38,
        expectedValue: 0.24,
        executionScore: 0.82,
      },
      {
        marketId: "KXTECH-250531",
        signalType: "momentum" as const,
        side: "yes" as const,
        confidence: 0.73,
        reasoning: "Technical momentum bullish",
        impliedProbability: 0.49,
        marketPrice: 0.51,
        expectedValue: -0.02,
        executionScore: 0.71,
      },
    ]);
    mocks.reviewSignalsWithTrader.mockImplementation(
      async ({ signals }: { signals: any[] }) => {
        // Claude reviewer approves top 1-2 signals with adjustments
        return signals.slice(0, 2).map((s) => ({
          ...s,
          confidence: Math.min(1, s.confidence + 0.05), // Modest confidence boost
          expectedValue: s.expectedValue + 0.02,
        }));
      }
    );
    mocks.saveSignals.mockResolvedValue(undefined);
    mocks.getLatestAuditEventByType.mockResolvedValue(null);
    mocks.getLatestAutonomyRun.mockResolvedValue(null);
    mocks.getTodayKalshiOrderCount.mockResolvedValue(0);
    mocks.getKalshiCapital.mockResolvedValue({
      currentBalance: 1000,
      startingBalance: 1000,
    });
    mocks.syncKalshiCapitalWithLiveEquity.mockResolvedValue(undefined);
    mocks.getOpenKalshiPositions.mockResolvedValue([]);
    mocks.getTodayRealizedLoss.mockResolvedValue(0);
    mocks.getPendingKalshiOrders.mockResolvedValue([]);
    mocks.syncPendingOrders.mockResolvedValue(undefined);
    mocks.fetchKalshiMarketDetails.mockResolvedValue(null);
    mocks.logAuditEvent.mockResolvedValue(true);
    mocks.createAutonomyRun.mockResolvedValue({ runId: "e2e-run-123" });
    mocks.updateAutonomyRun.mockResolvedValue({ runId: "e2e-run-123" });
    mocks.placeKalshiOrder.mockResolvedValue({ success: true, orderId: "e2e-order-1" });
    mocks.getDeskMemory.mockResolvedValue(null);
    mocks.recordDeskMemoryOutcome.mockResolvedValue(undefined);
    mocks.getUserTrainingInstructions.mockResolvedValue([]);
    mocks.isInstructionActiveNow.mockReturnValue(false);
    mocks.applyInstructionsToSignals.mockImplementation((signals: any[]) => signals);
  });

  it("Full autonomy cycle: signal generation → risk eval → AI review → execution", async () => {
    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.success).toBe(true);
    expect(result.status).toBe("executed");
    expect(result.orderPlaced).toBe(true);
    expect(result.orderId).toBe("e2e-order-1");
    expect(result.executedMarketId).toBe("KXUSD-250531");

    // Verify decision details
    expect(result.decision).toMatchObject({
      marketId: "KXUSD-250531",
      side: "yes",
      confidence: expect.any(Number),
      limitPrice: 0.38,
      availableCapital: 1000,
    });
    expect(result.decision?.quantity).toBeGreaterThan(0);
    expect(result.decision?.orderExposure).toBeGreaterThan(0);
    expect(result.decision?.maxLossOnTrade).toBeGreaterThan(0);

    // Verify order placement was called with correct parameters
    expect(mocks.placeKalshiOrder).toHaveBeenCalledWith(
      7,
      "KXUSD-250531",
      "yes",
      expect.any(Number),
      0.38
    );

    // Verify audit events
    const auditCalls = mocks.logAuditEvent.mock.calls;
    expect(auditCalls.length).toBeGreaterThan(0);

    // Check for kalshi_signal_pipeline event
    const pipelineEvent = auditCalls.find((call: any[]) => call[0] === "kalshi_signal_pipeline");
    expect(pipelineEvent).toBeDefined();
    if (pipelineEvent) {
      const payload = JSON.parse(pipelineEvent[1]);
      expect(payload).toHaveProperty("signalsGenerated");
      expect(payload).toHaveProperty("afterConfidenceFilter");
      expect(payload.signalsGenerated).toBe(3);
    }

    // Check for scheduled_autonomy_run_executed event
    const executedEvent = auditCalls.find((call: any[]) =>
      call[0] === "scheduled_autonomy_run_executed"
    );
    expect(executedEvent).toBeDefined();

    // Check for scheduled_autonomy_order_placed event
    const orderEvent = auditCalls.find((call: any[]) =>
      call[0] === "scheduled_autonomy_order_placed"
    );
    expect(orderEvent).toBeDefined();
  });

  it("Risk block prevents execution when position cap exceeded", async () => {
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { marketId: "OTHER-1" },
      { marketId: "OTHER-2" },
      { marketId: "OTHER-3" },
      { marketId: "OTHER-4" },
      { marketId: "OTHER-5" }, // maxOpenPositions = 5
    ]);

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("open position limit");
    expect(result.orderPlaced).toBe(false);
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();

    // Note: The implementation doesn't log an audit event for early risk blocks
    // (daily order cap, open position limit, daily loss limit). These are returned
    // before reaching the order placement stage where scheduled_autonomy_order_blocked_or_failed
    // is logged. The reason is captured in result.reason instead.
  });

  it("Insufficient capital prevents execution of candidates", async () => {
    // When maxBudget < marketPrice for all candidates, they all fail
    // evaluateExecutionCandidate at line 643: maxBudget < marketPrice
    // With capital = 0.1 and market prices = 0.38-0.67, no candidates are eligible
    // Result: "generated_only" status with reason from first rejected candidate
    mocks.getKalshiCapital.mockResolvedValue({
      currentBalance: 0.1, // Too low to support any candidates
      startingBalance: 0.1,
    });

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("generated_only");
    expect(result.reason).toContain("current budget cannot fund even one contract");
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
  });

  it("Risk block prevents execution when daily loss limit reached", async () => {
    mocks.getTodayRealizedLoss.mockResolvedValue(10); // Max loss for $1000 balance is ~$10

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("daily loss limit");
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
  });

  it("Audit events capture signal pipeline metrics correctly", async () => {
    await runScheduledAutonomousTrading(testUser);

    const auditCalls = mocks.logAuditEvent.mock.calls;
    const pipelineEvent = auditCalls.find((call: any[]) =>
      call[0] === "kalshi_signal_pipeline"
    );

    expect(pipelineEvent).toBeDefined();
    const payload = JSON.parse(pipelineEvent![1]);
    // Verify the actual payload structure from the implementation
    expect(payload).toMatchObject({
      marketsDiscovered: 3,
      signalsGenerated: 3,
      afterConfidenceFilter: expect.any(Number),
      afterConditionFilter: expect.any(Number),
      afterInstructionFilter: expect.any(Number),
      afterReviewerFilter: expect.any(Number),
      activeInstructionCount: expect.any(Number),
      minConfidence: expect.any(Number),
    });
    expect(pipelineEvent![2]).toBe("user:7");
  });

  it("No signals approved by reviewer → generated_only status", async () => {
    mocks.reviewSignalsWithTrader.mockResolvedValue([]);
    mocks.getTopSignalsForExecution.mockReturnValue([]);

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("generated_only");
    expect(result.reason).toContain("no non-heuristic execution-ready signals");
    expect(result.executionCandidates).toBe(0);
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();

    // Verify signals were still saved even though not executed
    expect(mocks.saveSignals).toHaveBeenCalled();
  });

  it("Approval-required mode blocks execution even with approved signal", async () => {
    mocks.getTradingPreferences.mockResolvedValue({
      ...mocks.DEFAULT_PREFERENCES,
      autonomyMode: "approval_required",
    });

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("generated_only");
    expect(result.reason).toContain("approval-required mode");
    expect(result.executionCandidates).toBeGreaterThan(0);
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();

    // But decision should still be captured
    expect(result.decision).toBeDefined();
    expect(result.decision?.blockedBy).toBe("approval_required_mode");
  });

  it("Markets with insufficient liquidity are filtered out", async () => {
    mocks.filterSignalsByMarketConditions.mockImplementation((signals: any[]) =>
      signals.filter((s) => s.marketId !== "KXPOL-250531")
    );

    const result = await runScheduledAutonomousTrading(testUser);

    const auditCalls = mocks.logAuditEvent.mock.calls;
    const pipelineEvent = auditCalls.find((call: any[]) =>
      call[0] === "kalshi_signal_pipeline"
    );

    if (pipelineEvent) {
      const payload = JSON.parse(pipelineEvent[1]);
      expect(payload.afterInstructionFilter).toBeLessThan(payload.signalsGenerated);
    }
  });

  it("Training instructions filter signals before review", async () => {
    const mockInstructions = [
      { id: "instr-1", marketFilter: "politics" }
    ];
    mocks.getUserTrainingInstructions.mockResolvedValue(mockInstructions);
    mocks.isInstructionActiveNow.mockReturnValue(true);
    mocks.applyInstructionsToSignals.mockImplementation((signals: any[]) =>
      signals.filter((s) => s.marketId !== "KXPOL-250531") // Filter out politics
    );

    const result = await runScheduledAutonomousTrading(testUser);

    // Training instructions should have been applied
    expect(mocks.applyInstructionsToSignals).toHaveBeenCalled();
  });

  it("Order placement with reconciliation-pending flag updates autonomy run", async () => {
    mocks.placeKalshiOrder.mockResolvedValue({
      success: true,
      orderId: "order-1",
      needsReconciliation: true,
      reconciliationReason: "local order ledger write failed",
    });

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("executed");
    expect(result.reconciliationStatus).toBe("pending");

    // Verify the reconciliation status is captured in the result
    // The runId is generated internally and passed to updateAutonomyRun
    expect(mocks.updateAutonomyRun).toHaveBeenCalledWith(
      expect.any(String), // runId is dynamically generated
      7,
      expect.objectContaining({
        reconciliationStatus: "pending",
      })
    );
  });

  it("AI reviewer call failure returns error status", async () => {
    mocks.reviewSignalsWithTrader.mockImplementation(
      async (_input: { signals: any[] }, opts?: { userId?: number; telemetry?: any }) => {
        if (opts?.telemetry) {
          opts.telemetry.anthropicFailures = 1;
          opts.telemetry.anthropicCalls = 1;
        }
        return [];
      }
    );
    mocks.getTopSignalsForExecution.mockReturnValue([]);

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/ai reviewer encountered/i);

    // Verify failure audit event
    const auditCalls = mocks.logAuditEvent.mock.calls;
    const failureEvent = auditCalls.find((call: any[]) =>
      call[0] === "scheduled_autonomy_ai_reviewer_failure"
    );
    expect(failureEvent).toBeDefined();
  });

  it("Exchange rejection (e.g., insufficient funds) blocks order", async () => {
    mocks.placeKalshiOrder.mockResolvedValue({
      success: false,
      error: "INSUFFICIENT_FUNDS",
    });

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("INSUFFICIENT_FUNDS");
    expect(result.orderPlaced).toBe(false);

    // Verify failure audit event
    const auditCalls = mocks.logAuditEvent.mock.calls;
    const blockEvent = auditCalls.find((call: any[]) =>
      call[0] === "scheduled_autonomy_order_blocked_or_failed"
    );
    expect(blockEvent).toBeDefined();
    if (blockEvent) {
      const payload = JSON.parse(blockEvent[1]);
      expect(payload.reason).toBe("INSUFFICIENT_FUNDS");
    }
  });

  it("Missing credentials blocks execution", async () => {
    mocks.getKalshiCredentials.mockResolvedValue(null);

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("no connected live Kalshi account");
    expect(mocks.fetchKalshiAccountEquity).not.toHaveBeenCalled();
  });

  it("Live equity sync failure returns error status", async () => {
    mocks.fetchKalshiAccountEquity.mockResolvedValue({
      equity: 0,
      error: "connection timeout",
    });

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("error");
    expect(result.reason).toContain("live equity refresh failed");
  });
});

describe("Kalshi autonomy E2E — desk memory accumulation", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getTradingPreferences.mockResolvedValue(mocks.DEFAULT_PREFERENCES);
    mocks.getKalshiCredentials.mockResolvedValue({
      userId: 7,
      accountStatus: "connected",
      apiKey: "key",
      privateKey: "pk",
    });
    mocks.fetchKalshiAccountEquity.mockResolvedValue({ equity: 1000, error: null });
    mocks.fetchKalshiMarkets.mockResolvedValue([
      {
        id: "M1",
        title: "Market 1",
        category: "sports",
        yesPrice: 0.5,
        noPrice: 0.5,
        yesVolume: 2000,
        noVolume: 2000,
        impliedProbability: 0.5,
        resolutionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);
    mocks.getMarketFeed.mockReturnValue(null);
    mocks.isMarketDataStale.mockReturnValue(false);
    mocks.generateSignalsForMarkets.mockResolvedValue([
      {
        marketId: "M1",
        signalType: "momentum" as const,
        side: "yes" as const,
        confidence: 0.75,
        reasoning: "Strong momentum",
        impliedProbability: 0.5,
        marketPrice: 0.5,
        expectedValue: 0.0,
        executionScore: 0.75,
      },
    ]);
    mocks.filterSignalsByConfidence.mockImplementation((s: any[]) => s);
    mocks.filterSignalsByMarketConditions.mockImplementation((s: any[]) => s);
    mocks.getTopSignalsForExecution.mockReturnValue([
      {
        marketId: "M1",
        signalType: "momentum" as const,
        side: "yes" as const,
        confidence: 0.75,
        reasoning: "Strong momentum",
        impliedProbability: 0.5,
        marketPrice: 0.5,
        expectedValue: 0.0,
        executionScore: 0.75,
      },
    ]);
    mocks.reviewSignalsWithTrader.mockResolvedValue([
      {
        marketId: "M1",
        signalType: "momentum" as const,
        side: "yes" as const,
        confidence: 0.75,
        reasoning: "Strong momentum",
        impliedProbability: 0.5,
        marketPrice: 0.5,
        expectedValue: 0.0,
        executionScore: 0.75,
      },
    ]);
    mocks.saveSignals.mockResolvedValue(undefined);
    mocks.getLatestAuditEventByType.mockResolvedValue(null);
    mocks.getLatestAutonomyRun.mockResolvedValue(null);
    mocks.getTodayKalshiOrderCount.mockResolvedValue(0);
    mocks.getKalshiCapital.mockResolvedValue({
      currentBalance: 1000,
      startingBalance: 1000,
    });
    mocks.syncKalshiCapitalWithLiveEquity.mockResolvedValue(undefined);
    mocks.getOpenKalshiPositions.mockResolvedValue([]);
    mocks.getTodayRealizedLoss.mockResolvedValue(0);
    mocks.getPendingKalshiOrders.mockResolvedValue([]);
    mocks.syncPendingOrders.mockResolvedValue(undefined);
    mocks.fetchKalshiMarketDetails.mockResolvedValue(null);
    mocks.logAuditEvent.mockResolvedValue(true);
    mocks.createAutonomyRun.mockResolvedValue({ runId: "run-123" });
    mocks.updateAutonomyRun.mockResolvedValue({ runId: "run-123" });
    mocks.placeKalshiOrder.mockResolvedValue({ success: true, orderId: "order-1" });
    mocks.getDeskMemory.mockResolvedValue(null);
    mocks.recordDeskMemoryOutcome.mockResolvedValue(undefined);
    mocks.getUserTrainingInstructions.mockResolvedValue([]);
    mocks.isInstructionActiveNow.mockReturnValue(false);
    mocks.applyInstructionsToSignals.mockImplementation((s: any[]) => s);
  });

  it("Signals are saved during autonomy run for auditing and learning", async () => {
    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("executed");
    expect(result.orderPlaced).toBe(true);

    // Signals are saved before execution for audit trail and learning
    // The reviewer (which fetches desk memory) is called with these signals
    expect(mocks.reviewSignalsWithTrader).toHaveBeenCalled();
    expect(mocks.saveSignals).toHaveBeenCalled();

    // The autonomy run captures all decision details for future learning
    expect(result.decision).toBeDefined();
    expect(result.decision?.reasoning).toBeDefined();
  });

  it("Execution cycle completes with audit trail of all stages", async () => {
    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("executed");

    // Verify the full audit trail is logged
    const auditCalls = mocks.logAuditEvent.mock.calls;
    expect(auditCalls.length).toBeGreaterThan(0);

    // Check for key audit events
    const pipelineEvent = auditCalls.find((c: any[]) => c[0] === "kalshi_signal_pipeline");
    const executedEvent = auditCalls.find((c: any[]) => c[0] === "scheduled_autonomy_order_placed");

    expect(pipelineEvent).toBeDefined();
    expect(executedEvent).toBeDefined();
  });
});
