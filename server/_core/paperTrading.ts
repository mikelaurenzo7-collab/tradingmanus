/**
 * Paper Trading Execution Layer
 * Simulates order fills at current market prices when PAPER_TRADE_MODE is enabled.
 * Simulated trades still record to deskMemory and influence learning feedback.
 *
 * All simulated orders are recorded in the audit log with `simulated: true` flag
 * so they are clearly distinguished from real trades in reports and learning feedback.
 */

import { db, getKalshiMarket } from "../db";
import {
  kalshiOrders,
  kalshiFills,
  polymarketOrders,
  polymarketFills,
  polymarketPositions,
} from "../../drizzle/schema";
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

// ── Polymarket simulation ───────────────────────────────────────────────────

interface PlacePolymarketOrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
  needsReconciliation?: boolean;
  exchangeRequest?: Record<string, unknown>;
  exchangeResponse?: Record<string, unknown>;
}

/**
 * Simulate a Polymarket BUY at the supplied limit price.  Writes a filled
 * order and a matching fill to the local DB and opens / tops up the
 * polymarketPositions row so the rest of the pipeline (exit monitor, learning,
 * reconciliation) sees a real position.
 */
export async function simulatePolymarketOrderFill(
  userId: number,
  input: {
    marketId: string;
    tokenId: string;
    positionSide: "yes" | "no";
    price: number;
    sizeUsdc: number;
  },
  _triggeredByOpenId?: string,
): Promise<PlacePolymarketOrderResult> {
  try {
    const scopedUserId = assertPositiveIntegerUserId(userId, "Polymarket paper trading userId");
    const fillPrice = Number(input.price) || 0;
    const sizeUsdc = Number(input.sizeUsdc) || 0;
    if (!Number.isFinite(fillPrice) || fillPrice <= 0 || fillPrice >= 1) {
      return { success: false, error: "Invalid Polymarket limit price" };
    }
    if (!Number.isFinite(sizeUsdc) || sizeUsdc <= 0) {
      return { success: false, error: "Invalid Polymarket order size" };
    }

    const clientOrderId = `nexus-paper-poly-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    try {
      await db.insert(polymarketOrders).values({
        userId: scopedUserId,
        orderId: clientOrderId,
        marketId: input.marketId,
        tokenId: input.tokenId,
        side: input.positionSide,
        sizeUsdc,
        limitPrice: fillPrice,
        status: "filled",
        filledSizeUsdc: sizeUsdc,
        averagePrice: fillPrice,
        filledAt: new Date(),
      });
    } catch (insertError) {
      logger.error(
        { err: insertError, clientOrderId, marketId: input.marketId },
        "[PaperTrading] Failed to write simulated polymarket order to DB",
      );
      return {
        success: false,
        error:
          "Failed to record simulated polymarket order in local ledger: " +
          (insertError instanceof Error ? insertError.message : String(insertError)),
      };
    }

    try {
      await db.insert(polymarketFills).values({
        userId: scopedUserId,
        orderId: clientOrderId,
        marketId: input.marketId,
        tokenId: input.tokenId,
        fillPrice,
        fillSizeUsdc: sizeUsdc,
        fillTime: new Date(),
      });
    } catch (fillError) {
      logger.error(
        { err: fillError, clientOrderId, marketId: input.marketId },
        "[PaperTrading] Failed to write simulated polymarket fill",
      );
    }

    // Upsert position row so the exit monitor can see it.
    try {
      const existing = await db
        .select()
        .from(polymarketPositions)
        .where(
          and(
            eq(polymarketPositions.userId, scopedUserId),
            eq(polymarketPositions.tokenId, input.tokenId),
            eq(polymarketPositions.positionStatus, "open"),
          ),
        )
        .limit(1);
      const existingRow = existing[0];
      if (existingRow) {
        // Blend cost basis in TOKEN space, not USDC outlay.  An add at a
        // different price weights by tokens acquired, not capital spent —
        // otherwise the average entry skews toward whichever leg cost more
        // in dollars, which is dimensionally wrong.
        const oldEntry = Number(existingRow.entryPrice) || 0;
        const oldSizeUsdc = Number(existingRow.sizeUsdc) || 0;
        const oldTokens = oldEntry > 0 ? oldSizeUsdc / oldEntry : 0;
        const newTokens = fillPrice > 0 ? sizeUsdc / fillPrice : 0;
        const totalTokens = oldTokens + newTokens;
        const blendedEntry =
          totalTokens > 0
            ? (oldEntry * oldTokens + fillPrice * newTokens) / totalTokens
            : fillPrice;
        const newSize = oldSizeUsdc + sizeUsdc;
        await db
          .update(polymarketPositions)
          .set({
            sizeUsdc: newSize,
            entryPrice: blendedEntry,
            currentPrice: fillPrice,
          })
          .where(eq(polymarketPositions.id, existingRow.id));
      } else {
        await db.insert(polymarketPositions).values({
          userId: scopedUserId,
          marketId: input.marketId,
          tokenId: input.tokenId,
          side: input.positionSide,
          sizeUsdc,
          entryPrice: fillPrice,
          currentPrice: fillPrice,
          unrealizedPnl: 0,
          realizedPnl: 0,
          positionStatus: "open",
        });
      }
    } catch (positionError) {
      logger.error(
        { err: positionError, clientOrderId, marketId: input.marketId },
        "[PaperTrading] Failed to upsert simulated polymarket position",
      );
    }

    return {
      success: true,
      orderId: clientOrderId,
      needsReconciliation: false,
      exchangeRequest: {
        marketId: input.marketId,
        tokenId: input.tokenId,
        side: input.positionSide,
        sizeUsdc,
        limitPrice: fillPrice,
        clientOrderId,
        simulated: true,
      },
      exchangeResponse: {
        orderId: clientOrderId,
        filled: true,
        fillPrice,
        fillSizeUsdc: sizeUsdc,
        simulated: true,
      },
    };
  } catch (error) {
    logger.error({ err: error }, "[PaperTrading] Unexpected error during polymarket order simulation");
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
 * Simulate closing a Polymarket position at the supplied current price.
 * Marks the local position row as `closed` so the exit monitor stops
 * re-firing on it.
 */
export async function simulatePolymarketPositionClose(
  userId: number,
  positionId: number,
  currentPrice: number,
  _triggeredByOpenId?: string,
): Promise<{ success: boolean; error?: string; orderId?: string }> {
  try {
    const scopedUserId = assertPositiveIntegerUserId(userId, "Polymarket paper close userId");
    const fillPrice = Number(currentPrice) || 0;
    if (!Number.isFinite(fillPrice) || fillPrice <= 0 || fillPrice >= 1) {
      return { success: false, error: "Invalid Polymarket close price" };
    }

    const rows = await db
      .select()
      .from(polymarketPositions)
      .where(eq(polymarketPositions.id, positionId))
      .limit(1);
    const position = rows[0];
    if (!position || position.userId !== scopedUserId) {
      return { success: false, error: "Polymarket position not found" };
    }
    if (position.positionStatus !== "open") {
      return { success: false, error: `Position is ${position.positionStatus}, not open` };
    }

    const closeOrderId = `nexus-paper-poly-close-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const sizeUsdc = Number(position.sizeUsdc) || 0;

    try {
      await db.insert(polymarketOrders).values({
        userId: scopedUserId,
        orderId: closeOrderId,
        marketId: position.marketId,
        tokenId: position.tokenId,
        side: position.side,
        sizeUsdc,
        limitPrice: fillPrice,
        status: "filled",
        filledSizeUsdc: sizeUsdc,
        averagePrice: fillPrice,
        filledAt: new Date(),
      });
      await db.insert(polymarketFills).values({
        userId: scopedUserId,
        orderId: closeOrderId,
        marketId: position.marketId,
        tokenId: position.tokenId,
        fillPrice,
        fillSizeUsdc: sizeUsdc,
        fillTime: new Date(),
      });
    } catch (insertError) {
      logger.error(
        { err: insertError, closeOrderId, positionId },
        "[PaperTrading] Failed to write simulated polymarket close",
      );
      return {
        success: false,
        error: "Failed to record simulated polymarket close in local ledger",
      };
    }

    // Realized PnL = (exit − entry) × tokens.  Tokens = USDC entry capital ÷
    // entry price.  Multiplying by sizeUsdc instead would dimension PnL in
    // (USDC×price) space — wrong by a factor of the entry price.
    const entryPrice = Number(position.entryPrice) || 0;
    const tokens = entryPrice > 0 ? sizeUsdc / entryPrice : 0;
    const realizedPnl = (fillPrice - entryPrice) * tokens;
    const closedAt = new Date();
    try {
      await db
        .update(polymarketPositions)
        .set({
          positionStatus: "closed",
          currentPrice: fillPrice,
          realizedPnl,
          unrealizedPnl: 0,
          closedAt,
        })
        .where(eq(polymarketPositions.id, positionId));
    } catch (updateError) {
      logger.warn(
        { err: updateError, positionId },
        "[PaperTrading] Failed to mark polymarket position closed",
      );
    }

    // Daily-pick scoreboard hook (paper-mode Polymarket close).
    try {
      const { closeDailyPlayPickByPosition, closeDailyPlayPickByMarketFallback } = await import(
        "../db.daily-play-picks"
      );
      await closeDailyPlayPickByPosition({
        platform: "polymarket",
        linkedPositionId: positionId,
        exitPrice: fillPrice,
        realizedPnl,
        closedAt,
      });
      await closeDailyPlayPickByMarketFallback({
        userId: scopedUserId,
        platform: "polymarket",
        marketId: String(position.marketId),
        tokenId: String(position.tokenId ?? ""),
        exitPrice: fillPrice,
        realizedPnl,
        closedAt,
      });
    } catch (err) {
      logger.warn({ err, positionId }, "[PaperTrading] dailyPlayPicks hook (poly close) failed");
    }

    logger.info(
      { closeOrderId, positionId, fillPrice, sizeUsdc, realizedPnl },
      "[PaperTrading] Simulated polymarket position closed",
    );

    return { success: true, orderId: closeOrderId };
  } catch (error) {
    logger.error({ err: error }, "[PaperTrading] Polymarket position close simulation error");
    return { success: false, error: String(error) };
  }
}
