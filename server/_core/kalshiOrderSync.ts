/**
 * Kalshi Order Sync
 * Polls Kalshi for pending order fills and syncs live positions into the local DB.
 */

import { db } from "../db";
import { kalshiOrders, kalshiPositions } from "../../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getKalshiOrderStatus, createPositionFromFill, closePositionFromFill } from "./kalshiExecution";
import * as kalshiCredDb from "../db.kalshi-credentials";
import { assertPositiveIntegerUserId } from "./userScope";
import { logger } from "./logger";
import { centsToDollars } from "./kalshiMarketData";
import { fetchWithRetry } from "./fetchWithRetry";
import { CircuitBreaker } from "./circuitBreaker";

/**
 * Shared circuit breaker for all Kalshi order-sync HTTP calls.
 * Trips after 5 failures in 30 s, fails fast for 30 s, then half-open probe.
 */
const kalshiOrderSyncBreaker = new CircuitBreaker({
  name: "kalshiOrderSync",
  failureThreshold: 5,
  windowMs: 30_000,
  cooldownMs: 30_000,
});

// Guards against two concurrent sync intervals processing the same user's pending orders
const _syncRunningByUser = new Set<string>();

// Per-orderId consecutive-failure counter.  When the same order fails to
// sync for N consecutive ticks we escalate to an alert so the operator
// learns the sync is broken (rather than silently logging warnings every
// 30 s indefinitely).  Reset on the first successful sync.
const ORDER_SYNC_ALERT_THRESHOLD = 3;
const _orderSyncFailureCount = new Map<string, number>();

function getUserSyncKey(userId: number) {
  return `user:${assertPositiveIntegerUserId(userId, "order sync userId")}`;
}

/**
 * Check all locally-pending orders for the user; mark filled ones and
 * create position records from any newly-filled orders.
 * Idempotent: skips if a position for the same market is already open.
 */
export async function syncPendingOrders(userId: number): Promise<void> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "syncPendingOrders userId");
  const syncKey = getUserSyncKey(scopedUserId);
  if (_syncRunningByUser.has(syncKey)) return;
  _syncRunningByUser.add(syncKey);

  try {
    const creds = await kalshiCredDb.getKalshiCredentials(scopedUserId);
    if (!creds) return;
    if ("needsReauth" in creds && creds.needsReauth) {
      logger.warn({ userId: scopedUserId }, "[OrderSync] Skipping user %d: credentials require re-authentication", scopedUserId);
      return;
    }
    if (!creds.apiKey || !creds.privateKey) return;

    const pending = await db
      .select()
      .from(kalshiOrders)
      .where(and(eq(kalshiOrders.userId, scopedUserId), eq(kalshiOrders.status, "pending")));

    for (const order of pending) {
      try {
        const updated = await getKalshiOrderStatus(scopedUserId, order.orderId);
        if (!updated) continue;

        // Terminal non-filled statuses: clear from pending so they don't accumulate
        // in the DB indefinitely, inflate pending counts, or trigger false alerts.
        if (
          updated.status === "cancelled" ||
          updated.status === "rejected"
        ) {
          await db
            .update(kalshiOrders)
            .set({ status: updated.status as "cancelled" | "rejected", cancelledAt: new Date() })
            .where(eq(kalshiOrders.orderId, order.orderId));
          _orderSyncFailureCount.delete(order.orderId);
          continue;
        }

        if (updated.status === "filled" && updated.filledQuantity > 0) {
          if ((order.action ?? "buy") === "sell") {
            const closed = await closePositionFromFill(
              scopedUserId,
              order.marketId,
              order.side as "yes" | "no",
              updated.filledQuantity,
              updated.averagePrice > 0 ? updated.averagePrice : order.limitPrice,
            );

            if (!closed) {
              logger.warn({ orderId: order.orderId }, "[OrderSync] Filled close order %s had no matching open position", order.orderId);
            }
            continue;
          }

          // Idempotency guard: skip if an open position already exists for this market
          const existingOpen = await db
            .select()
            .from(kalshiPositions)
            .where(
              and(
                eq(kalshiPositions.userId, scopedUserId),
                eq(kalshiPositions.marketId, order.marketId),
                inArray(kalshiPositions.positionStatus, ["open", "closing"]),
              ),
            )
            .then((rows: any[]) => rows[0]);

          if (existingOpen) {
            logger.info({ marketId: order.marketId }, "[OrderSync] Position for %s already exists, skipping", order.marketId);
            continue;
          }

          const fillPrice =
            updated.averagePrice > 0 ? updated.averagePrice : order.limitPrice;

          await createPositionFromFill(
            scopedUserId,
            order.orderId,
            order.marketId,
            order.side as "yes" | "no",
            updated.filledQuantity,
            fillPrice,
          );
        }
        // Successful sync — reset any prior consecutive-failure count.
        _orderSyncFailureCount.delete(order.orderId);
      } catch (err) {
        const next = (_orderSyncFailureCount.get(order.orderId) ?? 0) + 1;
        _orderSyncFailureCount.set(order.orderId, next);
        logger.error(
          { err, orderId: order.orderId, consecutiveFailures: next },
          "[OrderSync] Failed to sync order %s (consecutive failures: %d)",
          order.orderId,
          next,
        );
        if (next === ORDER_SYNC_ALERT_THRESHOLD) {
          // Lazy-import to avoid pulling alerting into the import graph at
          // module load (alerting depends on env validation that some tests
          // mock).  Fire-and-forget — alerting must never block sync.
          import("./alerting").then(({ alertExchangeRejection }) => {
            void alertExchangeRejection(scopedUserId, order.orderId, {
              marketId: order.marketId,
              side: order.side as "yes" | "no",
              quantity: order.quantity ?? 0,
              limitPrice: Number(order.limitPrice ?? 0),
              error: `${ORDER_SYNC_ALERT_THRESHOLD} consecutive sync failures: ${err instanceof Error ? err.message : String(err)}`,
            });
          }).catch(() => {});
        }
      }
    }
  } finally {
    _syncRunningByUser.delete(syncKey);
  }
}

/**
 * Fetch live positions from Kalshi and upsert into local kalshiPositions table.
 * Kalshi API: GET /portfolio/positions
 */
export async function syncLivePositions(userId: number): Promise<void> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "syncLivePositions userId");
  const creds = await kalshiCredDb.getKalshiCredentials(scopedUserId);
  if (!creds) return;
  if ("needsReauth" in creds && creds.needsReauth) {
    logger.warn({ userId: scopedUserId }, "[OrderSync] Skipping syncLivePositions for user %d: credentials require re-authentication", scopedUserId);
    return;
  }
  if (!creds.apiKey || !creds.privateKey) return;

  try {
    const KALSHI_ENVIRONMENTS = [
      "https://api.elections.kalshi.com/trade-api/v2",
      "https://demo-api.kalshi.co/trade-api/v2",
    ];

    const crypto = await import("crypto");
    const { URL } = await import("url");

    const normalizeKey = (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed.includes("BEGIN") && trimmed.includes("PRIVATE KEY")) {
        return trimmed;
      }
      const body = trimmed
        .replace(/-----BEGIN PRIVATE KEY-----/g, "")
        .replace(/-----END PRIVATE KEY-----/g, "")
        .replace(/\s+/g, "");
      const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
      return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----`;
    };

    const buildHeaders = (url: string) => {
      const ts = Date.now().toString();
      const path = new URL(url).pathname;
      const sig = crypto.sign(
        "sha256",
        Buffer.from(`${ts}GET${path}`, "utf8"),
        {
          key: crypto.createPrivateKey({
            key: normalizeKey(creds.privateKey),
            format: "pem",
          }),
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
          saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
        },
      );
      return {
        Accept: "application/json",
        "KALSHI-ACCESS-KEY": creds.apiKey.trim(),
        "KALSHI-ACCESS-SIGNATURE": sig.toString("base64"),
        "KALSHI-ACCESS-TIMESTAMP": ts,
      };
    };

    let livePositions: any[] | null = null;

    for (const base of KALSHI_ENVIRONMENTS) {
      try {
        const url = `${base}/portfolio/positions`;
        const resp = await fetchWithRetry(
          url,
          { method: "GET", headers: buildHeaders(url) },
          { label: "kalshiOrderSync.syncLivePositions", breaker: kalshiOrderSyncBreaker },
        );
        if (!resp.ok) continue;
        const payload = await resp.json() as { market_positions?: any[]; positions?: any[] };
        livePositions = payload.market_positions ?? payload.positions ?? [];
        break;
      } catch {
        continue;
      }
    }

    if (!livePositions) return;

    const now = new Date();

    for (const pos of livePositions) {
      const marketId: string = pos.ticker ?? pos.market_id ?? "";
      if (!marketId) continue;

      const yesQty = Number(pos.position ?? pos.yes_position ?? 0);
      const noQty = Number(pos.no_position ?? 0);
      const side: "yes" | "no" = yesQty >= noQty ? "yes" : "no";
      const quantity = side === "yes" ? yesQty : noQty;
      if (quantity <= 0) continue;

      // Average price from Kalshi comes as cent-scale (0..100); convert via
      // the canonical boundary helper so this file never does a bare /100.
      const rawPrice = pos.average_price ?? pos.yes_price ?? pos.no_price;
      if (rawPrice === undefined || rawPrice === null) {
        logger.warn(
          { marketId },
          "[OrderSync] No price field on position %s; skipping upsert to avoid zeroing P&L",
          marketId,
        );
        continue;
      }
      const entryPrice = centsToDollars(rawPrice) ?? 0;
      const currentPrice = entryPrice;

      const existing = await db
        .select()
        .from(kalshiPositions)
        .where(
          and(
            eq(kalshiPositions.userId, scopedUserId),
            eq(kalshiPositions.marketId, marketId),
          )
        )
        .then((rows: any[]) => rows.find((r: any) => r.positionStatus === "open" || r.positionStatus === "closing"));

      if (existing) {
        await db
          .update(kalshiPositions)
          .set({
            quantity,
            currentPrice,
            unrealizedPnl:
              side === "yes"
                ? quantity * (currentPrice - Number(existing.entryPrice))
                : quantity * (Number(existing.entryPrice) - currentPrice),
          })
          .where(eq(kalshiPositions.id, existing.id));
      } else {
        await db.insert(kalshiPositions).values({
          userId: scopedUserId,
          marketId,
          side,
          quantity,
          entryPrice,
          currentPrice,
          unrealizedPnl: 0,
          realizedPnl: 0,
          positionStatus: "open",
          openedAt: now,
        });
      }
    }
  } catch (err) {
    logger.error({ err }, "[OrderSync] syncLivePositions failed");
  }
}
