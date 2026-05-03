import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so these are available when vi.mock factory runs (mock is hoisted to top)
const { txInsertMock, txUpdateMock, dbInsertMock, dbUpdateMock, transactionMock } = vi.hoisted(() => {
  const txInsertMock = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{ id: 1 }]) });
  const txUpdateMock = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });
  const dbInsertMock = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{ id: 1 }]) });
  const dbUpdateMock = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });
  const transactionMock = vi.fn(async (fn: (tx: { insert: typeof txInsertMock; update: typeof txUpdateMock }) => Promise<unknown>) =>
    fn({ insert: txInsertMock, update: txUpdateMock }),
  );
  return { txInsertMock, txUpdateMock, dbInsertMock, dbUpdateMock, transactionMock };
});

vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return {
    ...actual,
    default: {
      ...actual,
      createPrivateKey: vi.fn(() => ({ type: "private" })),
      sign: vi.fn(() => Buffer.from("fakesignature")),
      constants: actual.constants,
    },
    createPrivateKey: vi.fn(() => ({ type: "private" })),
    sign: vi.fn(() => Buffer.from("fakesignature")),
  };
});

vi.mock("./_core/tradingMode", () => ({
  getEffectiveMode: vi.fn().mockResolvedValue({ mode: "live", paused: false, reason: "live", source: "user_setting" }),
}));
vi.mock("./db", () => ({
  // the `db` named export is an object with insert/update/select/delete
  db: {
    insert: dbInsertMock,
    update: dbUpdateMock,
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  },
  transaction: transactionMock,
  logAuditEvent: vi.fn().mockResolvedValue(true),
  getKalshiCapital: vi.fn().mockResolvedValue({ currentBalance: 100, paperBalance: 0, startingBalance: 100 }),
}));
vi.mock("./db.kalshi-credentials", () => ({
  getKalshiCredentials: vi.fn().mockResolvedValue({ apiKey: "k", privateKey: "pk" }),
}));
vi.mock("./db.trading-preferences", () => ({
  getTradingPreferences: vi.fn().mockResolvedValue({
    kalshiMode: "live", kalshiPaused: 0, kalshiLiveStartedAt: null,
    rampWindowHours: 72, rampSizeMultiplier: 0.25, pendingReconcileThresholdSeconds: 120,
  }),
}));
vi.mock("./_core/rampWindow", () => ({
  applyRampWindowCap: vi.fn(() => ({ cappedSize: 5, cappedMaxDayLoss: 0, rampActive: false, hoursRemaining: 0 })),
}));
vi.mock("./_core/kalshiRisk", () => ({
  calculateKalshiBuyOrderRisk: vi.fn().mockReturnValue({ quantity: 5, limitPrice: 0.50 }),
  normalizeLimitPrice: vi.fn((p: number) => p),
  normalizeOrderQuantity: vi.fn((q: number) => q),
}));

global.fetch = vi.fn();

import { placeKalshiOrder } from "./_core/kalshiExecution";
import * as dbModule from "./db";

describe("placeKalshiOrder transactional", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set implementations after clearAllMocks
    txInsertMock.mockReturnValue({ values: vi.fn().mockResolvedValue([{ id: 1 }]) });
    txUpdateMock.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });
    dbInsertMock.mockReturnValue({ values: vi.fn().mockResolvedValue([{ id: 1 }]) });
    dbUpdateMock.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });
    transactionMock.mockImplementation(async (fn: (tx: { insert: typeof txInsertMock; update: typeof txUpdateMock }) => Promise<unknown>) =>
      fn({ insert: txInsertMock, update: txUpdateMock }),
    );
    const responseBody = JSON.stringify({ order: { order_id: "exch-123", status: "filled", filled_quantity: 5, average_price: 0.50 } });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => responseBody,
      json: async () => JSON.parse(responseBody),
    } as Response);
  });

  it("uses db.transaction for order writes (Phase 1 OR Phase 3)", async () => {
    await placeKalshiOrder(1, "MARKET-1", "yes", 5, 0.50);
    expect(dbModule.transaction).toHaveBeenCalled();
  });

  it("uses db.transaction for the pre-exchange order insert (Phase 1)", async () => {
    await placeKalshiOrder(1, "MARKET-1", "yes", 5, 0.50);
    // Phase 1: transaction should have been called and insert used inside it
    expect(dbModule.transaction).toHaveBeenCalled();
    expect(txInsertMock).toHaveBeenCalled();
  });

  it("uses transaction for both Phase 1 (insert) and Phase 3 (orderId update) writes", async () => {
    await placeKalshiOrder(1, "MARKET-1", "yes", 5, 0.50);
    // transaction should have been called at least twice:
    // once for Phase 1 (pre-exchange insert) and once for Phase 3 (post-exchange orderId update)
    expect(dbModule.transaction).toHaveBeenCalledTimes(2);
    // The insert mock (called inside the tx callback) is invoked for Phase 1
    expect(txInsertMock).toHaveBeenCalled();
    // The update mock (called inside the tx callback) is invoked for Phase 3
    expect(txUpdateMock).toHaveBeenCalled();
  });
});
