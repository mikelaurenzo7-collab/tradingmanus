import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getKalshiCapital: vi.fn(),
  getKalshiTradeHistory: vi.fn(),
  getRecentSignals: vi.fn(),
  getOpenKalshiPositions: vi.fn(),
  getKalshiEquityCurve: vi.fn(),
  getRecentAutonomyRuns: vi.fn(),
}));

vi.mock("./db", () => ({
  upsertKalshiMarket: vi.fn(),
  logAuditEvent: vi.fn(),
  getKalshiCapital: mocks.getKalshiCapital,
  getOpenKalshiPositions: mocks.getOpenKalshiPositions,
  getTodayRealizedLoss: vi.fn(async () => 0),
  initializeKalshiCapital: vi.fn(),
  getRecentSignals: mocks.getRecentSignals,
  getAuditLog: vi.fn(async () => []),
  getRecentAutonomyRuns: mocks.getRecentAutonomyRuns,
  getKalshiTradeHistory: mocks.getKalshiTradeHistory,
  getKalshiEquityCurve: mocks.getKalshiEquityCurve,
}));

vi.mock("./_core/kalshiMarketData", () => ({
  fetchKalshiMarkets: vi.fn(),
  fetchKalshiMarketDetails: vi.fn(),
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
    openId: "resilience-user",
    email: "resilience@example.com",
    name: "Resilience User",
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

describe("kalshi dashboard resilience — tRPC router integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getKalshiCapital.mockResolvedValue({ startingBalance: 100, currentBalance: 100 });
    mocks.getKalshiTradeHistory.mockResolvedValue([]);
    mocks.getRecentSignals.mockResolvedValue([]);
    mocks.getOpenKalshiPositions.mockResolvedValue([]);
    mocks.getKalshiEquityCurve.mockResolvedValue([]);
    mocks.getRecentAutonomyRuns.mockResolvedValue([]);
  });

  it("returns a usable degraded response when getKalshiTradeHistory throws (schema-drift simulation)", async () => {
    // Simulates a Railway schema-drift column error on the trades table.
    // Capital, signals, and open positions all succeed; only trade history fails.
    mocks.getKalshiTradeHistory.mockRejectedValue(
      new Error('column "positionTicker" does not exist')
    );

    const caller = appRouter.createCaller(createProtectedContext());
    // Must NOT throw — the dashboard route is fail-soft.
    const result = await caller.kalshi.getPerformanceOverview();

    // Capital was available so balances are still surfaced.
    expect(result.startingBalance).toBe(100);
    expect(result.currentBalance).toBe(100);
    // Trades defaulted to an empty array → zero trade metrics.
    expect(result.metrics.totalTrades).toBe(0);
    expect(result.signalPerformance).toEqual([]);
  });

  it("returns startingBalance: 0 when getKalshiCapital throws but trade sub-query resolves", async () => {
    // Simulates a schema-drift error on the capital table while trades are fine.
    mocks.getKalshiCapital.mockRejectedValue(
      new Error('relation "kalshi_capital" does not exist')
    );
    mocks.getKalshiTradeHistory.mockResolvedValue([
      {
        marketId: "FED-2026",
        entryPrice: 0.5,
        quantity: 5,
        realizedPnl: 2,
        positionStatus: "closed",
        closedAt: new Date(),
      },
    ]);

    const caller = appRouter.createCaller(createProtectedContext());
    // Must NOT throw — the dashboard is still usable without capital data.
    const result = await caller.kalshi.getPerformanceOverview();

    // Capital failed → null → zero-default for both balance fields.
    expect(result.startingBalance).toBe(0);
    // PnL from resolved trade (realizedPnl: 2) is still accumulated.
    expect(result.currentBalance).toBe(2);
  });

  it("propagates a TRPCError when getKalshiEquityCurve throws (chart route is NOT fail-soft)", async () => {
    // getEquityCurve is a chart-specific route and deliberately propagates
    // errors rather than degrading gracefully, so callers can show a proper
    // error state instead of a blank or misleading chart.
    mocks.getKalshiEquityCurve.mockRejectedValue(new Error("equity curve query failed"));

    const caller = appRouter.createCaller(createProtectedContext());
    // Must throw — the equity curve route wraps errors in TRPCError.
    await expect(caller.kalshi.getEquityCurve()).rejects.toMatchObject({
      message: "Unable to load equity curve",
    });
  });
});
