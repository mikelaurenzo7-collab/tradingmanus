import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/orderReconciler", () => ({
  reconcilePendingOrders: vi.fn().mockResolvedValue({
    totalChecked: 2,
    reconciledCount: 1,
    skippedCount: 0,
    lostCount: 0,
    unchangedCount: 1,
    errorCount: 0,
  }),
}));
vi.mock("./db", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(true),
  getOwnerUserId: vi.fn().mockResolvedValue(1),
}));

import { runColdStartReconciliation } from "./_core/coldStart";
import { reconcilePendingOrders } from "./_core/orderReconciler";
import { logAuditEvent } from "./db";

describe("runColdStartReconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls reconcilePendingOrders for the owner", async () => {
    await runColdStartReconciliation();
    expect(reconcilePendingOrders).toHaveBeenCalledWith(1, "system:cold_start");
  });

  it("emits startup_reconciliation_complete audit event", async () => {
    await runColdStartReconciliation();
    expect(logAuditEvent).toHaveBeenCalledWith(
      "startup_reconciliation_complete",
      expect.stringContaining("\"reconciledCount\":1"),
      "system:cold_start",
    );
  });

  it("throws when reconciler throws (fail-safe)", async () => {
    vi.mocked(reconcilePendingOrders).mockRejectedValueOnce(new Error("DB down"));
    await expect(runColdStartReconciliation()).rejects.toThrow("DB down");
  });
});
