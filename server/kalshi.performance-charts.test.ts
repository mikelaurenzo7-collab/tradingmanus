import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getKalshiEquityCurve: vi.fn(),
  getKalshiActivityHeatmap: vi.fn(),
  getPerformanceOverview: vi.fn(),
}));

vi.mock("./db", () => ({
  // Helpers under test
  getKalshiEquityCurve: mocks.getKalshiEquityCurve,
  getKalshiActivityHeatmap: mocks.getKalshiActivityHeatmap,
  // Other helpers reachable from the same router branch
  logAuditEvent: vi.fn(),
  getKalshiCapital: vi.fn(async () => ({ startingBalance: 100, currentBalance: 100 })),
  getOpenKalshiPositions: vi.fn(async () => []),
  getTodayRealizedLoss: vi.fn(async () => 0),
  initializeKalshiCapital: vi.fn(),
  getRecentSignals: vi.fn(async () => []),
  getAuditLog: vi.fn(async () => []),
  getRecentAutonomyRuns: vi.fn(async () => []),
  getKalshiTradeHistory: vi.fn(async () => []),
  upsertKalshiMarket: vi.fn(),
}));

vi.mock("./_core/kalshiLearning", () => ({
  getPerformanceOverview: mocks.getPerformanceOverview,
}));

import { appRouter } from "./routers";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createProtectedContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "perf-user",
    email: "perf@example.com",
    name: "Perf User",
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

describe("kalshi.getEquityCurve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns starting + current balance flat series when no closed trades exist", async () => {
    mocks.getPerformanceOverview.mockResolvedValue({
      startingBalance: 100,
      currentBalance: 73.42,
      metrics: { totalTrades: 0 },
    });
    mocks.getKalshiEquityCurve.mockResolvedValue([]);

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.getEquityCurve({ days: 30 });

    expect(result.hasHistory).toBe(false);
    expect(result.startingBalance).toBe(100);
    expect(result.currentBalance).toBe(73.42);
    expect(result.points).toHaveLength(2);
    expect(result.points[0].equity).toBe(100);
    expect(result.points[1].equity).toBe(73.42);
  });

  it("builds cumulative-equity series anchored at starting balance when trades exist", async () => {
    mocks.getPerformanceOverview.mockResolvedValue({
      startingBalance: 100,
      currentBalance: 112,
      metrics: { totalTrades: 3 },
    });
    mocks.getKalshiEquityCurve.mockResolvedValue([
      { date: "2026-04-01", realizedPnl: 5 },
      { date: "2026-04-02", realizedPnl: -2 },
      { date: "2026-04-05", realizedPnl: 8 },
    ]);

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.getEquityCurve({ days: 30 });

    expect(result.hasHistory).toBe(true);
    // Anchor + 3 daily points + today
    expect(result.points.length).toBeGreaterThanOrEqual(4);
    expect(result.points[0].equity).toBe(100); // starting balance anchor
    // Cumulative checks
    expect(result.points[1].equity).toBeCloseTo(105, 6);
    expect(result.points[2].equity).toBeCloseTo(103, 6);
    expect(result.points[3].equity).toBeCloseTo(111, 6);
    // Last point reflects live currentBalance
    expect(result.points[result.points.length - 1].equity).toBe(112);
  });

  it("propagates DB errors as INTERNAL_SERVER_ERROR", async () => {
    mocks.getPerformanceOverview.mockResolvedValue({
      startingBalance: 100,
      currentBalance: 100,
      metrics: { totalTrades: 0 },
    });
    mocks.getKalshiEquityCurve.mockRejectedValue(new Error("db down"));

    const caller = appRouter.createCaller(createProtectedContext());
    await expect(caller.kalshi.getEquityCurve({ days: 30 })).rejects.toThrow(
      /Unable to load equity curve/
    );
  });
});

describe("kalshi.getActivityHeatmap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the activity buckets unchanged from the DB helper", async () => {
    const buckets = [
      { dow: 1, hour: 14, count: 3 },
      { dow: 4, hour: 9, count: 1 },
    ];
    mocks.getKalshiActivityHeatmap.mockResolvedValue(buckets);

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.getActivityHeatmap({ days: 90 });

    expect(result.buckets).toEqual(buckets);
    expect(mocks.getKalshiActivityHeatmap).toHaveBeenCalledWith(1, 90);
  });

  it("propagates DB errors as INTERNAL_SERVER_ERROR", async () => {
    mocks.getKalshiActivityHeatmap.mockRejectedValue(new Error("db down"));

    const caller = appRouter.createCaller(createProtectedContext());
    await expect(caller.kalshi.getActivityHeatmap({ days: 90 })).rejects.toThrow(
      /Unable to load activity heatmap/
    );
  });
});
