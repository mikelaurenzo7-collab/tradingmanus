/**
 * orderReconciler — pending-order reconciler for Kalshi.
 *
 * Queries the Kalshi REST API for every order stuck in `pending` or `partial`
 * state and atomically updates the local ledger + capital balance based on
 * exchange truth.
 *
 * Outcomes:
 *   filled   → update order + debit capital (idempotent via capitalAdjusted flag)
 *   partial  → update order + debit capital delta (idempotent)
 *   cancelled→ update order only
 *   open     → no-op (exchange still working the order)
 *   404      → mark order as "lost" + emit order_lost audit
 *   5xx      → transient; increment errorCount, do not change status
 */

import { fetchWithRetry } from "./fetchWithRetry";
import { getKalshiCredentials } from "../db.kalshi-credentials";
import { getTradingPreferences } from "../db.trading-preferences";
import { getPendingKalshiOrders, logAuditEvent, transaction } from "../db";
import { kalshiOrders, kalshiCapital } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { emitStateTransitionAudit, type OrderStatus } from "./orderStateTransitions";

const KALSHI_API_BASE = "https://api.elections.kalshi.com/trade-api/v2";

export interface ReconcileResult {
  totalChecked: number;
  reconciledCount: number;
  skippedCount: number;
  lostCount: number;
  unchangedCount: number;
  errorCount: number;
}

export async function reconcilePendingOrders(
  userId: number,
  triggeredByOpenId: string,
): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    totalChecked: 0,
    reconciledCount: 0,
    skippedCount: 0,
    lostCount: 0,
    unchangedCount: 0,
    errorCount: 0,
  };

  const prefs = await getTradingPreferences(userId);
  const thresholdMs = prefs.pendingReconcileThresholdSeconds * 1000;
  const orders = await getPendingKalshiOrders(userId);
  const creds = await getKalshiCredentials(userId);
  if (!creds || creds.needsReauth) return result;

  for (const order of orders) {
    result.totalChecked++;
    const ageMs = Date.now() - new Date(order.createdAt).getTime();
    if (ageMs < thresholdMs) {
      result.skippedCount++;
      continue;
    }

    // Prefer the exchange-assigned ID; fall back to our client-side order ID.
    const lookupId = order.exchangeOrderId ?? order.orderId;

    try {
      const response = await fetchWithRetry(
        `${KALSHI_API_BASE}/portfolio/orders/${lookupId}`,
        { headers: { Authorization: `Bearer ${creds.apiKey}` } },
        { maxAttempts: 1 }, // single attempt — the caller decides retry cadence
      );

      if (response.status === 404) {
        // Exchange has no record of the order — mark as lost.
        await transaction(async (tx) => {
          await tx
            .update(kalshiOrders)
            .set({ status: "lost", lastReconciledAt: new Date() })
            .where(eq(kalshiOrders.orderId, order.orderId));
        });

        await emitStateTransitionAudit({
          orderId: order.orderId,
          fromStatus: order.status as OrderStatus,
          toStatus: "lost",
          source: "reconciler",
          triggeredByOpenId,
          metadata: { marketId: order.marketId, ageSeconds: Math.round(ageMs / 1000) },
        });

        await logAuditEvent(
          "order_lost",
          JSON.stringify({
            orderId: order.orderId,
            marketId: order.marketId,
            side: order.side,
            quantity: order.quantity,
            ageSeconds: Math.round(ageMs / 1000),
          }),
          triggeredByOpenId,
        );

        result.lostCount++;
        continue;
      }

      if (!response.ok) {
        // 5xx or other transient error — do not change status.
        result.errorCount++;
        continue;
      }

      const json = await response.json() as { order?: { status?: string; filled_quantity?: number; average_price?: number } };
      const exchangeStatus = json.order?.status;

      if (exchangeStatus === "filled" || exchangeStatus === "partial") {
        const newStatus: OrderStatus = exchangeStatus === "filled" ? "filled" : "partial";
        const filledQty = Number(json.order?.filled_quantity ?? 0);
        const avgPrice = Number(json.order?.average_price ?? order.limitPrice);
        const capitalDelta = filledQty * avgPrice;
        const previousCapitalAdjusted = order.capitalAdjusted ?? 0;

        await transaction(async (tx) => {
          await tx
            .update(kalshiOrders)
            .set({
              status: newStatus,
              filledQuantity: filledQty,
              averagePrice: avgPrice,
              capitalAdjusted: 1,
              lastReconciledAt: new Date(),
            })
            .where(eq(kalshiOrders.orderId, order.orderId));

          // Only adjust capital once per fill event (idempotency guard).
          if (previousCapitalAdjusted === 0) {
            await tx
              .update(kalshiCapital)
              .set({ currentBalance: sql`${kalshiCapital.currentBalance} - ${capitalDelta}` })
              .where(eq(kalshiCapital.userId, order.userId));
          }
        });

        await emitStateTransitionAudit({
          orderId: order.orderId,
          fromStatus: order.status as OrderStatus,
          toStatus: newStatus,
          source: "reconciler",
          triggeredByOpenId,
          metadata: { filledQuantity: filledQty, averagePrice: avgPrice },
        });

        result.reconciledCount++;
      } else if (exchangeStatus === "cancelled") {
        await transaction(async (tx) => {
          await tx
            .update(kalshiOrders)
            .set({ status: "cancelled", lastReconciledAt: new Date() })
            .where(eq(kalshiOrders.orderId, order.orderId));
        });

        await emitStateTransitionAudit({
          orderId: order.orderId,
          fromStatus: order.status as OrderStatus,
          toStatus: "cancelled",
          source: "reconciler",
          triggeredByOpenId,
        });

        result.reconciledCount++;
      } else {
        // "open" or any other status the exchange uses for an active order.
        result.unchangedCount++;
      }
    } catch {
      result.errorCount++;
    }
  }

  return result;
}
