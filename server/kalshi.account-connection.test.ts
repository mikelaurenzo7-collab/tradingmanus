import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  validateKalshiCredentials: vi.fn(),
  fetchKalshiAccountEquity: vi.fn(),
  saveKalshiCredentials: vi.fn(),
  getKalshiCredentials: vi.fn(),
  deleteKalshiCredentials: vi.fn(),
  updateKalshiAccountEquity: vi.fn(),
  syncKalshiCapitalWithLiveEquity: vi.fn(),
  logAuditEvent: vi.fn(),
  getTradingPreferences: vi.fn(),
}));

vi.mock("./db", () => ({
  upsertKalshiMarket: vi.fn(),
  getKalshiCapital: vi.fn(async () => ({ currentBalance: 100 })),
  getOpenKalshiPositions: vi.fn(async () => []),
  getTodayRealizedLoss: vi.fn(async () => 0),
  initializeKalshiCapital: vi.fn(),
  getRecentSignals: vi.fn(async () => []),
  getAuditLog: vi.fn(async () => []),
  getKalshiTradeHistory: vi.fn(async () => []),
  getKalshiMarket: vi.fn(async () => null),
  createKalshiSignal: vi.fn(),
  syncKalshiCapitalWithLiveEquity: mocks.syncKalshiCapitalWithLiveEquity,
  logAuditEvent: mocks.logAuditEvent,
}));

vi.mock("./db.kalshi-credentials", () => ({
  saveKalshiCredentials: mocks.saveKalshiCredentials,
  getKalshiCredentials: mocks.getKalshiCredentials,
  deleteKalshiCredentials: mocks.deleteKalshiCredentials,
  updateKalshiAccountEquity: mocks.updateKalshiAccountEquity,
}));

vi.mock("./_core/kalshiAuth", () => ({
  validateKalshiCredentials: mocks.validateKalshiCredentials,
  fetchKalshiAccountEquity: mocks.fetchKalshiAccountEquity,
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
  saveTradingPreferences: vi.fn(),
}));

vi.mock("./_core/kalshiMarketData", () => ({
  fetchKalshiMarkets: vi.fn(async () => []),
  fetchKalshiMarketDetails: vi.fn(async () => null),
}));

vi.mock("./_core/kalshiExecution", () => ({
  placeKalshiOrder: vi.fn(),
  cancelKalshiOrder: vi.fn(),
  getKalshiOrderStatus: vi.fn(),
  getKalshiPositions: vi.fn(async () => []),
  closeKalshiPosition: vi.fn(),
  activateKalshiKillSwitch: vi.fn(async () => ({
    success: true,
    totalPositions: 0,
    closedPositions: 0,
    failedPositions: 0,
    results: [],
  })),
}));

vi.mock("./_core/kalshiMarketFeed", () => ({
  subscribeToMarketFeed: vi.fn(async () => null),
  unsubscribeFromMarketFeed: vi.fn(),
  getMarketFeed: vi.fn(() => null),
  getAllMarketFeeds: vi.fn(() => []),
}));

vi.mock("./_core/kalshiSignals", async () => {
  const actual = await vi.importActual<typeof import("./_core/kalshiSignals")>("./_core/kalshiSignals");
  return {
    ...actual,
    generateSignalsForMarkets: vi.fn(async () => []),
    saveSignals: vi.fn(async () => undefined),
  };
});

vi.mock("./training.router", () => ({
  trainingRouter: {
    _def: { procedures: {} },
    createCaller: vi.fn(),
  },
}));

vi.mock("./advanced.router", () => ({
  advancedRouter: {
    _def: { procedures: {} },
    createCaller: vi.fn(),
  },
}));

import { appRouter } from "./routers";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createProtectedContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 7,
    openId: "kalshi-open-id",
    email: "kalshi@example.com",
    name: "Kalshi User",
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

describe("kalshi account connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTradingPreferences.mockResolvedValue({
      autonomyMode: "approval_required",
      liveTradingEnabled: false,
      executionCadence: "manual_only",
      riskPosture: "balanced",
      minSignalConfidence: 0.72,
      maxOrderNotional: 10,
      maxDailyOrders: 3,
      requireApprovalAbove: 8,
    });
  });

  it("validates credentials, syncs equity, and stores them for the authenticated user", async () => {
    mocks.validateKalshiCredentials.mockResolvedValue({ valid: true, mode: "production" });
    mocks.fetchKalshiAccountEquity.mockResolvedValue({ equity: 123.45, mode: "production" });
    mocks.saveKalshiCredentials.mockResolvedValue(undefined);
    mocks.syncKalshiCapitalWithLiveEquity.mockResolvedValue(undefined);
    mocks.logAuditEvent.mockResolvedValue(undefined);

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.connectKalshiAccount({
      apiKey: "live-api-key",
      privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    });

    expect(mocks.validateKalshiCredentials).toHaveBeenCalledWith(
      "live-api-key",
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    );
    expect(mocks.fetchKalshiAccountEquity).toHaveBeenCalledWith(
      "live-api-key",
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    );
    expect(mocks.saveKalshiCredentials).toHaveBeenCalledWith(
      7,
      "live-api-key",
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      123.45,
    );
    expect(mocks.syncKalshiCapitalWithLiveEquity).toHaveBeenCalledWith(123.45, 7);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "kalshi_account_connected",
      "Equity: $123.45",
      "kalshi-open-id",
    );
    expect(result).toEqual({ success: true, equity: 123.45, mode: "production" });
  });

  it("rejects invalid credentials without saving anything", async () => {
    mocks.validateKalshiCredentials.mockResolvedValue({
      valid: false,
      error: "Invalid Kalshi credentials",
    });

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.connectKalshiAccount({
      apiKey: "bad-key",
      privateKey: "bad-private-key",
    });

    expect(mocks.fetchKalshiAccountEquity).not.toHaveBeenCalled();
    expect(mocks.saveKalshiCredentials).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: "Invalid Kalshi credentials",
    });
  });

  it("returns a clear retry message when validated credentials cannot be persisted", async () => {
    mocks.validateKalshiCredentials.mockResolvedValue({ valid: true, mode: "production" });
    mocks.fetchKalshiAccountEquity.mockResolvedValue({ equity: 99, mode: "production" });
    mocks.saveKalshiCredentials.mockRejectedValue(new Error("closed state"));

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.connectKalshiAccount({
      apiKey: "live-api-key",
      privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    });

    expect(mocks.syncKalshiCapitalWithLiveEquity).not.toHaveBeenCalled();
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error:
        "Your Kalshi credentials were validated, but the dashboard could not save the connection state. Please retry in a moment.",
    });
  });

  it("still succeeds when audit logging fails after credentials are saved", async () => {
    mocks.validateKalshiCredentials.mockResolvedValue({ valid: true, mode: "production" });
    mocks.fetchKalshiAccountEquity.mockResolvedValue({ equity: 78.9, mode: "production" });
    mocks.saveKalshiCredentials.mockResolvedValue(undefined);
    mocks.syncKalshiCapitalWithLiveEquity.mockResolvedValue(undefined);
    mocks.logAuditEvent.mockResolvedValue(false);

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.connectKalshiAccount({
      apiKey: "live-api-key",
      privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    });

    expect(mocks.saveKalshiCredentials).toHaveBeenCalledTimes(1);
    expect(mocks.syncKalshiCapitalWithLiveEquity).toHaveBeenCalledWith(78.9, 7);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "kalshi_account_connected",
      "Equity: $78.9",
      "kalshi-open-id",
    );
    expect(result).toEqual({ success: true, equity: 78.9, mode: "production" });
  });

  it("refreshes live equity for connected users when account status is requested", async () => {
    mocks.getKalshiCredentials.mockResolvedValue({
      userId: 7,
      apiKey: "live-api-key",
      privateKey: "private-key",
      accountEquity: 12,
      accountStatus: "connected",
      lastSyncedAt: new Date("2026-04-24T18:00:00Z"),
    });
    mocks.fetchKalshiAccountEquity.mockResolvedValue({ equity: 321.09, mode: "production" });
    mocks.updateKalshiAccountEquity.mockResolvedValue(undefined);
    mocks.syncKalshiCapitalWithLiveEquity.mockResolvedValue(undefined);

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.getKalshiAccountStatus();

    expect(mocks.fetchKalshiAccountEquity).toHaveBeenCalledWith("live-api-key", "private-key");
    expect(mocks.updateKalshiAccountEquity).toHaveBeenCalledWith(7, 321.09);
    expect(mocks.syncKalshiCapitalWithLiveEquity).toHaveBeenCalledWith(321.09, 7);
    expect(result.connected).toBe(true);
    expect(result.status).toBe("connected");
    expect(result.equity).toBe(321.09);
  });

  it("returns no capital for disconnected users", async () => {
    mocks.getKalshiCredentials.mockResolvedValue(null);

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.getCapital();

    expect(mocks.fetchKalshiAccountEquity).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
