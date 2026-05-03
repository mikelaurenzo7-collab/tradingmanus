import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  DEFAULT_PREFERENCES: {
    autonomyMode: "approval_required" as const,
    liveTradingEnabled: false,
    executionCadence: "manual_only" as const,
    riskPosture: "balanced" as const,
    minSignalConfidence: 0.72,
    maxOrderNotional: 10,
    maxDailyOrders: 3,
    requireApprovalAbove: 8,
  },
  getTradingPreferences: vi.fn(),
  saveTradingPreferences: vi.fn(),
  getKalshiCredentials: vi.fn(),
  logAuditEvent: vi.fn(),
  placeKalshiOrder: vi.fn(),
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
  syncKalshiCapitalWithLiveEquity: vi.fn(),
  logAuditEvent: mocks.logAuditEvent,
  getUserBetaAccessLevel: vi.fn(async () => "internal"),
}));

vi.mock("./db.kalshi-credentials", () => ({
  saveKalshiCredentials: vi.fn(),
  getKalshiCredentials: mocks.getKalshiCredentials,
  deleteKalshiCredentials: vi.fn(),
  updateKalshiAccountEquity: vi.fn(),
}));

vi.mock("./db.trading-preferences", () => ({
  DEFAULT_TRADING_PREFERENCES: mocks.DEFAULT_PREFERENCES,
  getTradingPreferences: mocks.getTradingPreferences,
  saveTradingPreferences: mocks.saveTradingPreferences,
}));

vi.mock("./_core/kalshiAuth", () => ({
  validateKalshiCredentials: vi.fn(),
  fetchKalshiAccountEquity: vi.fn(),
}));

vi.mock("./_core/kalshiMarketData", () => ({
  fetchKalshiMarkets: vi.fn(async () => []),
  fetchKalshiMarketDetails: vi.fn(async () => null),
}));

vi.mock("./_core/kalshiExecution", () => ({
  placeKalshiOrder: mocks.placeKalshiOrder,
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

describe("kalshi trading preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTradingPreferences.mockResolvedValue(mocks.DEFAULT_PREFERENCES);
  });

  it("returns stored trading preferences for the authenticated user", async () => {
    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.getTradingPreferences();

    expect(mocks.getTradingPreferences).toHaveBeenCalledWith(7);
    expect(result).toEqual(mocks.DEFAULT_PREFERENCES);
  });

  it("saves trading preferences and writes an audit event", async () => {
    const savedPreferences = {
      ...mocks.DEFAULT_PREFERENCES,
      autonomyMode: "fully_autonomous" as const,
      executionCadence: "continuous_watch" as const,
      riskPosture: "aggressive" as const,
      liveTradingEnabled: false,
      minSignalConfidence: 0.81,
      maxOrderNotional: 18,
      maxDailyOrders: 6,
      requireApprovalAbove: 12,
    };

    mocks.getKalshiCredentials.mockResolvedValue({
      userId: 7,
      accountStatus: "connected",
      accountEquity: 250,
    });
    mocks.saveTradingPreferences.mockResolvedValue(savedPreferences);
    mocks.logAuditEvent.mockResolvedValue(true);

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.updateTradingPreferences(savedPreferences);

    expect(mocks.saveTradingPreferences).toHaveBeenCalledWith(7, savedPreferences);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "trading_preferences_updated",
      expect.stringContaining('"autonomyMode":"fully_autonomous"'),
      "kalshi-open-id"
    );
    expect(result).toEqual({
      success: true,
      preferences: savedPreferences,
    });
  });

  it("refuses to arm live trading through the policy save endpoint", async () => {
    const attemptedArmedPreferences = {
      ...mocks.DEFAULT_PREFERENCES,
      autonomyMode: "fully_autonomous" as const,
      liveTradingEnabled: true,
    };

    const caller = appRouter.createCaller(createProtectedContext());

    await expect(
      caller.kalshi.updateTradingPreferences(attemptedArmedPreferences)
    ).rejects.toThrow("Save policy changes while disarmed");
    expect(mocks.saveTradingPreferences).not.toHaveBeenCalled();
  });

  it("refuses policy edits while live trading is armed", async () => {
    mocks.getTradingPreferences.mockResolvedValue({
      ...mocks.DEFAULT_PREFERENCES,
      autonomyMode: "semi_autonomous",
      liveTradingEnabled: true,
    });

    const caller = appRouter.createCaller(createProtectedContext());

    await expect(
      caller.kalshi.updateTradingPreferences({
        ...mocks.DEFAULT_PREFERENCES,
        autonomyMode: "fully_autonomous",
      })
    ).rejects.toThrow("Disarm live trading before changing autonomy policy settings");
    expect(mocks.saveTradingPreferences).not.toHaveBeenCalled();
  });

  it("refuses to arm live trading when manual mode is selected", async () => {
    mocks.getKalshiCredentials.mockResolvedValue({
      userId: 7,
      accountStatus: "connected",
      accountEquity: 250,
    });
    mocks.getTradingPreferences.mockResolvedValue({
      ...mocks.DEFAULT_PREFERENCES,
      autonomyMode: "manual",
    });

    const caller = appRouter.createCaller(createProtectedContext());

    await expect(
      caller.kalshi.setTradingActivation({ enabled: true })
    ).rejects.toThrow("Manual mode keeps live trading disarmed");
  });

  it("arms live trading when the account is connected, funded, and the policy allows execution", async () => {
    const armedPreferences = {
      ...mocks.DEFAULT_PREFERENCES,
      autonomyMode: "semi_autonomous" as const,
      liveTradingEnabled: true,
      executionCadence: "hourly_watch" as const,
    };

    mocks.getKalshiCredentials.mockResolvedValue({
      userId: 7,
      accountStatus: "connected",
      accountEquity: 250,
    });
    mocks.getTradingPreferences.mockResolvedValue({
      ...mocks.DEFAULT_PREFERENCES,
      autonomyMode: "semi_autonomous",
      executionCadence: "hourly_watch",
    });
    mocks.saveTradingPreferences.mockResolvedValue(armedPreferences);
    mocks.logAuditEvent.mockResolvedValue(true);

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.setTradingActivation({ enabled: true });

    expect(mocks.saveTradingPreferences).toHaveBeenCalledWith(7, armedPreferences);
    expect(mocks.placeKalshiOrder).not.toHaveBeenCalled();
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "live_trading_armed",
      "Mode: semi_autonomous",
      "kalshi-open-id"
    );
    expect(result).toEqual({ success: true, preferences: armedPreferences });
  });
});
