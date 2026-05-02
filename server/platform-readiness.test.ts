/**
 * Tests for the 7 platform-readiness items:
 *  6. Alerting module (consecutive failures, equity drop, exchange rejection)
 *  7. Beta access gate in setTradingActivation
 *
 * Signal scoring (item 4) is tested in kalshi.signals.resolution.test.ts
 * because it must import the real kalshiSignals module.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const envMocks = vi.hoisted(() => ({
  alertWebhookUrl: "",
}));

vi.mock("./_core/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_core/env")>();
  return {
    ...actual,
    ENV: new Proxy(actual.ENV, {
      get(target, prop) {
        if (prop === "alertWebhookUrl") return envMocks.alertWebhookUrl;
        return target[prop as keyof typeof target];
      },
    }),
  };
});

describe("alertIfConsecutiveFailures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not send when there are fewer failures than the threshold", async () => {
    envMocks.alertWebhookUrl = "https://hooks.example.com/test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);

    const { alertIfConsecutiveFailures } = await import("./_core/alerting");
    await alertIfConsecutiveFailures(1, [
      { status: "executed" },
      { status: "error" },
      { status: "error" },
    ]);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends a webhook when consecutive errors reach the threshold", async () => {
    envMocks.alertWebhookUrl = "https://hooks.example.com/test";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, status: 200 } as Response);

    const { alertIfConsecutiveFailures } = await import("./_core/alerting");
    await alertIfConsecutiveFailures(42, [
      { status: "executed" },
      { status: "error" },
      { status: "error" },
      { status: "error" },
    ]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.example.com/test");
    const body = JSON.parse(init.body as string);
    expect(body.event).toBe("autonomy_consecutive_failures");
    expect(body.userId).toBe(42);
    expect(body.details.consecutiveErrors).toBe(3);
  });

  it("does not throw when the webhook URL is not configured", async () => {
    envMocks.alertWebhookUrl = "";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { alertIfConsecutiveFailures } = await import("./_core/alerting");
    await expect(
      alertIfConsecutiveFailures(1, [{ status: "error" }, { status: "error" }, { status: "error" }])
    ).resolves.not.toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not throw when the webhook POST fails", async () => {
    envMocks.alertWebhookUrl = "https://hooks.example.com/test";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));

    const { alertIfConsecutiveFailures } = await import("./_core/alerting");
    await expect(
      alertIfConsecutiveFailures(1, [{ status: "error" }, { status: "error" }, { status: "error" }])
    ).resolves.not.toThrow();
  });
});

describe("alertEquityDrop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends when the drop percentage exceeds the threshold", async () => {
    envMocks.alertWebhookUrl = "https://hooks.example.com/test";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, status: 200 } as Response);

    const { alertEquityDrop } = await import("./_core/alerting");
    await alertEquityDrop(7, 1000, 850); // 15% drop

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.event).toBe("equity_significant_drop");
    expect(body.details.dropPct).toBeCloseTo(15, 1);
  });

  it("does not send when the drop is below the threshold", async () => {
    envMocks.alertWebhookUrl = "https://hooks.example.com/test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);

    const { alertEquityDrop } = await import("./_core/alerting");
    await alertEquityDrop(7, 1000, 960); // 4% drop, below 10% threshold

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

import type { TrpcContext } from "./_core/context";

const betaMocks = vi.hoisted(() => ({
  DEFAULT_PREFERENCES: {
    autonomyMode: "semi_autonomous" as const,
    liveTradingEnabled: false,
    executionCadence: "hourly_watch" as const,
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
  getUserBetaAccessLevel: vi.fn(),
}));

vi.mock("./db", () => ({
  upsertKalshiMarket: vi.fn(),
  getKalshiCapital: vi.fn(async () => ({ currentBalance: 100 })),
  getOpenKalshiPositions: vi.fn(async () => []),
  getTodayRealizedLoss: vi.fn(async () => 0),
  initializeKalshiCapital: vi.fn(),
  getRecentSignals: vi.fn(async () => []),
  getAuditLog: vi.fn(async () => []),
  getRecentAutonomyRuns: vi.fn(async () => []),
  getAutonomyRunDetail: vi.fn(async () => null),
  getKalshiTradeHistory: vi.fn(async () => []),
  getKalshiMarket: vi.fn(async () => null),
  createKalshiSignal: vi.fn(),
  syncKalshiCapitalWithLiveEquity: vi.fn(),
  logAuditEvent: betaMocks.logAuditEvent,
  getUserBetaAccessLevel: betaMocks.getUserBetaAccessLevel,
  setBetaAccessLevel: vi.fn(),
}));

vi.mock("./db.kalshi-credentials", () => ({
  saveKalshiCredentials: vi.fn(),
  getKalshiCredentials: betaMocks.getKalshiCredentials,
  deleteKalshiCredentials: vi.fn(),
  updateKalshiAccountEquity: vi.fn(),
}));

vi.mock("./db.trading-preferences", () => ({
  DEFAULT_TRADING_PREFERENCES: betaMocks.DEFAULT_PREFERENCES,
  getTradingPreferences: betaMocks.getTradingPreferences,
  saveTradingPreferences: betaMocks.saveTradingPreferences,
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
  placeKalshiOrder: vi.fn(),
  cancelKalshiOrder: vi.fn(),
  getKalshiOrderStatus: vi.fn(),
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
  subscribeToMarketFeed: vi.fn(),
  unsubscribeFromMarketFeed: vi.fn(),
  getMarketFeed: vi.fn(),
  getAllMarketFeeds: vi.fn(async () => []),
}));

vi.mock("./_core/kalshiSignals", () => ({
  generateSignalsForMarkets: vi.fn(async () => []),
  filterSignalsByConfidence: vi.fn((s: unknown[]) => s),
  filterSignalsByMarketConditions: vi.fn((s: unknown[]) => s),
  getTopSignalsForExecution: vi.fn(() => []),
  saveSignals: vi.fn(),
  rankSignalsByExecution: vi.fn(() => []),
}));

vi.mock("./_core/tradingReviewer", () => ({
  reviewSignalsWithTrader: vi.fn(async (i: { signals: unknown[] }) => i.signals),
}));

vi.mock("./_core/kalshiLearning", () => ({
  getPerformanceOverview: vi.fn(async () => ({})),
}));

vi.mock("./db.polymarket-credentials", () => ({
  getPolymarketCredentials: vi.fn(async () => null),
  savePolymarketCredentials: vi.fn(),
  deletePolymarketCredentials: vi.fn(),
  getPlatformSubscriptions: vi.fn(async () => ({ subscribedPlatforms: "kalshi" })),
  savePlatformSubscriptions: vi.fn(),
  updatePolymarketAccountStatus: vi.fn(),
}));

vi.mock("./_core/polymarketAuth", () => ({
  validatePolymarketCredentials: vi.fn(async () => ({ valid: false })),
  fetchPolymarketMarkets: vi.fn(async () => []),
  placePolymarketOrder: vi.fn(),
}));

vi.mock("./training.router", () => ({ trainingRouter: {} }));
vi.mock("./advanced.router", () => ({ advancedRouter: {} }));
vi.mock("./chat.router", () => ({ chatRouter: {} }));

function createProtectedContext(overrides: Partial<TrpcContext> = {}): TrpcContext {
  return {
    user: {
      id: 7,
      openId: "kalshi-open-id",
      email: "test@example.com",
      role: "admin",
      betaAccessLevel: "internal",
      name: null,
      twoFactorEnabled: 0,
      twoFactorSecret: null,
      backupCodesHash: null,
      lastSignedIn: null,
      createdAt: new Date(),
    },
    req: {} as any,
    res: {} as any,
    ...overrides,
  };
}

describe("kalshi.setTradingActivation – beta gate", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("blocks arming live trading when beta access level is none", async () => {
    betaMocks.getKalshiCredentials.mockResolvedValue({
      userId: 7,
      accountStatus: "connected",
      accountEquity: 250,
    });
    betaMocks.getTradingPreferences.mockResolvedValue({
      ...betaMocks.DEFAULT_PREFERENCES,
    });
    betaMocks.getUserBetaAccessLevel.mockResolvedValue("none");

    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(createProtectedContext());

    await expect(
      caller.kalshi.setTradingActivation({ enabled: true })
    ).rejects.toThrow("closed beta");
  });

  it("allows arming when beta access level is internal", async () => {
    const armedPreferences = {
      ...betaMocks.DEFAULT_PREFERENCES,
      liveTradingEnabled: true,
    };

    betaMocks.getKalshiCredentials.mockResolvedValue({
      userId: 7,
      accountStatus: "connected",
      accountEquity: 250,
    });
    betaMocks.getTradingPreferences.mockResolvedValue({
      ...betaMocks.DEFAULT_PREFERENCES,
    });
    betaMocks.saveTradingPreferences.mockResolvedValue(armedPreferences);
    betaMocks.logAuditEvent.mockResolvedValue(true);
    betaMocks.getUserBetaAccessLevel.mockResolvedValue("internal");

    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.setTradingActivation({ enabled: true });

    expect(result.success).toBe(true);
  });

  it("allows arming when beta access level is invited", async () => {
    const armedPreferences = {
      ...betaMocks.DEFAULT_PREFERENCES,
      liveTradingEnabled: true,
    };

    betaMocks.getKalshiCredentials.mockResolvedValue({
      userId: 7,
      accountStatus: "connected",
      accountEquity: 250,
    });
    betaMocks.getTradingPreferences.mockResolvedValue({
      ...betaMocks.DEFAULT_PREFERENCES,
    });
    betaMocks.saveTradingPreferences.mockResolvedValue(armedPreferences);
    betaMocks.logAuditEvent.mockResolvedValue(true);
    betaMocks.getUserBetaAccessLevel.mockResolvedValue("invited");

    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.setTradingActivation({ enabled: true });

    expect(result.success).toBe(true);
  });
});
