import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  isUserSubscribedToPolymarket: vi.fn(),
  getPolymarketCredentials: vi.fn(),
  getKalshiCredentials: vi.fn(),
  getTradingPreferences: vi.fn(),
  fetchPolymarketMarkets: vi.fn(),
  fetchKalshiMarketDetails: vi.fn(),
  executeCrossArbLegs: vi.fn(),
  logAuditEvent: vi.fn(),
  saveCrossPlatformArbitrageExecution: vi.fn(),
  withUserLock: vi.fn(),
  getKalshiCapital: vi.fn(),
  getOpenKalshiPositions: vi.fn(),
  getTodayRealizedLoss: vi.fn(),
  getTodayKalshiOrderCount: vi.fn(),
}));

vi.mock("./db", () => ({
  logAuditEvent: mocks.logAuditEvent,
  saveCrossPlatformArbitrageExecution: mocks.saveCrossPlatformArbitrageExecution,
  getRecentSignals: vi.fn(async () => []),
  getAuditLog: vi.fn(async () => []),
  getKalshiCapital: mocks.getKalshiCapital,
  getOpenKalshiPositions: mocks.getOpenKalshiPositions,
  getTodayRealizedLoss: mocks.getTodayRealizedLoss,
  getTodayKalshiOrderCount: mocks.getTodayKalshiOrderCount,
}));

vi.mock("./db.polymarket-credentials", () => ({
  isUserSubscribedToPolymarket: mocks.isUserSubscribedToPolymarket,
  getPolymarketCredentials: mocks.getPolymarketCredentials,
}));

vi.mock("./db.kalshi-credentials", () => ({
  getKalshiCredentials: mocks.getKalshiCredentials,
}));

vi.mock("./db.trading-preferences", () => ({
  DEFAULT_TRADING_PREFERENCES: {
    autonomyMode: "approval_required",
    liveTradingEnabled: true,
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

vi.mock("./_core/polymarketAuth", () => ({
  fetchPolymarketMarkets: mocks.fetchPolymarketMarkets,
  validatePolymarketCredentials: vi.fn(),
  placePolymarketOrder: vi.fn(),
}));

vi.mock("./_core/crossBotStrategies", () => ({
  mergePlatformSignals: vi.fn(),
  executeCrossArbLegs: mocks.executeCrossArbLegs,
}));

vi.mock("./_core/userMutex", () => ({
  withUserLock: mocks.withUserLock,
}));

vi.mock("./_core/kalshiExecution", () => ({
  placeKalshiOrder: vi.fn(),
  cancelKalshiOrder: vi.fn(),
  getKalshiOrderStatus: vi.fn(),
  closeKalshiPosition: vi.fn(),
  activateKalshiKillSwitch: vi.fn(),
}));

vi.mock("./_core/kalshiMarketData", () => ({
  fetchKalshiMarkets: vi.fn(async () => []),
  fetchKalshiMarketDetails: mocks.fetchKalshiMarketDetails,
}));

import { appRouter } from "./routers";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createProtectedContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "arb-user",
    email: "arb@example.com",
    name: "Arb User",
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
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    paperTradeMode: false,
  };
}

describe("cross-arb router execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withUserLock.mockImplementation(async (_uid: number, fn: () => Promise<unknown>) => fn());
    mocks.isUserSubscribedToPolymarket.mockResolvedValue(true);
    mocks.getKalshiCredentials.mockResolvedValue({
      userId: 1,
      accountStatus: "connected",
      apiKey: "k",
      privateKey: "p",
    });
    mocks.getPolymarketCredentials.mockResolvedValue({
      userId: 1,
      accountStatus: "connected",
      apiKey: "k",
      apiSecret: "s",
      apiPassphrase: "p",
    });
    mocks.getTradingPreferences.mockResolvedValue({
      liveTradingEnabled: true,
      maxOrderNotional: 10,
      maxDailyOrders: 3,
    });
    mocks.getKalshiCapital.mockResolvedValue({ currentBalance: 100, startingBalance: 100 });
    mocks.getOpenKalshiPositions.mockResolvedValue([]);
    mocks.getTodayRealizedLoss.mockResolvedValue(0);
    mocks.getTodayKalshiOrderCount.mockResolvedValue(0);
    mocks.fetchPolymarketMarkets.mockResolvedValue([
      {
        marketId: "PM-1",
        question: "Will X happen?",
        category: "politics",
        impliedProbabilityYes: 0.5,
        liquidity: 1000,
        tokens: [
          { outcome: "Yes", token_id: "tok-yes", price: 0.55 },
          { outcome: "No", token_id: "tok-no", price: 0.45 },
        ],
      },
    ]);
    mocks.fetchKalshiMarketDetails.mockResolvedValue({
      id: "K-1",
      title: "Will X happen?",
      category: "politics",
      yesPrice: 0.42,
      noPrice: 0.58,
      yesVolume: 1000,
      noVolume: 1000,
      impliedProbability: 0.42,
      status: "open",
    });
    mocks.executeCrossArbLegs.mockResolvedValue({
      success: true,
      bothLegsExecuted: true,
      kalshiLeg: { attempted: true, success: true, orderId: "k-1" },
      polymarketLeg: { attempted: true, success: true, orderId: "p-1" },
      partialLegAction: "hold",
      unhedgedFraction: 0,
      reasoning: "Both legs executed.",
    });
    mocks.logAuditEvent.mockResolvedValue(true);
    mocks.saveCrossPlatformArbitrageExecution.mockResolvedValue(undefined);
  });

  it("returns execution success even if persistence write fails", async () => {
    mocks.saveCrossPlatformArbitrageExecution.mockRejectedValueOnce(new Error("db down"));
    const caller = appRouter.createCaller(createProtectedContext());

    const result = await caller.crossBot.executeCrossArb({
      kalshiMarketId: "K-1",
      kalshiYesPrice: 0.42,
      polymarketMarketId: "PM-1",
      polymarketYesPrice: 0.55,
      buyPlatform: "kalshi",
      netEdge: 0.12,
      kalshiContracts: 5,
      polymarketSizeUsdc: 10,
    });

    expect(result.success).toBe(true);
    if ("reasoning" in result) {
      expect(result.reasoning).toContain("Persistence warning");
    }
  });

  it("blocks cross-arb execution when net edge is below threshold", async () => {
    mocks.fetchPolymarketMarkets.mockResolvedValueOnce([
      {
        marketId: "PM-1",
        question: "Will X happen?",
        category: "politics",
        impliedProbabilityYes: 0.46,
        liquidity: 1000,
        tokens: [
          { outcome: "Yes", token_id: "tok-yes", price: 0.46 },
          { outcome: "No", token_id: "tok-no", price: 0.54 },
        ],
      },
    ]);

    const caller = appRouter.createCaller(createProtectedContext());

    const result = await caller.crossBot.executeCrossArb({
      kalshiMarketId: "K-1",
      kalshiYesPrice: 0.42,
      polymarketMarketId: "PM-1",
      polymarketYesPrice: 0.55,
      buyPlatform: "kalshi",
      netEdge: 0.05,
      kalshiContracts: 5,
      polymarketSizeUsdc: 10,
    });

    expect(result.success).toBe(false);
    if ("error" in result) {
      expect(result.error).toContain("must exceed 5%");
    }
  });

  it("blocks cross-arb execution when polymarket risk validation fails", async () => {
    mocks.getTradingPreferences.mockResolvedValueOnce({
      liveTradingEnabled: true,
      maxOrderNotional: 10,
      maxDailyOrders: 3,
    });

    const caller = appRouter.createCaller(createProtectedContext());

    const result = await caller.crossBot.executeCrossArb({
      kalshiMarketId: "K-1",
      kalshiYesPrice: 0.42,
      polymarketMarketId: "PM-1",
      polymarketYesPrice: 0.55,
      buyPlatform: "kalshi",
      netEdge: 0.12,
      kalshiContracts: 5,
      polymarketSizeUsdc: 50,
    });

    expect(result.success).toBe(false);
    if ("error" in result) {
      expect(result.error).toContain("Polymarket risk check failed");
    }
    expect(mocks.executeCrossArbLegs).not.toHaveBeenCalled();
  });
});
