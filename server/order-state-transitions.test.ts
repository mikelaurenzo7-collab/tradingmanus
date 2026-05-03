import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(true),
}));

import { isAllowedTransition, ORDER_STATUS_TRANSITIONS, emitStateTransitionAudit } from "./_core/orderStateTransitions";
import { logAuditEvent } from "./db";

describe("isAllowedTransition", () => {
  it("allows pending → filled", () => {
    expect(isAllowedTransition("pending", "filled")).toBe(true);
  });

  it("allows pending → partial", () => {
    expect(isAllowedTransition("pending", "partial")).toBe(true);
  });

  it("allows pending → cancelled", () => {
    expect(isAllowedTransition("pending", "cancelled")).toBe(true);
  });

  it("allows pending → lost", () => {
    expect(isAllowedTransition("pending", "lost")).toBe(true);
  });

  it("allows partial → filled", () => {
    expect(isAllowedTransition("partial", "filled")).toBe(true);
  });

  it("allows partial → cancelled", () => {
    expect(isAllowedTransition("partial", "cancelled")).toBe(true);
  });

  it("rejects filled → pending (terminal)", () => {
    expect(isAllowedTransition("filled", "pending")).toBe(false);
  });

  it("rejects cancelled → filled (terminal)", () => {
    expect(isAllowedTransition("cancelled", "filled")).toBe(false);
  });

  it("rejects lost → filled (terminal)", () => {
    expect(isAllowedTransition("lost", "filled")).toBe(false);
  });

  it("allows same-state no-op", () => {
    expect(isAllowedTransition("filled", "filled")).toBe(true);
  });
});

describe("emitStateTransitionAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits order_state_changed for valid transition", async () => {
    await emitStateTransitionAudit({
      orderId: "ord-1", fromStatus: "pending", toStatus: "filled",
      source: "exchange_response", triggeredByOpenId: "user:1",
      metadata: { fillPrice: 0.55 },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      "order_state_changed",
      expect.stringContaining("\"toStatus\":\"filled\""),
      "user:1",
    );
  });

  it("throws on disallowed transition", async () => {
    await expect(
      emitStateTransitionAudit({
        orderId: "ord-1", fromStatus: "filled", toStatus: "pending",
        source: "manual_cancel", triggeredByOpenId: "user:1",
      }),
    ).rejects.toThrow("Disallowed order status transition");
  });

  it("is no-op for same-state transition", async () => {
    await emitStateTransitionAudit({
      orderId: "ord-1", fromStatus: "filled", toStatus: "filled",
      source: "reconciler", triggeredByOpenId: "user:1",
    });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
