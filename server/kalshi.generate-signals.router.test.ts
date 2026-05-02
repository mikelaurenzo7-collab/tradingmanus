import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getKalshiMarket: vi.fn(),
  logAuditEvent: vi.fn(),
  getMarketFeed: vi.fn(),
  generateSignalsForMarkets: vi.fn(),
  filterSignalsByConfidence: vi.fn(),
  saveSignals: vi.fn(),
}));

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return {
    ...actual,
    getKalshiMarket: mocks.getKalshiMarket,
    logAuditEvent: mocks.logAuditEvent,
  };
});

vi.mock("./_core/kalshiMarketFeed", async () => {
  const actual = await vi.importActual<typeof import("./_core/kalshiMarketFeed")>("./_core/kalshiMarketFeed");
  return {
    ...actual,
    getMarketFeed: mocks.getMarketFeed,
  };
});

vi.mock("./_core/kalshiSignals", async () => {
  const actual = await vi.importActual<typeof import("./_core/kalshiSignals")>("./_core/kalshiSignals");
  return {
    ...actual,
    generateSignalsForMarkets: mocks.generateSignalsForMarkets,
    filterSignalsByConfidence: mocks.filterSignalsByConfidence,
    saveSignals: mocks.saveSignals,
  };
});

import { appRouter } from "./routers";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createProtectedContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 42,
    openId: "signals-user",
    email: "signals@example.com",
    name: "Signals User",
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
  };
}

describe("kalshi.generateSignals router", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getMarketFeed.mockReturnValue(undefined);
    mocks.filterSignalsByConfidence.mockImplementation((signals: unknown) => signals);
    mocks.saveSignals.mockResolvedValue(undefined);
    mocks.logAuditEvent.mockResolvedValue(undefined);
  });

  it("threads market sentiment context into the live trading pipeline", async () => {
    const market = {
      id: "FED-2026",
      title: "Fed cuts rates",
      subtitle: "Will the Fed cut rates this quarter?",
      yesPrice: 0.61,
      noPrice: 0.39,
      impliedProbability: 0.61,
      volume24h: 22000,
      liquidity: 12000,
      closeTime: Date.now() + 7 * 24 * 60 * 60 * 1000,
      status: "open" as const,
      category: "economics",
      resolutionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };
    const routedSignal = {
      marketId: "FED-2026",
      signalType: "sentiment" as const,
      side: "yes" as const,
      confidence: 0.78,
      reasoning: "Composite sentiment favors YES",
      impliedProbability: 0.61,
      marketPrice: 0.61,
      expectedValue: 0.12,
    };

    mocks.getKalshiMarket.mockResolvedValue(market);
    mocks.generateSignalsForMarkets.mockResolvedValue([routedSignal]);

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.generateSignals({
      marketIds: ["FED-2026"],
      minConfidence: 0.5,
      fundamentalProbabilities: {
        "FED-2026": 0.67,
      },
    });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.signals)).toBe(true);
    expect(mocks.generateSignalsForMarkets).toHaveBeenCalledTimes(1);

    const [marketsArg, feedsArg, fundamentalArg, sentimentContextsArg] =
      mocks.generateSignalsForMarkets.mock.calls[0] as [
        Array<typeof market>,
        Map<string, unknown>,
        Map<string, number>,
        Map<string, { topic: string; marketSentiment: number }>
      ];

    expect(marketsArg).toHaveLength(1);
    expect(marketsArg[0]?.title).toBe("Fed cuts rates");
    expect(feedsArg).toBeInstanceOf(Map);
    expect(feedsArg.size).toBe(0);
    expect(fundamentalArg.get("FED-2026")).toBe(0.67);

    const routedContext = sentimentContextsArg.get("FED-2026");
    expect(routedContext?.topic).toBe("Fed cuts rates");
    expect(routedContext?.marketSentiment).toBeCloseTo(0.22, 5);

    expect(mocks.filterSignalsByConfidence).toHaveBeenCalledWith([routedSignal], 0.5);
    expect(mocks.saveSignals).toHaveBeenCalledWith(result.signals, 42);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "kalshi_signals_generated",
      expect.stringContaining(`"count":${result.signals.length}`),
      "signals-user"
    );
  });

  it("returns a soft failure when no requested markets are actionable", async () => {
    mocks.getKalshiMarket.mockResolvedValue(null);

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.generateSignals({
      marketIds: ["MISSING-2026"],
      minConfidence: 0.6,
    });

    expect(result).toEqual({
      success: false,
      signals: [],
      error: "No actionable markets found from the selected set",
    });
    expect(mocks.generateSignalsForMarkets).not.toHaveBeenCalled();
    expect(mocks.saveSignals).not.toHaveBeenCalled();
  });

  it("rejects zero-priced markets before signal generation", async () => {
    mocks.getKalshiMarket.mockResolvedValue({
      id: "BAD-2026",
      title: "Malformed market",
      yesPrice: 0,
      noPrice: 1,
      impliedProbability: 0,
      status: "open",
    });

    const caller = appRouter.createCaller(createProtectedContext());
    const result = await caller.kalshi.generateSignals({
      marketIds: ["BAD-2026"],
      minConfidence: 0.5,
    });

    expect(result).toEqual({
      success: false,
      signals: [],
      error: "No actionable markets found from the selected set",
    });
    expect(mocks.generateSignalsForMarkets).not.toHaveBeenCalled();
    expect(mocks.saveSignals).not.toHaveBeenCalled();
  });
});
