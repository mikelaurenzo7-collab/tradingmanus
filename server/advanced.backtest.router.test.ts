import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createProtectedContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "backtest-user",
      email: "backtest@example.com",
      name: "Backtest User",
      role: "user",
      betaAccessLevel: "none" as const,
      twoFactorSecret: null,
      twoFactorEnabled: 0,
      backupCodesHash: null,
      createdAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
    paperTradeMode: false,
  };
}

const trades = [
  {
    marketId: "FED_1",
    entryPrice: 0.45,
    exitPrice: 0.54,
    size: 100,
    entryTime: 1,
    exitTime: 2,
    pnl: 9,
    pnlPercent: 0.2,
    side: "yes",
  },
  {
    marketId: "FED_2",
    entryPrice: 0.52,
    exitPrice: 0.47,
    size: 100,
    entryTime: 3,
    exitTime: 4,
    pnl: -5,
    pnlPercent: -0.0961538462,
    side: "no",
  },
  {
    marketId: "FED_3",
    entryPrice: 0.4,
    exitPrice: 0.48,
    size: 100,
    entryTime: 5,
    exitTime: 6,
    pnl: 8,
    pnlPercent: 0.2,
    side: "yes",
  },
  {
    marketId: "FED_4",
    entryPrice: 0.6,
    exitPrice: 0.54,
    size: 100,
    entryTime: 7,
    exitTime: 8,
    pnl: -6,
    pnlPercent: -0.1,
    side: "no",
  },
] as const;

describe("advanced.backtest.runAnalysis", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the same grouped analytics needed by the backtesting page in one protected POST-friendly call", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.05);
    const caller = appRouter.createCaller(createProtectedContext());

    const result = await caller.advanced.backtest.runAnalysis({
      trades: [...trades],
      startingCapital: 1000,
      iterations: 20,
      windowSize: 2,
    });

    expect(randomSpy).toHaveBeenCalled();
    expect(result.stats.totalTrades).toBe(4);
    expect(result.equityCurve).toEqual([1000, 1009, 1004, 1012, 1006]);
    expect(result.walkForward).toHaveLength(2);
    expect(result.monteCarlo.bestCase).toBeGreaterThanOrEqual(result.monteCarlo.worstCase);
  });
});
