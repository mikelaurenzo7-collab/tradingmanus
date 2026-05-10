import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  DEFAULT_PREFERENCES: {
    autonomyMode: "fully_autonomous" as const,
    liveTradingEnabled: true,
    executionCadence: "continuous_watch" as const,
    riskPosture: "balanced" as const,
    minSignalConfidence: 0.72,
    maxOrderNotional: 10,
    maxDailyOrders: 3,
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
  getKalshiTradeHistory: vi.fn(),
  getRecentSignals: vi.fn(),
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
  getKalshiTradeHistory: mocks.getKalshiTradeHistory,
  getRecentSignals: mocks.getRecentSignals,
  syncKalshiCapitalWithLiveEquity: mocks.syncKalshiCapitalWithLiveEquity,
  getOpenKalshiPositions: mocks.getOpenKalshiPositions,
  getTodayRealizedLoss: mocks.getTodayRealizedLoss,
  getPendingKalshiOrders: mocks.getPendingKalshiOrders,
  logAuditEvent: mocks.logAuditEvent,
  createAutonomyRun: mocks.createAutonomyRun,
  updateAutonomyRun: mocks.updateAutonomyRun,
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
  computeKellyFraction: vi.fn((confidence: number, marketPrice: number) => {
    if (!Number.isFinite(confidence) || !Number.isFinite(marketPrice) || marketPrice <= 0 || marketPrice >= 1) {
      return 0;
    }
    const odds = (1 - marketPrice) / marketPrice;
    const lossProbability = 1 - confidence;
    const fullKelly = (confidence * odds - lossProbability) / odds;
    return Math.max(0, Math.min(0.2, fullKelly * 0.25));
  }),
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
  getUserTrainingInstructions: vi.fn().mockResolvedValue([]),
  isInstructionActiveNow: vi.fn().mockReturnValue(false),
  applyInstructionsToSignals: vi.fn().mockImplementation((signals: any[]) => signals),
}));

import {
  runScheduledAutonomousTrading,
  runScheduledAutonomousTradingBatch,
} from "./_core/kalshiAutonomy";

const testUser = {
  id: 7,
  openId: "away-open-id",
  email: "laurenzo@example.com",
  name: "Laurenzo Operator",
  role: "user" as const,
  betaAccessLevel: "none" as const,
  twoFactorSecret: null,
  twoFactorEnabled: 0,
  backupCodesHash: null,
  createdAt: new Date(),
  lastSignedIn: new Date(),
};

const candidateSignal = {
  marketId: "KXTEST-1",
  signalType: "momentum" as const,
  side: "yes" as const,
  confidence: 0.83,
  reasoning: "Explicit probability edge",
  impliedProbability: 0.57,
  marketPrice: 0.43,
  expectedValue: 0.18,
  executionScore: 0.84,
};

describe("scheduled away-from-chat trading", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getTradingPreferences.mockResolvedValue(mocks.DEFAULT_PREFERENCES);
    mocks.getKalshiCredentials.mockResolvedValue({
      userId: 7,
      accountStatus: "connected",
      apiKey: "kalshi-key",
      privateKey: "kalshi-private-key",
    });
    mocks.fetchKalshiAccountEquity.mockResolvedValue({ equity: 100, error: null });
    mocks.fetchKalshiMarkets.mockResolvedValue([
      {
        id: "KXTEST-1",
        title: "Will demo market resolve yes?",
        category: "sports",
        yesPrice: 0.43,
        noPrice: 0.57,
        yesVolume: 1500,
        noVolume: 1500,
        impliedProbability: 0.57,
        resolutionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);
    mocks.getMarketFeed.mockReturnValue(null);
    mocks.generateSignalsForMarkets.mockResolvedValue([candidateSignal]);
    mocks.filterSignalsByConfidence.mockImplementation((signals: any[]) => signals);
    mocks.filterSignalsByMarketConditions.mockImplementation((signals: any[]) => signals);
    mocks.reviewSignalsWithTrader.mockImplementation(async ({ signals }: { signals: any[] }) => signals);
    mocks.getTopSignalsForExecution.mockReturnValue([candidateSignal]);
    mocks.saveSignals.mockResolvedValue(undefined);
    mocks.getLatestAuditEventByType.mockResolvedValue(null);
    mocks.getLatestAutonomyRun.mockResolvedValue(null);
    mocks.getTodayKalshiOrderCount.mockResolvedValue(0);
    mocks.getKalshiCapital.mockResolvedValue({ currentBalance: 100, startingBalance: 100 });
    mocks.getKalshiTradeHistory.mockResolvedValue([]);
    mocks.getRecentSignals.mockResolvedValue([]);
    mocks.syncKalshiCapitalWithLiveEquity.mockResolvedValue(undefined);
    mocks.getOpenKalshiPositions.mockResolvedValue([]);
    mocks.getTodayRealizedLoss.mockResolvedValue(0);
    mocks.getPendingKalshiOrders.mockResolvedValue([]);
    mocks.syncPendingOrders.mockResolvedValue(undefined);
    mocks.fetchKalshiMarketDetails.mockResolvedValue(null);
    mocks.logAuditEvent.mockResolvedValue(true);
    mocks.createAutonomyRun.mockResolvedValue({ runId: "run-123" });
    mocks.updateAutonomyRun.mockResolvedValue({ runId: "run-123" });
    mocks.placeKalshiOrder.mockResolvedValue({ success: true, orderId: "order-123" });
  });

  it("skips hourly scheduled runs that already executed recently", async () => {
    mocks.getTradingPreferences.mockResolvedValue({
      ...mocks.DEFAULT_PREFERENCES,
      executionCadence: "hourly_watch",
    });
    mocks.getLatestAutonomyRun.mockResolvedValue({
      startedAt: new Date(Date.now() - 5 * 60 * 1000),
    });

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("already ran recently");
    expect(mocks.fetchKalshiAccountEquity).not.toHaveBeenCalled();
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "scheduled_autonomy_run_skipped",
      expect.stringContaining('"reason":"hourly review policy already ran recently"'),
      "away-open-id"
    );
  });

  it("skips autonomous runs immediately after a manual order", async () => {
    mocks.getLatestAuditEventByType.mockImplementation(async (eventType: string) => {
      if (eventType === "kalshi_order_placed") {
        return { createdAt: new Date(Date.now() - 60 * 1000) };
      }

      return null;
    });

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("recent manual order");
    expect(mocks.fetchKalshiAccountEquity).not.toHaveBeenCalled();
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "scheduled_autonomy_run_skipped",
      expect.stringContaining('"reason":"recent manual order detected; autonomy will wait for the next cycle"'),
      "away-open-id"
    );
  });


  it("places a live order when a fully autonomous scheduled run finds an eligible non-heuristic signal and persists the sizing decision", async () => {
    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("executed");
    expect(result.orderPlaced).toBe(true);
    expect(result.orderId).toBe("order-123");
    expect(result.executedMarketId).toBe("KXTEST-1");
    expect(result.decision).toMatchObject({
      marketId: "KXTEST-1",
      side: "yes",
      // With MAX_RISK_PER_TRADE_PERCENT=6 default and $100 capital, the
      // outer cap is $6 but Kelly binds at $5 → 10 contracts at $0.43 =
      // $4.30 exposure.
      quantity: 10,
      limitPrice: 0.43,
      availableCapital: 100,
      maxBudget: 5,
    });
    expect(result.decision?.orderExposure).toBeCloseTo(4.30, 6);
    expect(result.decision?.maxLossOnTrade).toBeCloseTo(4.30, 6);
    expect(mocks.placeKalshiOrder).toHaveBeenCalledWith(7, "KXTEST-1", "yes", 10, 0.43);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "scheduled_autonomy_order_placed",
      expect.stringContaining('"orderExposure":4.3'),
      "away-open-id"
    );
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "scheduled_autonomy_run_executed",
      expect.stringContaining('"decision":{"marketId":"KXTEST-1"'),
      "away-open-id"
    );
  });

  it("emits sizing telemetry when market-impact guardrails reduce quantity", async () => {
    const highImpactSignal = {
      ...candidateSignal,
      metadata: {
        totalVolume: 100,
        volatility: 0.1,
      },
    };
    mocks.generateSignalsForMarkets.mockResolvedValueOnce([highImpactSignal]);
    mocks.reviewSignalsWithTrader.mockImplementationOnce(async ({ signals }: { signals: any[] }) => signals);
    mocks.getTopSignalsForExecution.mockReturnValueOnce([highImpactSignal]);

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("executed");
    expect(mocks.placeKalshiOrder).toHaveBeenCalledTimes(1);
    const placedQuantity = mocks.placeKalshiOrder.mock.calls[0][3];
    expect(placedQuantity).toBeGreaterThan(0);
    expect(placedQuantity).toBeLessThan(10);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "scheduled_autonomy_order_sized_by_market_impact",
      expect.stringContaining('"impactAdjustedQuantity"'),
      "away-open-id"
    );
  });

  it("blocks execution and audits when market-impact guardrails hard-block an order", async () => {
    const blockedSignal = {
      ...candidateSignal,
      metadata: {
        totalVolume: 10,
        volatility: 0.25,
      },
    };
    mocks.generateSignalsForMarkets.mockResolvedValueOnce([blockedSignal]);
    mocks.reviewSignalsWithTrader.mockImplementationOnce(async ({ signals }: { signals: any[] }) => signals);
    mocks.getTopSignalsForExecution.mockReturnValueOnce([blockedSignal]);

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("blocked");
    expect(result.decision?.blockedBy).toBe("market_impact_guardrail");
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "scheduled_autonomy_order_blocked_market_impact",
      expect.stringContaining('"marketId":"KXTEST-1"'),
      "away-open-id"
    );
  });

  it("fails closed when the AI trader duo approves nothing", async () => {
    mocks.reviewSignalsWithTrader.mockResolvedValueOnce([]);
    mocks.getTopSignalsForExecution.mockReturnValueOnce([]);

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("generated_only");
    expect(result.reason).toContain("no non-heuristic execution-ready signals");
    expect(result.signalsGenerated).toBe(0);
    expect(result.executionCandidates).toBe(0);
    expect(mocks.saveSignals).toHaveBeenCalledWith([], 7);
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
  });

  it("emits a kalshi_signal_pipeline audit event capturing filter stage counts", async () => {
    // Use mock return values that can be tracked through each stage.
    const rawSignals = [candidateSignal, { ...candidateSignal, marketId: "KXTEST-2" }];
    const afterConfidence = [candidateSignal]; // one dropped by confidence
    mocks.generateSignalsForMarkets.mockResolvedValueOnce(rawSignals);
    mocks.filterSignalsByConfidence.mockImplementationOnce(() => afterConfidence);
    mocks.filterSignalsByMarketConditions.mockImplementationOnce((s: any[]) => s); // no drop

    await runScheduledAutonomousTrading(testUser);

    const pipelineCalls = mocks.logAuditEvent.mock.calls.filter(
      (c: any[]) => c[0] === "kalshi_signal_pipeline"
    );
    expect(pipelineCalls).toHaveLength(1);

    const payload = JSON.parse(pipelineCalls[0][1]);
    expect(payload.signalsGenerated).toBe(2);
    expect(payload.afterConfidenceFilter).toBe(1);
    expect(payload.afterInstructionFilter).toBe(1);
    expect(typeof payload.marketsDiscovered).toBe("number");
    expect(typeof payload.actionableMarkets).toBe("number");
    expect(pipelineCalls[0][2]).toBe("user:7");
  });

  it("skips duplicate scheduled invocations for the same time bucket before re-running the autonomy flow", async () => {
    mocks.createAutonomyRun.mockResolvedValueOnce(null);

    const result = await runScheduledAutonomousTrading(testUser, {
      triggeredByOpenId: "vercel_cron",
      now: new Date("2026-04-25T08:45:00Z"),
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("already in progress or completed");
    expect(mocks.fetchKalshiAccountEquity).not.toHaveBeenCalled();
    expect(mocks.updateAutonomyRun).not.toHaveBeenCalled();
  });

  it("records reconciliation-needed executions when the exchange accepts an order but the local ledger write fails", async () => {
    mocks.placeKalshiOrder.mockResolvedValueOnce({
      success: true,
      orderId: "order-123",
      needsReconciliation: true,
      reconciliationReason: "exchange accepted the order but the local order ledger write failed",
      exchangeRequest: { marketId: "KXTEST-1" },
      exchangeResponse: { orderId: "order-123" },
    });

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("executed");
    expect(result.reconciliationStatus).toBe("pending");
    expect(result.reconciliationReason).toContain("local order ledger write failed");
    expect(mocks.updateAutonomyRun).toHaveBeenCalledWith(
      expect.any(String),
      7,
      expect.objectContaining({
        reconciliationStatus: "pending",
      })
    );
  });

  it("summarizes automatic-review outcomes across all eligible users in a single batch", async () => {
    const secondUser = {
      ...testUser,
      id: 8,
      openId: "second-open-id",
      email: "second@example.com",
      name: "Second User",
    };

    const batch = await runScheduledAutonomousTradingBatch(
      [testUser, secondUser],
      "scheduler-open-id",
      undefined,
      async (user) => {
        if (user.id === 7) {
          return {
            success: true,
            status: "executed",
            reason: "placed a live order",
            signalsGenerated: 3,
            executionCandidates: 1,
            orderPlaced: true,
            orderId: "order-123",
            executedMarketId: "KXTEST-1",
            candidateMarketId: "KXTEST-1",
            autonomyMode: "fully_autonomous",
            executionCadence: "continuous_watch",
            decision: null,
          };
        }

        return {
          success: true,
          status: "blocked",
          reason: "daily order cap reached",
          signalsGenerated: 2,
          executionCandidates: 1,
          orderPlaced: false,
          candidateMarketId: "KXTEST-2",
          autonomyMode: "fully_autonomous",
          executionCadence: "hourly_watch",
          decision: null,
        };
      }
    );

    expect(batch).toMatchObject({
      success: true,
      mode: "eligible_users_batch",
      triggeredByOpenId: "scheduler-open-id",
      eligibleUsers: 2,
      processedUsers: 2,
      executedUsers: 1,
      blockedUsers: 1,
      generatedOnlyUsers: 0,
      skippedUsers: 0,
      errorUsers: 0,
    });
    expect(batch.results).toEqual([
      {
        userId: 7,
        openId: "away-open-id",
        status: "executed",
        reason: "placed a live order",
        orderPlaced: true,
        executedMarketId: "KXTEST-1",
        candidateMarketId: "KXTEST-1",
      },
      {
        userId: 8,
        openId: "second-open-id",
        status: "blocked",
        reason: "daily order cap reached",
        orderPlaced: false,
        executedMarketId: undefined,
        candidateMarketId: "KXTEST-2",
      },
    ]);
  });
});

describe("credential and equity blocking paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTradingPreferences.mockResolvedValue(mocks.DEFAULT_PREFERENCES);
    mocks.createAutonomyRun.mockResolvedValue({ runId: "run-123" });
    mocks.updateAutonomyRun.mockResolvedValue({ runId: "run-123" });
    mocks.logAuditEvent.mockResolvedValue(true);
  });

  it("blocks when no Kalshi credentials are found for the user", async () => {
    mocks.getKalshiCredentials.mockResolvedValue(null);

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("no connected live Kalshi account");
    expect(mocks.fetchKalshiAccountEquity).not.toHaveBeenCalled();
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
  });

  it("blocks when Kalshi credentials require re-authentication", async () => {
    mocks.getKalshiCredentials.mockResolvedValue({
      userId: 7,
      accountStatus: "connected",
      apiKey: "expired-key",
      privateKey: "expired-pk",
      needsReauth: true,
    });

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("blocked");
    expect(result.reason).toMatch(/re-authentication required/i);
    expect(mocks.fetchKalshiAccountEquity).not.toHaveBeenCalled();
  });

  it("blocks when the Kalshi account status is not connected", async () => {
    mocks.getKalshiCredentials.mockResolvedValue({
      userId: 7,
      accountStatus: "disconnected",
      apiKey: "key",
      privateKey: "pk",
    });

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("no connected live Kalshi account");
    expect(mocks.fetchKalshiAccountEquity).not.toHaveBeenCalled();
  });

  it("returns error status when the live equity refresh fails", async () => {
    mocks.getKalshiCredentials.mockResolvedValue({
      userId: 7,
      accountStatus: "connected",
      apiKey: "key",
      privateKey: "pk",
    });
    mocks.fetchKalshiAccountEquity.mockResolvedValue({
      equity: 0,
      error: "connection timeout",
    });

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("error");
    expect(result.reason).toContain("live equity refresh failed");
    expect(result.reason).toContain("connection timeout");
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
  });
});

describe("execution guardrails — safety blocking paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getTradingPreferences.mockResolvedValue(mocks.DEFAULT_PREFERENCES);
    mocks.getKalshiCredentials.mockResolvedValue({
      userId: 7,
      accountStatus: "connected",
      apiKey: "kalshi-key",
      privateKey: "kalshi-private-key",
    });
    mocks.fetchKalshiAccountEquity.mockResolvedValue({ equity: 100, error: null });
    mocks.fetchKalshiMarkets.mockResolvedValue([
      {
        id: "KXTEST-1",
        title: "Will demo market resolve yes?",
        category: "sports",
        yesPrice: 0.43,
        noPrice: 0.57,
        yesVolume: 1500,
        noVolume: 1500,
        impliedProbability: 0.57,
        resolutionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);
    mocks.getMarketFeed.mockReturnValue(null);
    mocks.isMarketDataStale.mockReturnValue(false);
    mocks.generateSignalsForMarkets.mockResolvedValue([candidateSignal]);
    mocks.filterSignalsByConfidence.mockImplementation((signals: any[]) => signals);
    mocks.filterSignalsByMarketConditions.mockImplementation((signals: any[]) => signals);
    mocks.reviewSignalsWithTrader.mockImplementation(async ({ signals }: { signals: any[] }) => signals);
    mocks.getTopSignalsForExecution.mockReturnValue([candidateSignal]);
    mocks.saveSignals.mockResolvedValue(undefined);
    mocks.getLatestAuditEventByType.mockResolvedValue(null);
    mocks.getLatestAutonomyRun.mockResolvedValue(null);
    mocks.getTodayKalshiOrderCount.mockResolvedValue(0);
    mocks.getKalshiCapital.mockResolvedValue({ currentBalance: 100, startingBalance: 100 });
    mocks.syncKalshiCapitalWithLiveEquity.mockResolvedValue(undefined);
    mocks.getOpenKalshiPositions.mockResolvedValue([]);
    mocks.getTodayRealizedLoss.mockResolvedValue(0);
    mocks.getPendingKalshiOrders.mockResolvedValue([]);
    mocks.syncPendingOrders.mockResolvedValue(undefined);
    mocks.fetchKalshiMarketDetails.mockResolvedValue(null);
    mocks.logAuditEvent.mockResolvedValue(true);
    mocks.createAutonomyRun.mockResolvedValue({ runId: "run-123" });
    mocks.updateAutonomyRun.mockResolvedValue({ runId: "run-123" });
    mocks.placeKalshiOrder.mockResolvedValue({ success: true, orderId: "order-123" });
  });

  it("blocks execution when the daily order cap has been reached", async () => {
    mocks.getTodayKalshiOrderCount.mockResolvedValue(3); // DEFAULT maxDailyOrders = 3

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("daily order cap");
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
  });

  it("blocks execution when the maximum number of open positions has been reached", async () => {
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
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
  });

  it("blocks execution when the daily realized loss limit has been reached", async () => {
    // getDynamicRiskLimits with $100 balance → maxLossPerDay = clamp(100*0.1, 2, 10) = 10
    mocks.getTodayRealizedLoss.mockResolvedValue(10);

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("blocked");
    // Either the new percentage-based drawdown breaker (3% default) OR the
    // legacy dollar-based maxLossPerDay can trip first; both correctly block.
    expect(result.reason.toLowerCase()).toMatch(/daily (loss|drawdown)/);
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
  });


  it("skips an execution candidate when an open position already exists for the same market", async () => {
    // One position is open, but maxOpenPositions = 5 so the global cap passes;
    // evaluateExecutionCandidate rejects the candidate via market_already_open.
    mocks.getOpenKalshiPositions.mockResolvedValue([{ marketId: "KXTEST-1" }]);

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("generated_only");
    expect(result.orderPlaced).toBe(false);
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
  });

  it("skips an execution candidate when a pending order is already in flight for the same market", async () => {
    mocks.getPendingKalshiOrders.mockResolvedValue([{ marketId: "KXTEST-1" }]);

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("generated_only");
    expect(result.orderPlaced).toBe(false);
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
  });

  it("blocks execution when the live market price has drifted beyond the tolerance since signal generation", async () => {
    // Signal price is 0.43 (yes side); live price is 0.46 → drift = 0.03 > 0.02 (MAX_EXECUTION_PRICE_DRIFT)
    mocks.fetchKalshiMarketDetails.mockResolvedValue({
      id: "KXTEST-1",
      yesPrice: 0.46,
      noPrice: 0.54,
    });

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("blocked");
    expect(result.reason).toMatch(/market price drifted/i);
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "scheduled_autonomy_order_blocked_price_drift",
      expect.stringContaining('"signalPrice":0.43'),
      "away-open-id"
    );
  });

  it("returns blocked status and records an audit event when the exchange rejects the order", async () => {
    mocks.placeKalshiOrder.mockResolvedValue({
      success: false,
      error: "INSUFFICIENT_FUNDS",
    });

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("INSUFFICIENT_FUNDS");
    expect(result.orderPlaced).toBe(false);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "scheduled_autonomy_order_blocked_or_failed",
      expect.stringContaining('"reason":"INSUFFICIENT_FUNDS"'),
      "away-open-id"
    );
  });

  it("reports error status and emits an audit event when the AI reviewer encounters anthropic failures", async () => {
    // Simulate the reviewer mutating the shared telemetry object with failures
    // (matching real behaviour when Anthropic calls time out or return errors).
    mocks.reviewSignalsWithTrader.mockImplementation(
      async (_input: { signals: any[] }, opts?: { userId?: number; telemetry?: any }) => {
        if (opts?.telemetry) {
          opts.telemetry.anthropicFailures = 2;
          opts.telemetry.anthropicCalls = 2;
        }
        return [];
      }
    );
    mocks.getTopSignalsForExecution.mockReturnValue([]);

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/ai reviewer encountered 2 failure/i);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "scheduled_autonomy_ai_reviewer_failure",
      expect.stringContaining('"anthropicFailures":2'),
      "away-open-id"
    );
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
  });

  it("skips a candidate when its market feed data is stale at evaluation time", async () => {
    // getMarketFeed returns a non-null feed object so the stale-check branch runs,
    // and isMarketDataStale is forced to true so the candidate is rejected.
    mocks.getMarketFeed.mockReturnValue({ marketId: "KXTEST-1", lastUpdateTime: 1640000000000 });
    mocks.isMarketDataStale.mockReturnValue(true);

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("generated_only");
    expect(result.orderPlaced).toBe(false);
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
  });
});
