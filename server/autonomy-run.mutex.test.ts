import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/distributedLock", () => ({
  acquireTypedLock: vi.fn(),
  createOrderSyncLock: vi.fn().mockReturnValue({ acquire: vi.fn().mockResolvedValue({ holderId: "h1", release: vi.fn() }) }),
}));

// Copy mocks from server/kalshi.autonomy.shadowMode.test.ts to satisfy the rest of the function's deps:
vi.mock("./db", () => ({
  createAutonomyRun: vi.fn().mockResolvedValue({ id: 1, runId: "run-1" }),
  updateAutonomyRun: vi.fn().mockResolvedValue({}),
  logAuditEvent: vi.fn().mockResolvedValue(true),
  getLatestAutonomyRun: vi.fn().mockResolvedValue(null),
  getLatestAuditEventByType: vi.fn().mockResolvedValue(null),
  getKalshiCapital: vi.fn().mockResolvedValue({ currentBalance: 100 }),
  getTodayRealizedLoss: vi.fn().mockResolvedValue(0),
  getOpenPositions: vi.fn().mockResolvedValue([]),
}));
vi.mock("./db.kalshi-credentials", () => ({
  getKalshiCredentials: vi.fn().mockResolvedValue({ apiKey: "k", privateKey: "pk" }),
}));
vi.mock("./db.trading-preferences", () => ({
  getTradingPreferences: vi.fn().mockResolvedValue({
    autonomyMode: "fully_autonomous",
    liveTradingEnabled: true,
    executionCadence: "continuous_watch",
    riskPosture: "balanced",
    minSignalConfidence: 0.72,
    maxOrderNotional: 10,
    maxDailyOrders: 3,
    requireApprovalAbove: 8,
    kalshiMode: "shadow",
    polymarketMode: "shadow",
    kalshiPaused: 0,
    polymarketPaused: 0,
    kalshiLiveStartedAt: null,
    rampWindowHours: 72,
    rampSizeMultiplier: 0.25,
    drawdownWarnPct: 5,
    drawdownPausePct: 10,
    drawdownPanicPct: 20,
    pendingReconcileThresholdSeconds: 120,
  }),
  saveTradingPreferences: vi.fn(),
}));
vi.mock("./_core/kalshiMarketData", () => ({
  fetchKalshiMarkets: vi.fn().mockResolvedValue([]),
  fetchKalshiMarketDetails: vi.fn().mockResolvedValue(null),
}));
vi.mock("./_core/kalshiSignals", () => ({
  generateSignalsForMarkets: vi.fn().mockResolvedValue([]),
  filterSignalsByConfidence: vi.fn((s: unknown[]) => s),
  filterSignalsByMarketConditions: vi.fn((s: unknown[]) => s),
  getTopSignalsForExecution: vi.fn((s: unknown[]) => s),
  saveSignals: vi.fn().mockResolvedValue([]),
}));
vi.mock("./_core/tradingReviewer", () => ({
  reviewSignalsWithTrader: vi.fn().mockResolvedValue([]),
}));
vi.mock("./_core/kalshiAuth", () => ({
  fetchKalshiAccountEquity: vi.fn().mockResolvedValue({ equity: 100 }),
}));
vi.mock("./_core/kalshiMarketFeed", () => ({
  getMarketFeed: vi.fn().mockReturnValue(null),
  isMarketDataStale: vi.fn().mockReturnValue(false),
}));
vi.mock("./_core/kalshiOrderSync", () => ({ syncPendingOrders: vi.fn().mockResolvedValue([]) }));
vi.mock("./_core/alerting", () => ({
  alertIfConsecutiveFailures: vi.fn(),
  alertEquityDrop: vi.fn(),
  alertExchangeRejection: vi.fn(),
  alertAiReviewerFailure: vi.fn(),
  alertDrawdown: vi.fn(),
}));
vi.mock("./_core/aiToolbelt", () => ({
  getCacheHitRatio: vi.fn().mockReturnValue(0),
  newReviewerTelemetry: vi.fn().mockReturnValue({ calls: 0, failures: 0, signalsApproved: 0 }),
}));
vi.mock("./db.training", () => ({
  getUserTrainingInstructions: vi.fn().mockResolvedValue([]),
  isInstructionActiveNow: vi.fn().mockReturnValue(true),
  applyInstructionsToSignals: vi.fn((s: unknown[]) => s),
}));
vi.mock("./_core/drawdownEngine", () => ({
  evaluateDrawdown: vi.fn().mockResolvedValue({ tier: "ok", lossPct: 0, shouldPause: false }),
}));

global.fetch = vi.fn();

import { runScheduledAutonomousTrading } from "./_core/kalshiAutonomy";
import { acquireTypedLock } from "./_core/distributedLock";

const mockUser = {
  id: 1, openId: "user-1", name: "Test", email: "t@t.com",
  role: "user" as const, betaAccessLevel: "public" as const,
  twoFactorSecret: null, twoFactorEnabled: 0, backupCodesHash: null,
  lastSignedIn: null, createdAt: new Date(),
};

describe("runScheduledAutonomousTrading mutex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns skipped_locked when lock acquire fails", async () => {
    vi.mocked(acquireTypedLock).mockResolvedValue(null);
    const result = await runScheduledAutonomousTrading(mockUser);
    expect(result?.status).toBe("skipped_locked");
  });

  it("releases lock on successful completion", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    vi.mocked(acquireTypedLock).mockResolvedValue({ holderId: "h1", release, heartbeat });
    await runScheduledAutonomousTrading(mockUser);
    expect(release).toHaveBeenCalled();
  });
});
