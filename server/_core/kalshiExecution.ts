/**
 * Kalshi Execution Layer
 * Handles order placement, cancellation, and position management
 */

import { db } from "../db";
import { kalshiOrders, kalshiFills, kalshiPositions } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

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

const KALSHI_API_BASE = "https://api.kalshi.com/trade-api/v2";

/**
 * Place an order on Kalshi
 */
export async function placeKalshiOrder(
  apiKey: string,
  marketId: string,
  side: "yes" | "no",
  quantity: number,
  limitPrice: number
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  try {
    const url = `${KALSHI_API_BASE}/orders`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        market_id: marketId,
        side: side.toUpperCase(),
        quantity,
        limit_price: limitPrice,
        order_type: "LIMIT",
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("[Kalshi] Order placement failed:", error);
      return { success: false, error: error.message || "Order placement failed" };
    }

    const data = await response.json();
    const orderId = data.order.id;

    // Store order in database
    await db.insert(kalshiOrders).values({
      orderId,
      marketId,
      side,
      quantity,
      limitPrice,
      status: "pending",
      filledQuantity: 0,
      averagePrice: 0,
    });

    return { success: true, orderId };
  } catch (error) {
    console.error("[Kalshi] Order placement error:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Cancel an order on Kalshi
 */
export async function cancelKalshiOrder(
  apiKey: string,
  orderId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const url = `${KALSHI_API_BASE}/orders/${orderId}/cancel`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("[Kalshi] Cancel failed:", error);
      return { success: false, error: error.message || "Cancel failed" };
    }

    // Update order status in database
    await db
      .update(kalshiOrders)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(kalshiOrders.orderId, orderId));

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
  apiKey: string,
  orderId: string
): Promise<KalshiOrder | null> {
  try {
    const url = `${KALSHI_API_BASE}/orders/${orderId}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      console.error("[Kalshi] Order status fetch failed:", response.status);
      return null;
    }

    const data = await response.json();
    const order = data.order;

    // Update order in database
    await db
      .update(kalshiOrders)
      .set({
        status: order.status.toLowerCase(),
        filledQuantity: order.filled_quantity,
        averagePrice: order.average_price,
        filledAt: order.status === "FILLED" ? new Date() : null,
      })
      .where(eq(kalshiOrders.orderId, orderId));

    return {
      orderId: order.id,
      marketId: order.market_id,
      side: order.side.toLowerCase(),
      quantity: order.quantity,
      limitPrice: order.limit_price,
      status: order.status.toLowerCase(),
      filledQuantity: order.filled_quantity,
      averagePrice: order.average_price,
    };
  } catch (error) {
    console.error("[Kalshi] Order status error:", error);
    return null;
  }
}

/**
 * Get all fills for an order
 */
export async function getKalshiOrderFills(apiKey: string, orderId: string): Promise<KalshiFill[]> {
  try {
    const url = `${KALSHI_API_BASE}/orders/${orderId}/fills`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      console.error("[Kalshi] Fills fetch failed:", response.status);
      return [];
    }

    const data = await response.json();
    const fills = data.fills || [];

    // Store fills in database
    for (const fill of fills) {
      await db.insert(kalshiFills).values({
        orderId,
        marketId: fill.market_id,
        fillPrice: fill.price,
        fillQuantity: fill.quantity,
        fillTime: new Date(fill.timestamp),
      });
    }

    return fills.map((f: any) => ({
      orderId,
      marketId: f.market_id,
      fillPrice: f.price,
      fillQuantity: f.quantity,
      fillTime: new Date(f.timestamp),
    }));
  } catch (error) {
    console.error("[Kalshi] Fills fetch error:", error);
    return [];
  }
}

/**
 * Get all open positions
 */
export async function getKalshiPositions(): Promise<any[]> {
  try {
    const positions = await db
      .select()
      .from(kalshiPositions)
      .where(eq(kalshiPositions.positionStatus, "open"));
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
  apiKey: string,
  positionId: number,
  marketId: string,
  currentPrice: number
): Promise<{ success: boolean; error?: string; mode?: "exchange" | "local"; orderId?: string }> {
  try {
    const position = await db
      .select()
      .from(kalshiPositions)
      .where(eq(kalshiPositions.id, positionId))
      .then((rows: any[]) => rows[0]);

    if (!position) {
      return { success: false, error: "Position not found" };
    }

    const entryPrice = Number(position.entryPrice ?? 0);
    const markPrice = Number(currentPrice ?? position.currentPrice ?? entryPrice);
    const quantity = Number(position.quantity ?? 0);
    const side = position.positionSide as "yes" | "no";

    let mode: "exchange" | "local" = "local";
    let orderId: string | undefined;

    if (apiKey?.trim()) {
      const closingSide = side === "yes" ? "no" : "yes";
      const result = await placeKalshiOrder(apiKey, marketId, closingSide, quantity, markPrice);
      if (!result.success) {
        return result;
      }
      mode = "exchange";
      orderId = result.orderId;
    }

    const realizedPnl = side === "yes"
      ? quantity * (markPrice - entryPrice)
      : quantity * (entryPrice - markPrice);

    await db
      .update(kalshiPositions)
      .set({
        currentPrice: markPrice,
        unrealizedPnl: 0,
        positionStatus: "closed",
        closedAt: new Date(),
        realizedPnl,
      })
      .where(eq(kalshiPositions.id, positionId));

    return { success: true, mode, orderId };
  } catch (error) {
    console.error("[Kalshi] Close position error:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Create a new position from a filled order
 */
export async function createPositionFromFill(
  orderId: string,
  marketId: string,
  side: "yes" | "no",
  quantity: number,
  fillPrice: number
): Promise<void> {
  try {
      await db.insert(kalshiPositions).values({
      marketId,
      positionSide: side,
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

/**
 * Update position mark price and unrealized PnL
 */
export async function activateKalshiKillSwitch(apiKey: string): Promise<{
  success: boolean;
  totalPositions: number;
  closedPositions: number;
  failedPositions: number;
  results: Array<{ positionId: number; marketId: string; success: boolean; error?: string; mode?: "exchange" | "local" }>;
}> {
  const positions = await getKalshiPositions();
  const results: Array<{ positionId: number; marketId: string; success: boolean; error?: string; mode?: "exchange" | "local" }> = [];

  for (const position of positions) {
    const closeResult = await closeKalshiPosition(
      apiKey,
      Number(position.id),
      String(position.marketId),
      Number(position.currentPrice ?? position.entryPrice ?? 0)
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
  currentPrice: number
): Promise<void> {
  try {
    const position = await db
      .select()
      .from(kalshiPositions)
      .where(eq(kalshiPositions.id, positionId))
      .then((rows: any[]) => rows[0]);

    if (!position) return;

    const unrealizedPnl = position.quantity * (currentPrice - position.entryPrice);

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
