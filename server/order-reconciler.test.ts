import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(true),
  transaction: vi.fn(async (fn) => fn({
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
  })),
  getPendingKalshiOrders: vi.fn(),
}));
vi.mock("./db.kalshi-credentials", () => ({
  getKalshiCredentials: vi.fn().mockResolvedValue({ apiKey: "k", privateKey: "pk" }),
}));
vi.mock("./db.trading-preferences", () => ({
  getTradingPreferences: vi.fn().mockResolvedValue({ pendingReconcileThresholdSeconds: 120 }),
}));
vi.mock("./_core/fetchWithRetry", () => ({
  fetchWithRetry: vi.fn(),
}));

import { reconcilePendingOrders } from "./_core/orderReconciler";
import * as db from "./db";
import { logAuditEvent } from "./db";
import { fetchWithRetry } from "./_core/fetchWithRetry";

const recentOrder = (overrides = {}) => ({
  id: 1,
  userId: 1,
  orderId: "ord-1",
  exchangeOrderId: "exch-1",
  status: "pending" as const,
  filledQuantity: 0,
  marketId: "MKT-1",
  side: "yes" as const,
  quantity: 5,
  limitPrice: 0.5,
  capitalAdjusted: 0,
  createdAt: new Date(Date.now() - 5 * 60 * 1000),
  ...overrides,
});

describe("reconcilePendingOrders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getPendingKalshiOrders).mockResolvedValue([recentOrder()] as never);
  });

  it("skips orders younger than threshold", async () => {
    const young = recentOrder({ createdAt: new Date(Date.now() - 30 * 1000) });
    vi.mocked(db.getPendingKalshiOrders).mockResolvedValue([young] as never);
    const result = await reconcilePendingOrders(1, "user:1");
    expect(result.skippedCount).toBe(1);
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it("marks order filled when exchange reports filled", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ order: { status: "filled", filled_quantity: 5, average_price: 0.55 } }),
    } as Response);
    const result = await reconcilePendingOrders(1, "user:1");
    expect(result.reconciledCount).toBe(1);
    expect(logAuditEvent).toHaveBeenCalledWith(
      "order_state_changed",
      expect.stringContaining("\"toStatus\":\"filled\""),
      "user:1",
    );
  });

  it("marks order cancelled when exchange reports cancelled", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ order: { status: "cancelled" } }),
    } as Response);
    const result = await reconcilePendingOrders(1, "user:1");
    expect(result.reconciledCount).toBe(1);
    expect(logAuditEvent).toHaveBeenCalledWith(
      "order_state_changed",
      expect.stringContaining("\"toStatus\":\"cancelled\""),
      "user:1",
    );
  });

  it("marks order lost when exchange returns 404", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as Response);
    const result = await reconcilePendingOrders(1, "user:1");
    expect(result.lostCount).toBe(1);
    expect(logAuditEvent).toHaveBeenCalledWith(
      "order_lost",
      expect.any(String),
      "user:1",
    );
  });

  it("does not mark lost on 5xx (transient)", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);
    const result = await reconcilePendingOrders(1, "user:1");
    expect(result.lostCount).toBe(0);
    expect(result.errorCount).toBe(1);
  });

  it("leaves order pending when exchange reports open", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ order: { status: "open" } }),
    } as Response);
    const result = await reconcilePendingOrders(1, "user:1");
    expect(result.unchangedCount).toBe(1);
  });
});
