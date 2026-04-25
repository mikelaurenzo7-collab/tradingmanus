/**
 * Kalshi Execution Layer
 * Handles order placement, cancellation, and position management
 */

import crypto from "crypto";
import { URL } from "url";
import { db } from "../db";
import * as kalshiCredDb from "../db.kalshi-credentials";
import { kalshiOrders, kalshiFills, kalshiPositions } from "../../drizzle/schema";
import { and, eq, inArray } from "drizzle-orm";
import { calculateKalshiBuyOrderRisk, normalizeLimitPrice, normalizeOrderQuantity } from "./kalshiRisk";
import { assertPositiveIntegerUserId } from "./userScope";

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

function normalizePrivateKey(privateKey: string) {
  const trimmed = privateKey.trim();
  if (trimmed.includes("BEGIN") && trimmed.includes("PRIVATE KEY")) {
    return trimmed;
  }

  const normalizedBody = trimmed
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const wrapped = normalizedBody.match(/.{1,64}/g)?.join("\n") ?? normalizedBody;
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----`;
}

async function resolveCredentials(
  userIdOrApiKey: number | string,
  privateKey?: string,
): Promise<CredentialInput | null> {
  if (typeof userIdOrApiKey === "number") {
    const stored = await kalshiCredDb.getKalshiCredentials(userIdOrApiKey);
    if (!stored?.apiKey || !stored?.privateKey) {
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
    };

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
      console.error("[Kalshi] Order placement failed:", result.error);
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
      return {
        success: false,
        error: "Kalshi order created without an order ID",
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

    try {
      await db.insert(kalshiOrders).values({
        userId: scopedUserId,
        orderId,
        marketId,
        action: "buy",
        side,
        quantity: risk.quantity,
        limitPrice: risk.limitPrice,
        status: "pending",
        filledQuantity: 0,
        averagePrice: 0,
      });
    } catch (storageError) {
      console.error(
        `[Kalshi] Order ${orderId} accepted by Kalshi but local ledger write failed. Manual reconciliation required:`,
        storageError,
      );
      return {
        success: true,
        orderId,
        error: "Kalshi accepted the order, but the local ledger write failed. Verify the order on Kalshi before retrying.",
        needsReconciliation: true,
        reconciliationReason: "exchange accepted the order but the local order ledger write failed",
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
    console.error("[Kalshi] Order placement error:", error);
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
 * Cancel an order on Kalshi
 */
export async function cancelKalshiOrder(
  userId: number,
  orderId: string,
  privateKey?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const scopedUserId = getScopedUserId(userId);
    const result = await signedKalshiRequest<unknown>(
      scopedUserId,
      "DELETE",
      `/portfolio/orders/${orderId}`,
      { privateKey },
    );

    if (!result.ok) {
      console.error("[Kalshi] Cancel failed:", result.error);
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

    return { success: true };
  } catch (error) {
    console.error("[Kalshi] Cancel error:", error);
    return { success: false, error: String(error) };
  }
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
      console.error("[Kalshi] Order status fetch failed:", result.ok ? "missing order" : result.error);
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
    console.error("[Kalshi] Order status error:", error);
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
      console.error("[Kalshi] Fills fetch failed:", result.error);
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
    console.error("[Kalshi] Fills fetch error:", error);
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
    console.error("[Kalshi] Positions fetch error:", error);
    return [];
  }
}

/**
 * Close a position
 */
export async function closeKalshiPosition(
  userId: number,
  positionId: number,
  marketId: string,
  currentPrice: number,
  privateKey?: string,
): Promise<{ success: boolean; error?: string; mode?: "exchange" | "local"; orderId?: string }> {
  try {
    normalizeLimitPrice(currentPrice, "currentPrice");
    const scopedUserId = getScopedUserId(userId);
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
      return { success: false, error: "Position not found" };
    }

    const entryPrice = Number(position.entryPrice ?? 0);
    const markPrice = Number(currentPrice ?? position.currentPrice ?? entryPrice);
    const quantity = normalizeOrderQuantity(Number(position.quantity ?? 0), Number.MAX_SAFE_INTEGER);
    const side = position.side as "yes" | "no";

    let orderId: string | undefined;

    const credentials = await resolveCredentials(scopedUserId, privateKey);
    if (!credentials) {
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
    };

    const closeResult = await signedKalshiRequest<{ order?: { order_id?: string; id?: string } }>(
      scopedUserId,
      "POST",
      "/portfolio/orders",
      { privateKey, body: closeBody },
    );

    if (!closeResult.ok) {
      console.error("[Kalshi] Close position order failed:", closeResult.error);
      return { success: false, error: closeResult.error };
    }

    const closeOrderId = closeResult.data.order?.order_id || closeResult.data.order?.id;
    if (!closeOrderId) {
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
      console.error(
        `[Kalshi] Close order ${closeOrderId} accepted by Kalshi but local ledger write failed. Manual reconciliation required:`,
        storageError,
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
    return { success: true, mode: "exchange", orderId };
  } catch (error) {
    console.error("[Kalshi] Close position error:", error);
    return { success: false, error: String(error) };
  }
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
    console.error("[Kalshi] Create position error:", error);
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

    await db
      .update(kalshiPositions)
      .set({
        currentPrice: exitPrice,
        unrealizedPnl: 0,
        realizedPnl: Number(position.realizedPnl ?? 0) + realizedPnl,
        positionStatus: "closed",
        closedAt: new Date(),
      })
      .where(eq(kalshiPositions.id, position.id));

    return true;
  } catch (error) {
    console.error("[Kalshi] Close position from fill error:", error);
    return false;
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
    console.error("[Kalshi] Update position error:", error);
  }
}
