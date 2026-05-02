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
  syncKalshiCapitalWithLiveEquity: vi.fn(),
  getOpenKalshiPositions: vi.fn(),
  getTodayRealizedLoss: vi.fn(),
  logAuditEvent: vi.fn(),
  createAutonomyRun: vi.fn(),
  updateAutonomyRun: vi.fn(),
  placeKalshiOrder: vi.fn(),
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
  logAuditEvent: mocks.logAuditEvent,
  createAutonomyRun: mocks.createAutonomyRun,
  updateAutonomyRun: mocks.updateAutonomyRun,
}));

vi.mock("./_core/kalshiAuth", () => ({
  fetchKalshiAccountEquity: mocks.fetchKalshiAccountEquity,
}));

vi.mock("./_core/kalshiMarketData", () => ({
  fetchKalshiMarkets: mocks.fetchKalshiMarkets,
}));

vi.mock("./_core/kalshiMarketFeed", () => ({
  getMarketFeed: mocks.getMarketFeed,
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
  loginMethod: "manus",
  role: "user" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
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
        yesPrice: 0.43,
        noPrice: 0.57,
        impliedProbability: 0.57,
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
    mocks.syncKalshiCapitalWithLiveEquity.mockResolvedValue(undefined);
    mocks.getOpenKalshiPositions.mockResolvedValue([]);
    mocks.getTodayRealizedLoss.mockResolvedValue(0);
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

  it("generates and saves signals but never auto-submits in approval-required mode while persisting candidate details", async () => {
    mocks.getTradingPreferences.mockResolvedValue({
      ...mocks.DEFAULT_PREFERENCES,
      autonomyMode: "approval_required",
    });

    const result = await runScheduledAutonomousTrading(testUser);

    expect(result.status).toBe("generated_only");
    expect(result.reason).toContain("approval-required mode");
    expect(result.executionCandidates).toBe(1);
    expect(result.decision).toMatchObject({
      marketId: "KXTEST-1",
      side: "yes",
      confidence: 0.83,
      executionScore: 0.84,
      expectedValue: 0.18,
      limitPrice: 0.43,
      blockedBy: "approval_required_mode",
    });
    expect(mocks.saveSignals).toHaveBeenCalled();
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "scheduled_autonomy_run_generated_only",
      expect.stringContaining('"decision":{"marketId":"KXTEST-1"'),
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
      quantity: 11,
      limitPrice: 0.43,
      availableCapital: 100,
      maxBudget: 5,
    });
    expect(result.decision?.orderExposure).toBeCloseTo(4.73, 6);
    expect(result.decision?.maxLossOnTrade).toBeCloseTo(4.73, 6);
    expect(mocks.placeKalshiOrder).toHaveBeenCalledWith(7, "KXTEST-1", "yes", 11, 0.43);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "scheduled_autonomy_order_placed",
      expect.stringContaining('"orderExposure":4.729'),
      "away-open-id"
    );
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "scheduled_autonomy_run_executed",
      expect.stringContaining('"decision":{"marketId":"KXTEST-1"'),
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
          autonomyMode: "semi_autonomous",
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
