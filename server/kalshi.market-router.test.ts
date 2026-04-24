import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  fetchKalshiMarkets: vi.fn(),
  fetchKalshiMarketDetails: vi.fn(),
  upsertKalshiMarket: vi.fn(),
  getKalshiTradeHistory: vi.fn(),
  getKalshiCapital: vi.fn(),
  getOpenKalshiPositions: vi.fn(),
  getRecentSignals: vi.fn(),
}));

vi.mock("./db", () => ({
  upsertKalshiMarket: mocks.upsertKalshiMarket,
  logAuditEvent: vi.fn(),
  getKalshiCapital: mocks.getKalshiCapital,
  getOpenKalshiPositions: mocks.getOpenKalshiPositions,
  getTodayRealizedLoss: vi.fn(async () => 0),
  initializeKalshiCapital: vi.fn(),
  getRecentSignals: mocks.getRecentSignals,
  getAuditLog: vi.fn(async () => []),
  getKalshiTradeHistory: mocks.getKalshiTradeHistory,
}));

vi.mock("./_core/kalshiMarketData", () => ({
  fetchKalshiMarkets: mocks.fetchKalshiMarkets,
  fetchKalshiMarketDetails: mocks.fetchKalshiMarketDetails,
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

import { appRouter } from "./routers";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createProtectedContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "market-user",
    email: "market@example.com",
    name: "Market User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("kalshi market-data router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getKalshiTradeHistory.mockResolvedValue([]);
    mocks.getKalshiCapital.mockResolvedValue({
      startingBalance: 100,
      currentBalance: 100,
    });
    mocks.getOpenKalshiPositions.mockResolvedValue([]);
    mocks.getRecentSignals.mockResolvedValue([]);
  });

  it("upserts each market returned by getMarkets", async () => {
    const markets = [
      {
        id: "FED-2026",
        title: "Fed cuts rates",
        category: "economics",
        description: "Test",
        resolutionDate: "2026-12-31",
        status: "open" as const,
        yesPrice: 55,
        noPrice: 45,
        yesVolume: 100,
        noVolume: 90,
        impliedProbability: 0.55,
      },
      {
        id: "CPI-2026",
        title: "CPI above target",
        category: "economics",
        description: "Test",
        resolutionDate: "2026-10-31",
        status: "open" as const,
        yesPrice: 48,
        noPrice: 52,
        yesVolume: 80,
        noVolume: 70,
        impliedProbability: 0.48,
      },
    ];
    mocks.fetchKalshiMarkets.mockResolvedValue(markets);

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.getMarkets();

    expect(result).toEqual(markets);
    expect(mocks.upsertKalshiMarket).toHaveBeenCalledTimes(2);
    expect(mocks.upsertKalshiMarket).toHaveBeenNthCalledWith(1, markets[0]);
    expect(mocks.upsertKalshiMarket).toHaveBeenNthCalledWith(2, markets[1]);
  });

  it("upserts the fetched market returned by getMarketDetails", async () => {
    const market = {
      id: "JOBS-2026",
      title: "Jobs growth strong",
      category: "economics",
      description: "Test",
      resolutionDate: "2026-09-30",
      status: "open" as const,
      yesPrice: 51,
      noPrice: 49,
      yesVolume: 75,
      noVolume: 68,
      impliedProbability: 0.51,
    };
    mocks.fetchKalshiMarketDetails.mockResolvedValue(market);

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.getMarketDetails({
      marketId: "JOBS-2026",
    });

    expect(result).toEqual(market);
    expect(mocks.fetchKalshiMarketDetails).toHaveBeenCalledWith("JOBS-2026");
    expect(mocks.upsertKalshiMarket).toHaveBeenCalledWith(market);
  });

  it("returns trade history using the requested limit", async () => {
    const history = [
      {
        id: 7,
        marketId: "CPI-2026",
        side: "yes",
        quantity: 3,
        entryPrice: 0.44,
        currentPrice: 0.57,
        positionStatus: "closed",
        realizedPnl: 0.39,
        unrealizedPnl: 0,
        closedAt: new Date("2026-04-20T12:00:00Z"),
      },
    ];
    mocks.getKalshiTradeHistory.mockResolvedValue(history);

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.getTradeHistory({ limit: 25 });

    expect(result).toEqual(history);
    expect(mocks.getKalshiTradeHistory).toHaveBeenCalledWith(25);
  });

  it("returns a truthful performance overview", async () => {
    mocks.getKalshiCapital.mockResolvedValue({
      startingBalance: 100,
      currentBalance: 104,
    });
    mocks.getOpenKalshiPositions.mockResolvedValue([{ unrealizedPnl: 1 }]);
    mocks.getRecentSignals.mockResolvedValue([
      {
        marketId: "FED-2026",
        signalType: "momentum",
        confidence: 0.75,
        expectedValue: 0.12,
      },
    ]);
    mocks.getKalshiTradeHistory.mockResolvedValue([
      {
        id: 1,
        marketId: "FED-2026",
        side: "yes",
        quantity: 10,
        entryPrice: 0.4,
        positionStatus: "closed",
        realizedPnl: 3,
        closedAt: new Date("2026-04-24T12:00:00Z"),
      },
    ]);

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.getPerformanceOverview();

    expect(result.startingBalance).toBe(100);
    expect(result.currentBalance).toBe(104);
    expect(result.metrics).toMatchObject({
      totalTrades: 1,
      winningTrades: 1,
      activePositions: 1,
      realizedPnL: 3,
      unrealizedPnL: 1,
      totalPnL: 4,
    });
    expect(result.signalPerformance).toEqual([
      expect.objectContaining({
        signalType: "momentum",
        totalSignals: 1,
        successfulSignals: 1,
        totalPnL: 3,
      }),
    ]);
  });
});
