import { reconcilePendingOrders } from "./orderReconciler";
import { getOwnerUserId, logAuditEvent } from "../db";

/**
 * runColdStartReconciliation — runs once at process startup, before any
 * scheduled intervals begin.
 *
 * Fetches the owner's numeric DB id and calls reconcilePendingOrders so that
 * any orders that were left in `pending` or `partial` state across the
 * previous process lifetime are resolved against Kalshi exchange truth before
 * the new autonomy cycle can place conflicting orders.
 *
 * Throws on any failure so the caller (index.ts startup sequence) can abort
 * scheduler startup rather than running on stale state.
 */
export async function runColdStartReconciliation(): Promise<void> {
  const start = Date.now();
  const ownerUserId = await getOwnerUserId();
  if (!ownerUserId) return;
  const result = await reconcilePendingOrders(ownerUserId, "system:cold_start");
  await logAuditEvent(
    "startup_reconciliation_complete",
    JSON.stringify({ ...result, durationMs: Date.now() - start }),
    "system:cold_start",
  );
}
