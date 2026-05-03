import { logAuditEvent } from "../db";

export type OrderStatus = "pending" | "partial" | "filled" | "cancelled" | "lost";

export type OrderStatusSource =
  | "exchange_response"
  | "reconciler"
  | "cold_start"
  | "manual_cancel"
  | "kill_switch"
  | "panic_close";

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["pending", "partial", "filled", "cancelled", "lost"],
  partial: ["partial", "filled", "cancelled"],
  filled: ["filled"],
  cancelled: ["cancelled"],
  lost: ["lost"],
};

export function isAllowedTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface UpdateOrderStatusInput {
  orderId: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  source: OrderStatusSource;
  triggeredByOpenId: string;
  metadata?: Record<string, unknown>;
}

export async function emitStateTransitionAudit(input: UpdateOrderStatusInput): Promise<void> {
  if (!isAllowedTransition(input.fromStatus, input.toStatus)) {
    throw new Error(
      `Disallowed order status transition: ${input.fromStatus} → ${input.toStatus} for orderId=${input.orderId}`,
    );
  }
  if (input.fromStatus === input.toStatus) return;
  await logAuditEvent(
    "order_state_changed",
    JSON.stringify({
      orderId: input.orderId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      source: input.source,
      ...input.metadata,
    }),
    input.triggeredByOpenId,
  );
}
