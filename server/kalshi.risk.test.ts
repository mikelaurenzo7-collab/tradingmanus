import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  logAuditEvent: vi.fn(),
  activateKalshiKillSwitch: vi.fn(),
  fetchKalshiMarkets: vi.fn(),
}));

vi.mock("./db", () => ({
  logAuditEvent: mocks.logAuditEvent,
  getKalshiCapital: vi.fn(),
  initializeKalshiCapital: vi.fn(),
  getRecentSignals: vi.fn(async () => []),
  getAuditLog: vi.fn(async () => []),
}));

vi.mock("./_core/kalshiMarketData", () => ({
  fetchKalshiMarkets: mocks.fetchKalshiMarkets,
}));

vi.mock("./_core/kalshiExecution", () => ({
  placeKalshiOrder: vi.fn(),
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

describe("kalshi risk controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the hard risk limits for the $100 account", async () => {
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
