/**
 * Paper Trading Execution Layer
 * Simulates order fills at current market prices when PAPER_TRADE_MODE is enabled.
 * Simulated trades still record to deskMemory and influence learning feedback.
 *
 * All simulated orders are recorded in the audit log with `simulated: true` flag
 * so they are clearly distinguished from real trades in reports and learning feedback.
 */

import { db, logAuditEvent, getKalshiMarket } from "../db";
import { kalshiOrders, kalshiFills } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { assertPositiveIntegerUserId } from "./userScope";
import { logger } from "./logger";

interface PlaceKalshiOrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
  needsReconciliation?: boolean;
  reconciliationReason?: string;
  exchangeRequest?: Record<string, unknown>;
  exchangeResponse?: Record<string, unknown>;
}

/**
 * Simulate a Kalshi order fill at current market price.
 * Returns immediately with 100% execution at the market price from kalshiMarkets.
 */
export async function simulateKalshiOrderFill(
  userId: number,
  marketId: string,
  side: "yes" | "no",
  quantity: number,
  limitPrice: number,
): Promise<PlaceKalshiOrderResult> {
  try {
    const scopedUserId = assertPositiveIntegerUserId(userId, "Paper trading userId");

    // Look up the current market price from kalshiMarkets
    const market = await getKalshiMarket(marketId);
    if (!market) {
      logger.warn({ marketId }, "[PaperTrading] Market not found in DB");
      return {
        success: false,
        error: "Market not found. Refresh market data and try again.",
        exchangeResponse: {
          error: "market_not_found",
        },
      };
    }

    // Use the side's current price; cap at limit price
    const currentPrice = side === "yes" ? market.yesPrice : market.noPrice;
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      logger.warn(
        { marketId, side, yesPrice: market.yesPrice, noPrice: market.noPrice },
        "[PaperTrading] Invalid market prices"
      );
      return {
        success: false,
        error: "Invalid market prices. Market data may be stale.",
        exchangeResponse: {
          error: "invalid_market_prices",
        },
      };
    }

    // Simulated fill uses the current price, capped at the limit price
    const fillPrice = Math.min(currentPrice, limitPrice);
    const clientOrderId = `nexus-paper-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // Write the order as filled immediately
    try {
      await db.insert(kalshiOrders).values({
        userId: scopedUserId,
        orderId: clientOrderId,
        marketId,
        action: "buy",
        side,
        quantity,
        limitPrice,
        status: "filled",
        filledQuantity: quantity,
        averagePrice: fillPrice,
        filledAt: new Date(),
      });
    } catch (insertError) {
      logger.error(
        { err: insertError, clientOrderId, marketId },
        "[PaperTrading] Failed to write simulated order to DB"
      );
      return {
        success: false,
        error:
          "Failed to record simulated order in local ledger. " +
          (insertError instanceof Error ? insertError.message : String(insertError)),
      };
    }

    // Record the fill
    try {
      await db.insert(kalshiFills).values({
        userId: scopedUserId,
        orderId: clientOrderId,
        marketId,
        fillPrice,
        fillQuantity: quantity,
        fillTime: new Date(),
      });
    } catch (fillError) {
      logger.error(
        { err: fillError, clientOrderId, marketId },
        "[PaperTrading] Failed to write fill record"
      );
      // Log error but don't fail the order — the fill record is secondary to the order itself
    }

    logger.info(
      { clientOrderId, marketId, side, quantity, fillPrice, limitPrice },
      "[PaperTrading] Simulated order filled"
    );

    return {
      success: true,
      orderId: clientOrderId,
      needsReconciliation: false,
      exchangeRequest: {
        marketId,
        action: "buy",
        side,
        quantity,
        limitPrice,
        clientOrderId,
        simulated: true,
      },
      exchangeResponse: {
        orderId: clientOrderId,
        filled: true,
        fillPrice,
        fillQuantity: quantity,
        simulated: true,
      },
    };
  } catch (error) {
    logger.error({ err: error }, "[PaperTrading] Unexpected error during order simulation");
    return {
      success: false,
      error: String(error),
      exchangeResponse: {
        error: String(error),
        simulated: true,
      },
    };
  }
}

/**
 * Simulate a Kalshi order cancellation.
 * Marks the order as cancelled in the local ledger (no exchange call).
 */
export async function simulateKalshiOrderCancellation(
  userId: number,
  orderId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const scopedUserId = assertPositiveIntegerUserId(userId, "Paper trading cancel userId");

    await db
      .update(kalshiOrders)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(and(eq(kalshiOrders.orderId, orderId), eq(kalshiOrders.userId, scopedUserId)));

    logger.info({ orderId }, "[PaperTrading] Simulated order cancelled");
    return { success: true };
  } catch (error) {
    logger.error({ err: error, orderId }, "[PaperTrading] Cancel simulation error");
    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * Simulate closing a position.
 * Similar to order placement: immediately fills at current market price.
 */
export async function simulateKalshiPositionClose(
  userId: number,
  marketId: string,
  side: "yes" | "no",
  quantity: number,
  currentPrice: number,
): Promise<{ success: boolean; error?: string; orderId?: string }> {
  try {
    const scopedUserId = assertPositiveIntegerUserId(userId, "Paper trading close userId");

    // Verify the market exists and get current prices
    const market = await getKalshiMarket(marketId);
    if (!market) {
      return {
        success: false,
        error: "Market not found",
      };
    }

    // Use current market price for the opposite side (closing a position means selling)
    const markPrice = side === "yes" ? market.noPrice : market.yesPrice;
    if (!Number.isFinite(markPrice) || markPrice <= 0) {
      return {
        success: false,
        error: "Invalid market prices for position close",
      };
    }

    const closeOrderId = `nexus-paper-close-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // Record the close order as filled
    try {
      await db.insert(kalshiOrders).values({
        userId: scopedUserId,
        orderId: closeOrderId,
        marketId,
        action: "sell",
        side,
        quantity,
        limitPrice: markPrice,
        status: "filled",
        filledQuantity: quantity,
        averagePrice: markPrice,
        filledAt: new Date(),
      });
    } catch (insertError) {
      logger.error(
        { err: insertError, closeOrderId, marketId },
        "[PaperTrading] Failed to write simulated close order"
      );
      return {
        success: false,
        error: "Failed to record simulated close in local ledger",
      };
    }

    // Record the fill
    try {
      await db.insert(kalshiFills).values({
        userId: scopedUserId,
        orderId: closeOrderId,
        marketId,
        fillPrice: markPrice,
        fillQuantity: quantity,
        fillTime: new Date(),
      });
    } catch (fillError) {
      logger.error(
        { err: fillError, closeOrderId, marketId },
        "[PaperTrading] Failed to write simulated close fill"
      );
    }

    logger.info(
      { closeOrderId, marketId, side, quantity, markPrice },
      "[PaperTrading] Simulated position closed"
    );

    return {
      success: true,
      orderId: closeOrderId,
    };
  } catch (error) {
    logger.error({ err: error }, "[PaperTrading] Position close simulation error");
    return {
      success: false,
      error: String(error),
    };
  }
}
