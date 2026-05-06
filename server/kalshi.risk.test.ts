import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  logAuditEvent: vi.fn(),
  activateKalshiKillSwitch: vi.fn(),
  fetchKalshiMarkets: vi.fn(),
  getKalshiCapital: vi.fn(),
  getOpenKalshiPositions: vi.fn(),
  getTodayRealizedLoss: vi.fn(),
  getTodayKalshiOrderCount: vi.fn(),
  placeKalshiOrder: vi.fn(),
  fetchKalshiMarketDetails: vi.fn(),
  getTradingPreferences: vi.fn(),
  saveTradingPreferences: vi.fn(),
}));

vi.mock("./db", () => ({
  logAuditEvent: mocks.logAuditEvent,
  getKalshiCapital: mocks.getKalshiCapital,
  getOpenKalshiPositions: mocks.getOpenKalshiPositions,
  getTodayRealizedLoss: mocks.getTodayRealizedLoss,
  getTodayKalshiOrderCount: mocks.getTodayKalshiOrderCount,
  initializeKalshiCapital: vi.fn(),
  getRecentSignals: vi.fn(async () => []),
  getAuditLog: vi.fn(async () => []),
}));

vi.mock("./db.trading-preferences", () => ({
  DEFAULT_TRADING_PREFERENCES: {
    autonomyMode: "approval_required",
    liveTradingEnabled: false,
    executionCadence: "manual_only",
    riskPosture: "balanced",
    minSignalConfidence: 0.72,
    maxOrderNotional: 10,
    maxDailyOrders: 3,
    requireApprovalAbove: 8,
  },
  getTradingPreferences: mocks.getTradingPreferences,
  saveTradingPreferences: mocks.saveTradingPreferences,
}));

vi.mock("./_core/kalshiMarketData", () => ({
  fetchKalshiMarkets: mocks.fetchKalshiMarkets,
  fetchKalshiMarketDetails: mocks.fetchKalshiMarketDetails,
}));

vi.mock("./_core/kalshiExecution", () => ({
  placeKalshiOrder: mocks.placeKalshiOrder,
  cancelKalshiOrder: vi.fn(),
  getKalshiOrderStatus: vi.fn(),
  getKalshiPositions: vi.fn(async () => []),
  closeKalshiPosition: vi.fn(),
  activateKalshiKillSwitch: mocks.activateKalshiKillSwitch,
}));

import { appRouter } from "./routers";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createProtectedContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "risk-user",
    email: "risk@example.com",
    name: "Risk User",
    role: "user",
    betaAccessLevel: "none" as const,
    twoFactorSecret: null,
    twoFactorEnabled: 0,
    backupCodesHash: null,
    createdAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    paperTradeMode: false,
  };
}

describe("kalshi risk controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getKalshiCapital.mockResolvedValue({ currentBalance: 100 });
    mocks.getOpenKalshiPositions.mockResolvedValue([]);
    mocks.getTodayRealizedLoss.mockResolvedValue(0);
    mocks.getTodayKalshiOrderCount.mockResolvedValue(0);
    mocks.fetchKalshiMarketDetails.mockResolvedValue({ yesVolume: 50_000, noVolume: 50_000 });
    mocks.getTradingPreferences.mockResolvedValue({
      autonomyMode: "approval_required",
      liveTradingEnabled: true,
      executionCadence: "manual_only",
      riskPosture: "balanced",
      minSignalConfidence: 0.72,
      maxOrderNotional: 10,
      maxDailyOrders: 3,
      requireApprovalAbove: 8,
    });
    mocks.saveTradingPreferences.mockResolvedValue({
      autonomyMode: "approval_required",
      liveTradingEnabled: false,
      executionCadence: "manual_only",
      riskPosture: "balanced",
      minSignalConfidence: 0.72,
      maxOrderNotional: 10,
      maxDailyOrders: 3,
      requireApprovalAbove: 8,
    });
    mocks.placeKalshiOrder.mockResolvedValue({ success: true, orderId: "order-1" });
  });

  it("returns live-aware risk limits using the synced capital row", async () => {
    const caller = appRouter.createCaller(createProtectedContext());

    const result = await caller.kalshi.getRiskLimits();

    expect(result).toEqual({
      maxCapital: 100,
      maxLossPerTrade: 5,
      maxLossPerDay: 10,
      maxPositionSize: 20,
      maxOpenPositions: 5,
    });
  });

  it("blocks orders that exceed the per-trade risk limit", async () => {
    const caller = appRouter.createCaller(createProtectedContext());

    const result = await caller.kalshi.placeOrder({
      marketId: "FED-2026",
      side: "yes",
      quantity: 20, // Exceeds $5 max loss limit
      limitPrice: 0.5, // 50% price = max loss is $5 (10 * 0.5)
    });

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining("exceeds max per-trade risk"),
    });
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
  });

  it("blocks orders when the open-position limit is already reached", async () => {
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
      { id: 5 },
    ]);
    const caller = appRouter.createCaller(createProtectedContext());

    const result = await caller.kalshi.placeOrder({
      marketId: "CPI-2026",
      side: "no",
      quantity: 1,
      limitPrice: 0.5,
    });

    expect(result).toEqual({
      success: false,
      error: "Open position limit reached (5)",
    });
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
  });

  it("blocks orders when the daily realized-loss limit has already been hit", async () => {
    mocks.getTodayRealizedLoss.mockResolvedValue(10);
    const caller = appRouter.createCaller(createProtectedContext());

    const result = await caller.kalshi.placeOrder({
      marketId: "JOBS-2026",
      side: "yes",
      quantity: 1,
      limitPrice: 0.5,
    });

    expect(result).toEqual({
      success: false,
      error: "Daily loss limit reached ($10)",
    });
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
  });

  it("routes live order placement through the authenticated user id", async () => {
    const caller = appRouter.createCaller(createProtectedContext());

    await caller.kalshi.placeOrder({
      marketId: "GDP-2026",
      side: "yes",
      quantity: 2,
      limitPrice: 0.5,
    });

    expect(mocks.placeKalshiOrder).toHaveBeenCalledWith(1, "GDP-2026", "yes", 2, 0.5);
  });

  it("blocks manual orders when market-impact guardrails hard-block execution", async () => {
    mocks.fetchKalshiMarketDetails.mockResolvedValue({ yesVolume: 1, noVolume: 1 });
    const caller = appRouter.createCaller(createProtectedContext());

    const result = await caller.kalshi.placeOrder({
      marketId: "THIN-BOOK-2026",
      side: "yes",
      quantity: 2,
      limitPrice: 0.5,
    });

    expect(result).toEqual({
      success: false,
      error: "Order blocked by market-impact guardrail",
    });
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "kalshi_order_blocked_market_impact",
      expect.stringContaining('"impactAdjustedQuantity":0'),
      "risk-user"
    );
  });

  it("downsizes manual orders when market impact is elevated and audits the adjustment", async () => {
    mocks.fetchKalshiMarketDetails.mockResolvedValue({ yesVolume: 100, noVolume: 100 });
    const caller = appRouter.createCaller(createProtectedContext());

    const result = await caller.kalshi.placeOrder({
      marketId: "MID-LIQ-2026",
      side: "yes",
      quantity: 20,
      limitPrice: 0.5,
    });

    expect(result.success).toBe(true);
    expect(mocks.placeKalshiOrder).toHaveBeenCalledWith(1, "MID-LIQ-2026", "yes", 10, 0.5);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "kalshi_order_sized_by_market_impact",
      expect.stringContaining('"impactAdjustedQuantity":10'),
      "risk-user"
    );
  });

  it("applies conservative sizing fallback when liquidity data is unavailable", async () => {
    mocks.fetchKalshiMarketDetails.mockResolvedValue(null);
    const caller = appRouter.createCaller(createProtectedContext());

    const result = await caller.kalshi.placeOrder({
      marketId: "UNKNOWN-LIQ-2026",
      side: "yes",
      quantity: 20,
      limitPrice: 0.5,
    });

    expect(result.success).toBe(true);
    const placedQuantity = mocks.placeKalshiOrder.mock.calls[0][3];
    expect(placedQuantity).toBeLessThan(20);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "kalshi_order_sized_by_market_impact",
      expect.stringContaining('"liquidityUnavailable":true'),
      "risk-user"
    );
  });

  it("returns detailed kill-switch outcomes and logs an audit event", async () => {
    mocks.activateKalshiKillSwitch.mockResolvedValue({
      success: false,
      totalPositions: 2,
      closedPositions: 1,
      failedPositions: 1,
      results: [
        { positionId: 11, marketId: "FED-2026", success: true, mode: "local" },
        { positionId: 12, marketId: "CPI-2026", success: false, error: "Position not found" },
      ],
    });
    mocks.logAuditEvent.mockResolvedValue(undefined);

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.killSwitch();

    expect(mocks.activateKalshiKillSwitch).toHaveBeenCalledTimes(1);
    expect(mocks.activateKalshiKillSwitch).toHaveBeenCalledWith(1);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "kalshi_kill_switch_activated",
      JSON.stringify({
        totalPositions: 2,
        closedPositions: 1,
        failedPositions: 1,
      }),
      "risk-user"
    );
    expect(result).toMatchObject({
      success: false,
      totalPositions: 2,
      closedPositions: 1,
      failedPositions: 1,
    });
    expect(result.results).toHaveLength(2);
  });
});
