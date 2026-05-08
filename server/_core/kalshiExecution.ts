/**
 * Kalshi Execution Layer
 * Handles order placement, cancellation, and position management
 */

import crypto from "crypto";
import { URL } from "url";
import { db, logAuditEvent } from "../db";
import * as kalshiCredDb from "../db.kalshi-credentials";
import { kalshiOrders, kalshiFills, kalshiPositions } from "../../drizzle/schema";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { calculateKalshiBuyOrderRisk, normalizeLimitPrice, normalizeOrderQuantity } from "./kalshiRisk";
import { assertPositiveIntegerUserId } from "./userScope";
import { logger } from "./logger";
import { withUserLock } from "./userMutex";
import { normalizePrivateKey } from "./keyUtils";
import { ENV } from "./env";
import { getEffectivePaperTradeMode } from "./effectivePaperMode";
import { simulateKalshiOrderFill, simulateKalshiOrderCancellation, simulateKalshiPositionClose } from "./paperTrading";

export interface KalshiOrder {
  orderId: string;
  marketId: string;
  side: "yes" | "no";
  quantity: number;
  limitPrice: number;
  status: "pending" | "filled" | "cancelled" | "rejected";
  filledQuantity: number;
  averagePrice: number;
}

export interface KalshiFill {
  orderId: string;
  marketId: string;
  fillPrice: number;
  fillQuantity: number;
  fillTime: Date;
}

const KALSHI_ENVIRONMENTS = [
  "https://api.elections.kalshi.com/trade-api/v2",
  "https://demo-api.kalshi.co/trade-api/v2",
] as const;

type CredentialInput = {
  apiKey: string;
  privateKey: string;
};

function getScopedUserId(userId: number) {
  return assertPositiveIntegerUserId(userId, "Kalshi execution userId");
}

function normalizeExchangePrice(rawPrice: unknown) {
  const price = Number(rawPrice ?? 0);
  if (!Number.isFinite(price) || price <= 0) {
    return 0;
  }

  return price > 1 ? price / 100 : price;
}

async function resolveCredentials(
  userIdOrApiKey: number | string,
  privateKey?: string,
): Promise<CredentialInput | null> {
  if (typeof userIdOrApiKey === "number") {
    const stored = await kalshiCredDb.getKalshiCredentials(userIdOrApiKey);
    // `getKalshiCredentials` returns a discriminated union: when the stored
    // credential record signals `needsReauth: true` it does not include the
    // apiKey/privateKey fields. Narrow on that flag before touching them.
    if (!stored || ("needsReauth" in stored && stored.needsReauth)) {
      return null;
    }
    if (!stored.apiKey || !stored.privateKey) {
      return null;
    }

    return {
      apiKey: stored.apiKey,
      privateKey: stored.privateKey,
    };
  }

  if (typeof userIdOrApiKey === "string" && privateKey?.trim()) {
    return {
      apiKey: userIdOrApiKey,
      privateKey,
    };
  }

  return null;
}

function buildSignedHeaders(
  credentials: CredentialInput,
  method: string,
  requestUrl: string,
) {
  const timestamp = Date.now().toString();
  const path = new URL(requestUrl).pathname;
  const signature = crypto.sign(
    "sha256",
    Buffer.from(`${timestamp}${method.toUpperCase()}${path}`, "utf8"),
    {
      key: crypto.createPrivateKey({
        key: normalizePrivateKey(credentials.privateKey),
        format: "pem",
      }),
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    },
  );

  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "KALSHI-ACCESS-KEY": credentials.apiKey.trim(),
    "KALSHI-ACCESS-SIGNATURE": signature.toString("base64"),
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
  };
}

async function signedKalshiRequest<T>(
  userIdOrApiKey: number | string,
  method: string,
  path: string,
  options?: {
    privateKey?: string;
    body?: Record<string, unknown>;
  },
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const credentials = await resolveCredentials(userIdOrApiKey, options?.privateKey);
  if (!credentials) {
    return {
      ok: false,
      error: "No connected Kalshi credentials found. Connect your Kalshi account before trading.",
    };
  }

  const failures: string[] = [];

  for (const baseUrl of KALSHI_ENVIRONMENTS) {
    try {
      const url = `${baseUrl}${path}`;
      const response = await fetch(url, {
        method,
        headers: buildSignedHeaders(credentials, method, url),
        body: options?.body ? JSON.stringify(options.body) : undefined,
      });

      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};

      if (!response.ok) {
        const message =
          payload?.error?.message ||
          payload?.error ||
          payload?.message ||
          `HTTP ${response.status}`;
        failures.push(`${baseUrl}: ${message}`);
        continue;
      }

      return { ok: true, data: payload as T };
    } catch (error) {
      failures.push(`${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    ok: false,
    error: failures.join(" | ") || "Kalshi request failed",
  };
}

function toCents(price: number): number {
  return Math.max(1, Math.min(99, Math.round(price * 100)));
}

/**
 * Place an order on Kalshi
 * limitPrice must be in decimal dollar form (0.01–0.99); it is converted to cents internally.
 * If PAPER_TRADE_MODE is enabled, simulates an immediate fill at current market price.
 */
export async function placeKalshiOrder(
  userId: number,
  marketId: string,
  side: "yes" | "no",
  quantity: number,
  limitPrice: number,
  privateKey?: string,
): Promise<{
  success: boolean;
  orderId?: string;
  error?: string;
  needsReconciliation?: boolean;
  reconciliationReason?: string;
  exchangeRequest?: Record<string, unknown>;
  exchangeResponse?: Record<string, unknown>;
}> {
  // Route to paper trading simulator if enabled for this specific user.
  // Owner trades live by default; non-owner users are forced into paper.
  if (await getEffectivePaperTradeMode(userId)) {
    return simulateKalshiOrderFill(userId, marketId, side, quantity, limitPrice);
  }

  // Per-user mutex is acquired by CALLERS that don't already hold one:
  //   - server/_core/dailySportsPlay.ts (wraps its execute path in withUserLock)
  //   - server/_core/dailyMoonshotPlay.ts (same)
  //   - tRPC manual-place handler (also wraps)
  // The scheduled autonomy already wraps placeKalshiOrder in
  // withUserLock at runScheduledAutonomousTrading, so we don't acquire
  // again here — the userMutex queue is non-reentrant and a re-entry
  // attempt from the same async chain would deadlock.
  try {
    const risk = calculateKalshiBuyOrderRisk({ quantity, limitPrice });
    const priceCents = toCents(risk.limitPrice);
    const scopedUserId = getScopedUserId(userId);
    const clientOrderId = `nexus-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const body = {
      ticker: marketId,
      type: "limit",
      client_order_id: clientOrderId,
      action: "buy",
      side,
      count: risk.quantity,
      yes_price: side === "yes" ? priceCents : undefined,
      no_price: side === "no" ? priceCents : undefined,
      time_in_force: "good_till_cancelled",
      // ENV.preferMakerOrders=true (default) → post-only. Forces the order
      // to either rest as a maker (cheaper fee tier: 0.0175 × notional × p
      // × (1−p)) or be cancelled outright by Kalshi if it would cross the
      // book. The taker tier is 4× more expensive — a $4 trade pays $0.08
      // vs $0.02 — so post-only is on by default. Disable via env when
      // urgency outweighs fee savings.
      post_only: ENV.preferMakerOrders ? true : undefined,
    };

    // Write the local ledger row BEFORE submitting to the exchange so we
    // can never end up in a state where the exchange has the order but
    // our DB does not.  We use the client_order_id as the unique key
    // until the exchange returns its own orderId.  If this insert fails
    // we abort entirely and never call the exchange.
    try {
      await db.insert(kalshiOrders).values({
        userId: scopedUserId,
        orderId: clientOrderId,
        marketId,
        action: "buy",
        side,
        quantity: risk.quantity,
        limitPrice: risk.limitPrice,
        status: "pending",
        filledQuantity: 0,
        averagePrice: 0,
      });
    } catch (preWriteError) {
      logger.error(
        { err: preWriteError },
        "[Kalshi] Local ledger pre-write failed; refusing to submit order to exchange",
      );
      return {
        success: false,
        error:
          "Local ledger write failed before order submission; exchange was not contacted. " +
          (preWriteError instanceof Error ? preWriteError.message : String(preWriteError)),
        exchangeRequest: {
          marketId,
          action: "buy",
          side,
          quantity: risk.quantity,
          limitPrice: risk.limitPrice,
          clientOrderId,
        },
      };
    }

    const result = await signedKalshiRequest<{ order?: { order_id?: string; id?: string } }>(
      scopedUserId,
      "POST",
      "/portfolio/orders",
      {
        privateKey,
        body,
      },
    );

    if (!result.ok) {
      logger.error(
        { error: result.error, clientOrderId, marketId },
        "[Kalshi] Order placement failed",
      );
      // Mark the pre-written row as rejected so the local ledger reflects
      // the failed exchange call.  Best-effort: any failure here is logged
      // but does not change the surfaced error.
      try {
        await db
          .update(kalshiOrders)
          .set({ status: "rejected", cancelledAt: new Date() })
          .where(
            and(
              eq(kalshiOrders.orderId, clientOrderId),
              eq(kalshiOrders.userId, scopedUserId),
            ),
          );
      } catch (cleanupError) {
        logger.error(
          { err: cleanupError, clientOrderId },
          "[Kalshi] Failed to mark pre-written order as rejected",
        );
      }
      return {
        success: false,
        error: result.error,
        exchangeRequest: {
          marketId,
          action: "buy",
          side,
          quantity: risk.quantity,
          limitPrice: risk.limitPrice,
          clientOrderId,
        },
        exchangeResponse: {
          error: result.error,
        },
      };
    }

    const orderId = result.data.order?.order_id || result.data.order?.id;
    if (!orderId) {
      // Exchange responded ok but without an orderId — leave the row as
      // pending and surface a reconciliation error.
      return {
        success: false,
        error: "Kalshi order created without an order ID",
        needsReconciliation: true,
        reconciliationReason:
          "exchange returned no order ID; local ledger row remains pending under the client_order_id",
        exchangeRequest: {
          marketId,
          action: "buy",
          side,
          quantity: risk.quantity,
          limitPrice: risk.limitPrice,
          clientOrderId,
        },
        exchangeResponse: {
          order: result.data.order ?? null,
        },
      };
    }

    // Update the pre-written row with the exchange-issued orderId.  If
    // this update fails we still have the order on the exchange and a
    // pending local row keyed by clientOrderId — flag for reconciliation.
    try {
      await db
        .update(kalshiOrders)
        .set({ orderId })
        .where(
          and(
            eq(kalshiOrders.orderId, clientOrderId),
            eq(kalshiOrders.userId, scopedUserId),
          ),
        );
    } catch (storageError) {
      logger.error(
        { err: storageError, orderId, clientOrderId },
        "[Kalshi] Order accepted by Kalshi but local ledger update failed. Manual reconciliation required",
      );
      return {
        success: true,
        orderId,
        error:
          "Kalshi accepted the order, but updating the local ledger with the exchange order ID failed. " +
          "Verify the order on Kalshi before retrying.",
        needsReconciliation: true,
        reconciliationReason:
          "exchange accepted the order but the local order ledger update with the exchange order ID failed",
        exchangeRequest: {
          marketId,
          action: "buy",
          side,
          quantity: risk.quantity,
          limitPrice: risk.limitPrice,
          clientOrderId,
        },
        exchangeResponse: {
          orderId,
          order: result.data.order ?? null,
        },
      };
    }

    return {
      success: true,
      orderId,
      needsReconciliation: false,
      reconciliationReason: undefined,
      exchangeRequest: {
        marketId,
        action: "buy",
        side,
        quantity: risk.quantity,
        limitPrice: risk.limitPrice,
        clientOrderId,
      },
      exchangeResponse: {
        orderId,
        order: result.data.order ?? null,
      },
    };
  } catch (error) {
    logger.error({ err: error }, "[Kalshi] Order placement error");
    return {
      success: false,
      error: String(error),
      exchangeResponse: {
        error: String(error),
      },
    };
  }
}

/**
 * Cancel an order on Kalshi.
 *
 * Emits `kalshi_order_cancelled` on success and `kalshi_order_cancel_failed`
 * on any failure so that every cancellation outcome is captured in the audit
 * trail regardless of the call site.
 *
 * In paper mode, cancels from the local ledger only (no exchange call).
 *
 * @param triggeredByOpenId  The openId of the acting user.  Falls back to
 *   String(userId) when omitted so the audit assertion is always satisfied.
 */
export async function cancelKalshiOrder(
  userId: number,
  orderId: string,
  privateKey?: string,
  triggeredByOpenId?: string,
): Promise<{ success: boolean; error?: string }> {
  // Serialise per user: prevents TOCTOU races where two concurrent
  // cancellation requests both read stale order state and attempt to
  // cancel the same (or interleaved) orders simultaneously.
  return await withUserLock(userId, async () => {
    const scopedUserId = getScopedUserId(userId);
    // Fall back to a stringified userId when no openId is available so that
    // logAuditEvent's non-empty string assertion is always satisfied.
    const auditOpenId = triggeredByOpenId ?? String(scopedUserId);
    try {
      // In paper mode, cancel from local ledger only
      if (await getEffectivePaperTradeMode(userId)) {
        const result = await simulateKalshiOrderCancellation(userId, orderId);
        if (!result.success) {
          void logAuditEvent(
            "kalshi_order_cancel_failed",
            JSON.stringify({
              orderId,
              error: result.error,
              simulated: true,
            }),
            auditOpenId,
          ).catch((auditErr) =>
            logger.error({ err: auditErr, orderId }, "[Kalshi] Failed to write simulated order_cancel_failed audit event"),
          );
          return { success: false, error: result.error };
        }

        void logAuditEvent(
          "kalshi_order_cancelled",
          JSON.stringify({ orderId, simulated: true }),
          auditOpenId,
        ).catch((auditErr) =>
          logger.error({ err: auditErr, orderId }, "[Kalshi] Failed to write simulated order_cancelled audit event"),
        );

        return { success: true };
      }

      const result = await signedKalshiRequest<unknown>(
        scopedUserId,
        "DELETE",
        `/portfolio/orders/${orderId}`,
        { privateKey },
      );

      if (!result.ok) {
        logger.error({ error: result.error, orderId }, "[Kalshi] Cancel failed");
        // Best-effort audit: do not suppress the original error if logging fails.
        void logAuditEvent(
          "kalshi_order_cancel_failed",
          JSON.stringify({
            orderId,
            error: result.error,
          }),
          auditOpenId,
        ).catch((auditErr) =>
          logger.error({ err: auditErr, orderId }, "[Kalshi] Failed to write order_cancel_failed audit event"),
        );
        return { success: false, error: result.error };
      }

      await db
        .update(kalshiOrders)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(
          and(
            eq(kalshiOrders.orderId, orderId),
            eq(kalshiOrders.userId, scopedUserId),
          )
        );

      // Best-effort audit: do not fail the cancellation if logging fails.
      void logAuditEvent(
        "kalshi_order_cancelled",
        JSON.stringify({ orderId }),
        auditOpenId,
      ).catch((auditErr) =>
        logger.error({ err: auditErr, orderId }, "[Kalshi] Failed to write order_cancelled audit event"),
      );

      return { success: true };
    } catch (error) {
      logger.error({ err: error }, "[Kalshi] Cancel error");
      void logAuditEvent(
        "kalshi_order_cancel_failed",
        JSON.stringify({
          orderId,
          error: error instanceof Error ? error.message : String(error),
        }),
        auditOpenId,
      ).catch((auditErr) =>
        logger.error({ err: auditErr, orderId }, "[Kalshi] Failed to write order_cancel_failed audit event (exception path)"),
      );
      return { success: false, error: String(error) };
    }
  });
}

/**
 * Get order status from Kalshi
 */
export async function getKalshiOrderStatus(
  userId: number,
  orderId: string,
  privateKey?: string,
): Promise<KalshiOrder | null> {
  try {
    const scopedUserId = getScopedUserId(userId);
    const result = await signedKalshiRequest<{ order?: any }>(
      scopedUserId,
      "GET",
      `/portfolio/orders/${orderId}`,
      { privateKey },
    );

    if (!result.ok || !result.data.order) {
      logger.error(
        { error: result.ok ? "missing order" : result.error, orderId },
        "[Kalshi] Order status fetch failed",
      );
      return null;
    }

    const order = result.data.order;
    const rawStatus = String(order.status || "pending").toLowerCase();
    const normalizedStatus = rawStatus.includes("cancel")
      ? "cancelled"
      : rawStatus.includes("execut") || rawStatus.includes("fill")
        ? "filled"
        : rawStatus.includes("reject")
          ? "rejected"
          : "pending";

    const filledQuantity = Number(order.fill_count ?? order.fill_count_fp ?? 0);
    const averagePrice = normalizeExchangePrice(
      order.avg_price ??
        order.average_price ??
        order.price ??
        order.yes_price ??
        order.no_price ??
        0
    );

    await db
      .update(kalshiOrders)
      .set({
        status: normalizedStatus,
        filledQuantity,
        averagePrice,
        filledAt: normalizedStatus === "filled" ? new Date() : null,
      })
      .where(
        and(
          eq(kalshiOrders.orderId, orderId),
          eq(kalshiOrders.userId, scopedUserId),
        )
      );

    return {
      orderId: order.order_id || order.id,
      marketId: order.ticker || order.market_id,
      side: String(order.side || "yes").toLowerCase() === "no" ? "no" : "yes",
      quantity: Number(order.initial_count ?? order.initial_count_fp ?? 0),
      limitPrice: averagePrice,
      status: normalizedStatus,
      filledQuantity,
      averagePrice,
    };
  } catch (error) {
    logger.error({ err: error }, "[Kalshi] Order status error");
    return null;
  }
}

/**
 * Get all fills for an order
 */
export async function getKalshiOrderFills(
  userId: number,
  orderId: string,
  privateKey?: string,
): Promise<KalshiFill[]> {
  try {
    const scopedUserId = getScopedUserId(userId);
    const result = await signedKalshiRequest<{ fills?: any[] }>(
      scopedUserId,
      "GET",
      "/portfolio/fills",
      { privateKey },
    );

    if (!result.ok) {
      logger.error({ error: result.error, orderId }, "[Kalshi] Fills fetch failed");
      return [];
    }

    const fills = (result.data.fills || []).filter((fill) => {
      const fillOrderId = fill.order_id || fill.orderId;
      return !orderId || fillOrderId === orderId;
    });

    for (const fill of fills) {
      await db.insert(kalshiFills).values({
        userId: scopedUserId,
        orderId: fill.order_id || orderId,
        marketId: fill.ticker || fill.market_id,
        fillPrice: normalizeExchangePrice(fill.price ?? fill.yes_price ?? fill.no_price ?? 0),
        fillQuantity: Number(fill.count ?? fill.count_fp ?? 0),
        fillTime: new Date(fill.created_time || fill.timestamp || Date.now()),
      });
    }

    return fills.map((f: any) => ({
      orderId: f.order_id || orderId,
      marketId: f.ticker || f.market_id,
      fillPrice: normalizeExchangePrice(f.price ?? f.yes_price ?? f.no_price ?? 0),
      fillQuantity: Number(f.count ?? f.count_fp ?? 0),
      fillTime: new Date(f.created_time || f.timestamp || Date.now()),
    }));
  } catch (error) {
    logger.error({ err: error }, "[Kalshi] Fills fetch error");
    return [];
  }
}

/**
 * Get all open positions
 */
export async function getKalshiPositions(userId: number): Promise<any[]> {
  try {
    const scopedUserId = getScopedUserId(userId);
    const positions = await db
      .select()
      .from(kalshiPositions)
      .where(
        and(
          eq(kalshiPositions.userId, scopedUserId),
          inArray(kalshiPositions.positionStatus, ["open", "closing"]),
        )
      );
    return positions;
  } catch (error) {
    logger.error({ err: error }, "[Kalshi] Positions fetch error");
    return [];
  }
}

/**
 * Close a position.
 *
 * Emits `kalshi_position_closed` on success and `kalshi_position_close_failed`
 * on any failure so that every close attempt is captured in the audit trail
 * regardless of the call site.
 *
 * In paper mode, simulates an immediate fill at current market price.
 *
 * @param triggeredByOpenId  The openId of the acting user.  Falls back to
 *   String(userId) when omitted so the audit assertion is always satisfied.
 */
export async function closeKalshiPosition(
  userId: number,
  positionId: number,
  marketId: string,
  currentPrice: number,
  privateKey?: string,
  triggeredByOpenId?: string,
): Promise<{ success: boolean; error?: string; mode?: "exchange" | "local"; orderId?: string }> {
  // Serialise per user: prevents the TOCTOU race where a concurrent
  // placeOrder call reads stale position state while a close is in-flight,
  // potentially resulting in an over-sell or double-close.
  return await withUserLock(userId, async () => {
    const scopedUserId = getScopedUserId(userId);
    // Fall back to a stringified userId when no openId is available so that
    // logAuditEvent's non-empty string assertion is always satisfied.
    const auditOpenId = triggeredByOpenId ?? String(scopedUserId);
    try {
      normalizeLimitPrice(currentPrice, "currentPrice");
      const position = await db
        .select()
        .from(kalshiPositions)
        .where(
          and(
            eq(kalshiPositions.id, positionId),
            eq(kalshiPositions.userId, scopedUserId),
          )
        )
        .then((rows: any[]) => rows[0]);

      if (!position) {
        void logAuditEvent(
          "kalshi_position_close_failed",
          JSON.stringify({
            positionId,
            marketId,
            error: "Position not found",
          }),
          auditOpenId,
        ).catch((auditErr) =>
          logger.error({ err: auditErr, positionId }, "[Kalshi] Failed to write position_close_failed audit event"),
        );
        return { success: false, error: "Position not found" };
      }

      const entryPrice = Number(position.entryPrice ?? 0);
      const markPrice = Number(currentPrice ?? position.currentPrice ?? entryPrice);
      const quantity = normalizeOrderQuantity(Number(position.quantity ?? 0), Number.MAX_SAFE_INTEGER);
      const side = position.side as "yes" | "no";

      let orderId: string | undefined;

      // In paper mode, simulate the close without credentials
      if (await getEffectivePaperTradeMode(userId)) {
        const closeResult = await simulateKalshiPositionClose(userId, marketId, side, quantity, markPrice);
        if (!closeResult.success) {
          void logAuditEvent(
            "kalshi_position_close_failed",
            JSON.stringify({
              positionId,
              marketId,
              side,
              quantity,
              markPrice,
              error: closeResult.error,
              simulated: true,
            }),
            auditOpenId,
          ).catch((auditErr) =>
            logger.error({ err: auditErr, positionId }, "[Kalshi] Failed to write simulated position_close_failed audit event"),
          );
          return { success: false, error: closeResult.error };
        }

        // Update position status to closing in DB
        await db
          .update(kalshiPositions)
          .set({
            currentPrice: markPrice,
            positionStatus: "closing",
          })
          .where(
            and(
              eq(kalshiPositions.id, positionId),
              eq(kalshiPositions.userId, scopedUserId),
            )
          );

        orderId = closeResult.orderId;

        void logAuditEvent(
          "kalshi_position_closed",
          JSON.stringify({
            positionId,
            marketId,
            side,
            quantity,
            markPrice,
            orderId,
            simulated: true,
          }),
          auditOpenId,
        ).catch((auditErr) =>
          logger.error({ err: auditErr, positionId }, "[Kalshi] Failed to write simulated position_closed audit event"),
        );

        return { success: true, mode: "local", orderId };
      }

      const credentials = await resolveCredentials(scopedUserId, privateKey);
      if (!credentials) {
        void logAuditEvent(
          "kalshi_position_close_failed",
          JSON.stringify({
            positionId,
            marketId,
            side,
            quantity,
            error: "Cannot close a live Kalshi position without connected credentials.",
          }),
          auditOpenId,
        ).catch((auditErr) =>
          logger.error({ err: auditErr, positionId }, "[Kalshi] Failed to write position_close_failed audit event"),
        );
        return {
          success: false,
          error: "Cannot close a live Kalshi position without connected credentials.",
        };
      }

      const priceCents = toCents(markPrice);
      const closeBody = {
        ticker: marketId,
        type: "limit",
        client_order_id: `nexus-close-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        action: "sell",
        side,
        count: quantity,
        yes_price: side === "yes" ? priceCents : undefined,
        no_price: side === "no" ? priceCents : undefined,
        time_in_force: "good_till_cancelled",
        // Risk exits (stop-loss, profit-target, trailing-stop, kill-switch
        // via activateKalshiKillSwitch, and the auto-close path in
        // exitMonitor.ts) ALL flow through this function. They must be
        // able to take liquidity — Kalshi rejects post-only orders that
        // would cross the book, so a maker-only stop-loss can leave you
        // holding a losing position past your trigger. The 4× taker-fee
        // premium is a small price for guaranteed exit fills.
        //
        // Entry orders (placeKalshiOrder) still honor PREFER_MAKER_ORDERS
        // — opens are voluntary and can wait for better fills. Closes
        // can't.
      };

      const closeResult = await signedKalshiRequest<{ order?: { order_id?: string; id?: string } }>(
        scopedUserId,
        "POST",
        "/portfolio/orders",
        { privateKey, body: closeBody },
      );

      if (!closeResult.ok) {
        logger.error(
          { error: closeResult.error, positionId, marketId },
          "[Kalshi] Close position order failed",
        );
        // Best-effort audit: do not suppress the original error if logging fails.
        void logAuditEvent(
          "kalshi_position_close_failed",
          JSON.stringify({
            positionId,
            marketId,
            side,
            quantity,
            markPrice,
            error: closeResult.error,
          }),
          auditOpenId,
        ).catch((auditErr) =>
          logger.error({ err: auditErr, positionId }, "[Kalshi] Failed to write position_close_failed audit event"),
        );
        return { success: false, error: closeResult.error };
      }

      const closeOrderId = closeResult.data.order?.order_id || closeResult.data.order?.id;
      if (!closeOrderId) {
        void logAuditEvent(
          "kalshi_position_close_failed",
          JSON.stringify({
            positionId,
            marketId,
            side,
            quantity,
            markPrice,
            error: "Kalshi close order created without an order ID",
          }),
          auditOpenId,
        ).catch((auditErr) =>
          logger.error({ err: auditErr, positionId }, "[Kalshi] Failed to write position_close_failed audit event"),
        );
        return { success: false, error: "Kalshi close order created without an order ID" };
      }

      try {
        await db.insert(kalshiOrders).values({
          userId: scopedUserId,
          orderId: closeOrderId,
          marketId,
          action: "sell",
          side,
          quantity,
          limitPrice: markPrice,
          status: "pending",
          filledQuantity: 0,
          averagePrice: 0,
        });
      } catch (storageError) {
        logger.error(
          { err: storageError, closeOrderId, positionId, marketId },
          "[Kalshi] Close order accepted by Kalshi but local ledger write failed. Manual reconciliation required",
        );
      }

      await db
        .update(kalshiPositions)
        .set({
          currentPrice: markPrice,
          positionStatus: "closing",
        })
        .where(
          and(
            eq(kalshiPositions.id, positionId),
            eq(kalshiPositions.userId, scopedUserId),
          )
        );

      orderId = closeOrderId;

      // Best-effort audit: do not fail the close if logging fails.
      void logAuditEvent(
        "kalshi_position_closed",
        JSON.stringify({
          positionId,
          marketId,
          side,
          quantity,
          markPrice,
          orderId,
        }),
        auditOpenId,
      ).catch((auditErr) =>
        logger.error({ err: auditErr, positionId }, "[Kalshi] Failed to write position_closed audit event"),
      );

      return { success: true, mode: "exchange", orderId };
    } catch (error) {
      logger.error({ err: error, positionId, marketId }, "[Kalshi] Close position error");
      void logAuditEvent(
        "kalshi_position_close_failed",
        JSON.stringify({
          positionId,
          marketId,
          error: error instanceof Error ? error.message : String(error),
        }),
        auditOpenId,
      ).catch((auditErr) =>
        logger.error({ err: auditErr, positionId }, "[Kalshi] Failed to write position_close_failed audit event (exception path)"),
      );
      return { success: false, error: String(error) };
    }
  });
}

/**
 * Create a new position from a filled order
 */
export async function createPositionFromFill(
  userId: number,
  orderId: string,
  marketId: string,
  side: "yes" | "no",
  quantity: number,
  fillPrice: number,
): Promise<void> {
  try {
    const scopedUserId = getScopedUserId(userId);
    await db.insert(kalshiPositions).values({
      userId: scopedUserId,
      marketId,
      side,
      quantity,
      entryPrice: fillPrice,
      currentPrice: fillPrice,
      unrealizedPnl: 0,
      realizedPnl: 0,
      positionStatus: "open",
      openedAt: new Date(),
    });
  } catch (error) {
    logger.error({ err: error, marketId, orderId }, "[Kalshi] Create position error");
  }
}

export async function closePositionFromFill(
  userId: number,
  marketId: string,
  side: "yes" | "no",
  fillQuantity: number,
  fillPrice: number,
): Promise<boolean> {
  try {
    const scopedUserId = getScopedUserId(userId);
    const quantity = Number(fillQuantity);
    const exitPrice = normalizeExchangePrice(fillPrice);
    if (!Number.isFinite(quantity) || quantity <= 0 || exitPrice <= 0) {
      return false;
    }

    const position = await db
      .select()
      .from(kalshiPositions)
      .where(
        and(
          eq(kalshiPositions.userId, scopedUserId),
          eq(kalshiPositions.marketId, marketId),
          eq(kalshiPositions.side, side),
          inArray(kalshiPositions.positionStatus, ["open", "closing"]),
        )
      )
      .then((rows: any[]) => rows[0]);

    if (!position) {
      return false;
    }

    const entryPrice = Number(position.entryPrice ?? 0);
    const currentQuantity = Number(position.quantity ?? quantity);
    const closeQuantity = Math.min(currentQuantity, quantity);
    const realizedPnl =
      side === "yes"
        ? closeQuantity * (exitPrice - entryPrice)
        : closeQuantity * (entryPrice - exitPrice);
    const remainingQuantity = Math.max(0, currentQuantity - closeQuantity);

    if (remainingQuantity > 0.000001) {
      await db
        .update(kalshiPositions)
        .set({
          quantity: remainingQuantity,
          currentPrice: exitPrice,
          realizedPnl: Number(position.realizedPnl ?? 0) + realizedPnl,
          positionStatus: "closing",
        })
        .where(eq(kalshiPositions.id, position.id));

      return true;
    }

    // Compute the FULL trade aggregate before persisting `closed`. Earlier
    // partial-fill tranches accumulated into `position.realizedPnl`; this
    // tranche's PnL is in `realizedPnl` (local). The total realized PnL
    // for the whole trade is the sum.
    const totalRealizedPnl = Number(position.realizedPnl ?? 0) + realizedPnl;
    // Recover the ORIGINAL opened size by summing filled quantities of
    // every BUY order on this market+side+user that filled at-or-before
    // the position's openedAt → now. The position row alone can't
    // recover this after partial closes (its `quantity` field is the
    // REMAINING size, not the original), and we don't currently persist
    // an `openedQuantity` column. Reading from kalshiOrders gives us the
    // true total. Falls back to closeQuantity + currentQuantity if the
    // orders lookup fails.
    let originalCount = closeQuantity + Math.max(0, currentQuantity - closeQuantity);
    try {
      const { getDb } = await import("../db");
      const database = await getDb();
      if (database) {
        // Scope to orders created within ~1 hour BEFORE the position
        // opened. Two reasons for the back-slack:
        //   1. The opening order row in `kalshiOrders` is created BEFORE
        //      the position row (createPositionFromFill writes the
        //      position only after the fill is processed). A strict
        //      `gte(createdAt, position.openedAt)` excludes the opening
        //      order itself, leaving the sum empty.
        //   2. Prior closed positions on the same market+side are
        //      typically hours-to-days older — well outside a 1h window.
        const POSITION_OPENING_SLACK_MS = 60 * 60 * 1000;
        const positionOpenedAt = position.openedAt
          ? new Date(
              Math.max(
                0,
                new Date(position.openedAt).getTime() -
                  POSITION_OPENING_SLACK_MS,
              ),
            )
          : new Date(0);
        const orderRows = await database
          .select({ filledQuantity: kalshiOrders.filledQuantity })
          .from(kalshiOrders)
          .where(
            and(
              eq(kalshiOrders.userId, position.userId),
              eq(kalshiOrders.marketId, marketId),
              eq(kalshiOrders.side, side),
              eq(kalshiOrders.action, "buy"),
              gte(kalshiOrders.createdAt, positionOpenedAt),
            ),
          );
        const summedOpened = orderRows.reduce(
          (acc: number, r: { filledQuantity: number | null }) =>
            acc + Number(r.filledQuantity ?? 0),
          0,
        );
        // Only override the fallback if the orders lookup found something
        // sensible (≥ this tranche's close size). Otherwise stick with
        // the lower-bound estimate.
        if (summedOpened >= closeQuantity) {
          originalCount = summedOpened;
        }
      }
    } catch (err) {
      logger.warn(
        { err, marketId, side },
        "[Calibration] originalCount lookup from kalshiOrders failed; using fallback estimate",
      );
    }

    await db
      .update(kalshiPositions)
      .set({
        currentPrice: exitPrice,
        unrealizedPnl: 0,
        realizedPnl: totalRealizedPnl,
        positionStatus: "closed",
        closedAt: new Date(),
      })
      .where(eq(kalshiPositions.id, position.id));

    // Log to the calibration / cost-vs-profit outcome stream with the
    // FULL accumulated trade — total realized PnL across all fills, total
    // closed size. Logging only this final tranche's slice would corrupt
    // Brier scoring: a winning trade with a small money-losing closing
    // tranche would be classified as a loss.
    void logCalibrationOutcomeFromClose({
      userId: position.userId,
      marketId,
      side,
      count: originalCount,
      entryPrice,
      exitPrice,
      realizedPnl: totalRealizedPnl,
      placedAtMs: position.openedAt
        ? new Date(position.openedAt).getTime()
        : Date.now(),
      settledAtMs: Date.now(),
    });

    return true;
  } catch (error) {
    logger.error({ err: error, marketId, side }, "[Kalshi] Close position from fill error");
    return false;
  }
}

/**
 * Best-effort outcome logger for the calibration job. Pulls
 * predictedConfidence + impliedProbability + category from the most-recent
 * kalshiSignals row for this market (if any) and writes a
 * `kalshi_trade_outcome_log` audit event with realized P&L.
 *
 * Fire-and-forget: never blocks the close-position path.
 */
async function logCalibrationOutcomeFromClose(input: {
  userId: number;
  marketId: string;
  side: "yes" | "no";
  count: number;
  entryPrice: number;
  exitPrice: number;
  realizedPnl: number;
  placedAtMs: number;
  settledAtMs: number;
}): Promise<void> {
  try {
    const { logTradeOutcome } = await import("./performanceTracker");
    const { kalshiSignals, kalshiMarkets } = await import(
      "../../drizzle/schema"
    );
    const { getDb } = await import("../db");
    const { and, eq, lte, desc } = await import("drizzle-orm");
    const database = await getDb();

    let predictedConfidence = 0;
    let predictedEvFraction = 0;
    let predictedWinProbability = input.entryPrice;
    let category = "other";
    if (database) {
      // Look up the ENTRY signal — the most recent signal for this user +
      // market at-or-before the trade was placed. Without the time bound,
      // a market reviewed multiple times before close would log the LATEST
      // signal's prediction (which may differ from what the trader saw
      // when the position opened) → corrupts Brier samples.
      const rows = await database
        .select({
          confidence: kalshiSignals.confidence,
          expectedValue: kalshiSignals.expectedValue,
          impliedProbability: kalshiSignals.impliedProbability,
          signalType: kalshiSignals.signalType,
        })
        .from(kalshiSignals)
        .where(
          and(
            eq(kalshiSignals.userId, input.userId),
            eq(kalshiSignals.marketId, input.marketId),
            // Match SIDE too — a market can have both YES and NO signals
            // before the position opens. Without this filter, the latest
            // signal of the OPPOSITE side could be picked, then the
            // outcome logger would flip probability based on the actual
            // trade side, corrupting Brier samples.
            eq(kalshiSignals.side, input.side),
            lte(kalshiSignals.createdAt, new Date(input.placedAtMs)),
          ),
        )
        .orderBy(desc(kalshiSignals.createdAt))
        .limit(1);
      // `category` lives on the markets table (kalshiSignals doesn't carry
      // it). Pull it separately so per-category Brier scoring works.
      const marketRows = await database
        .select({ category: kalshiMarkets.category })
        .from(kalshiMarkets)
        .where(eq(kalshiMarkets.marketId, input.marketId))
        .limit(1);
      if (marketRows[0]?.category) {
        category = String(marketRows[0].category);
      }
      if (rows[0]) {
        predictedConfidence = Number(rows[0].confidence ?? 0);
        predictedEvFraction = Number(rows[0].expectedValue ?? 0);
        // `impliedProbability` in kalshiSignals is always the YES-side
        // probability (signal generation stores `market.impliedProbability`
        // regardless of trade side). For a NO-side trade, the probability
        // that THIS trade wins is `1 - YES_implied` — flip it so the
        // calibration job's Brier scoring compares apples-to-apples
        // against the realized win/loss outcome.
        const yesProb = Number(rows[0].impliedProbability ?? input.entryPrice);
        predictedWinProbability =
          input.side === "no"
            ? Math.min(1, Math.max(0, 1 - yesProb))
            : Math.min(1, Math.max(0, yesProb));
      }
    }

    const notional = input.count * input.entryPrice;
    const realizedReturnFraction =
      notional > 0 ? input.realizedPnl / notional : 0;
    const outcome: "win" | "loss" | "scratch" =
      input.realizedPnl > 0.005
        ? "win"
        : input.realizedPnl < -0.005
          ? "loss"
          : "scratch";

    await logTradeOutcome(input.userId, {
      tradeId: `${input.marketId}_${input.placedAtMs}`,
      ticker: input.marketId,
      category,
      side: input.side,
      count: input.count,
      entryPriceUsd: input.entryPrice,
      exitPriceUsd: input.exitPrice,
      predictedEvFraction,
      predictedConfidence,
      predictedWinProbability,
      realizedPnlUsd: input.realizedPnl,
      realizedReturnFraction,
      feeUsd: 0, // best-effort: actual fees are aggregated via fills sync
      grokCostUsd: ENV.grokCostPerReviewUsd,
      placedAtMs: input.placedAtMs,
      settledAtMs: input.settledAtMs,
      outcome,
    });
  } catch (err) {
    logger.warn(
      { err, marketId: input.marketId },
      "[Calibration] outcome log failed (best-effort)",
    );
  }
}

/**
 * Emergency close all positions
 */
export async function activateKalshiKillSwitch(
  userId: number,
  privateKey?: string,
): Promise<{
  success: boolean;
  totalPositions: number;
  closedPositions: number;
  failedPositions: number;
  results: Array<{ positionId: number; marketId: string; success: boolean; error?: string; mode?: "exchange" | "local" }>;
}> {
  const scopedUserId = getScopedUserId(userId);
  const positions = await getKalshiPositions(scopedUserId);
  const results: Array<{ positionId: number; marketId: string; success: boolean; error?: string; mode?: "exchange" | "local" }> = [];

  for (const position of positions) {
    const closeResult = await closeKalshiPosition(
      scopedUserId,
      Number(position.id),
      String(position.marketId),
      Number(position.currentPrice ?? position.entryPrice ?? 0),
      privateKey,
    );

    results.push({
      positionId: Number(position.id),
      marketId: String(position.marketId),
      success: closeResult.success,
      error: closeResult.error,
      mode: closeResult.mode,
    });
  }

  const closedPositions = results.filter((item) => item.success).length;
  const failedPositions = results.length - closedPositions;

  return {
    success: failedPositions === 0,
    totalPositions: results.length,
    closedPositions,
    failedPositions,
    results,
  };
}

export async function updatePositionMarkPrice(
  positionId: number,
  currentPrice: number,
): Promise<void> {
  try {
    const position = await db
      .select()
      .from(kalshiPositions)
      .where(eq(kalshiPositions.id, positionId))
      .then((rows: any[]) => rows[0]);

    if (!position) return;

    const side = position.side as "yes" | "no";
    const unrealizedPnl = side === "yes"
      ? position.quantity * (currentPrice - position.entryPrice)
      : position.quantity * (position.entryPrice - currentPrice);

    await db
      .update(kalshiPositions)
      .set({
        currentPrice,
        unrealizedPnl,
      })
      .where(eq(kalshiPositions.id, positionId));
  } catch (error) {
    logger.error({ err: error, positionId }, "[Kalshi] Update position error");
  }
}
