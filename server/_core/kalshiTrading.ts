/**
 * Phase 7: Kalshi API Integration
 * Live trading execution, order management, and position tracking
 */

import * as db from "../db";
import { assertPositiveIntegerUserId } from "./userScope";
import { logger } from "./logger";

export interface KalshiOrder {
  orderId: string;
  marketId: string;
  side: "yes" | "no";
  quantity: number;
  price: number;
  status: "pending" | "filled" | "partial" | "cancelled";
  createdAt: Date;
  filledAt?: Date;
}

export interface KalshiPosition {
  positionId: number;
  marketId: string;
  side: "yes" | "no";
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  status: "open" | "closed";
}

/**
 * Place a market order on Kalshi
 * In production, this would call the actual Kalshi API
 */
export async function placeMarketOrder(
  userId: number,
  marketId: string,
  side: "yes" | "no",
  quantity: number,
  maxPrice: number
): Promise<KalshiOrder> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "placeMarketOrder userId");
  const orderId = `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Simulate order placement
  const order: KalshiOrder = {
    orderId,
    marketId,
    side,
    quantity,
    price: maxPrice,
    status: "pending",
    createdAt: new Date(),
  };

  // Store order in database
  await db.createKalshiOrder({
    userId: scopedUserId,
    orderId,
    marketId,
    action: "buy",
    side,
    quantity,
    limitPrice: maxPrice,
    status: "pending",
  });

  logger.info({ orderId, side, quantity, limitPrice: maxPrice }, "[Trading] Order placed");
  
  // Simulate immediate fill (in production, would check actual Kalshi API)
  setTimeout(async () => {
    order.status = "filled";
    order.filledAt = new Date();
    
    // Create position
    await db.createKalshiPosition({
      userId: scopedUserId,
      marketId,
      side,
      quantity,
      entryPrice: maxPrice,
    });
    
    console.log(`[Trading] Order filled: ${orderId}`);
  }, 100);

  return order;
}

/**
 * Close a position at market price
 */
export async function closePosition(
  userId: number,
  positionId: number,
  exitPrice: number
): Promise<{ pnl: number; pnlPercent: number }> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "closePosition userId");
  await db.closeKalshiPosition(positionId, exitPrice, scopedUserId);
  
  console.log(`[Trading] Position closed: ${positionId} @ $${exitPrice}`);
  
  return {
    pnl: 0, // Would calculate from position data
    pnlPercent: 0,
  };
}

/**
 * Get all open positions
 */
export async function getOpenPositions(userId: number): Promise<KalshiPosition[]> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getOpenPositions userId");
  const positions = await db.getOpenKalshiPositions(scopedUserId);
  
  return positions.map((p: any) => ({
    positionId: p.id,
    marketId: p.marketId,
    side: p.side,
    quantity: p.quantity,
    entryPrice: p.entryPrice,
    currentPrice: p.currentPrice,
    unrealizedPnL: p.unrealizedPnL,
    status: p.positionStatus,
  }));
}

/**
 * Update position prices from market feed
 */
export async function updatePositionPrices(userId: number, marketPrices: Map<string, number>): Promise<void> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "updatePositionPrices userId");
  const positions = await db.getOpenKalshiPositions(scopedUserId);
  
  for (const position of positions) {
    const marketPrice = marketPrices.get(position.marketId);
    if (marketPrice) {
      await db.updateKalshiPositionPrice(position.id, marketPrice, scopedUserId);
      console.log(`[Trading] Updated ${position.marketId}: $${marketPrice}`);
    }
  }
}

/**
 * Execute a trading signal
 * Converts signal to market order
 */
export async function executeSignal(
  userId: number,
  signal: any,
  maxPrice: number,
  quantity: number
): Promise<KalshiOrder | null> {
  try {
    const scopedUserId = assertPositiveIntegerUserId(userId, "executeSignal userId");
    // Validate signal
    if (!signal.marketId || !signal.side || signal.confidence < 0.5) {
      console.warn("[Trading] Signal rejected: insufficient confidence or missing data");
      return null;
    }

    // Place order
    const order = await placeMarketOrder(scopedUserId, signal.marketId, signal.side, quantity, maxPrice);
    
    console.log(`[Trading] Signal executed: ${signal.signalType} ${signal.side} on ${signal.marketId}`);
    return order;
  } catch (error) {
    console.error("[Trading] Signal execution failed:", error);
    return null;
  }
}

/**
 * Calculate portfolio metrics
 */
export async function getPortfolioMetrics(userId: number): Promise<{
  totalCapital: number;
  currentValue: number;
  totalPnL: number;
  totalPnLPercent: number;
  openPositions: number;
  unrealizedPnL: number;
}> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getPortfolioMetrics userId");
  const positions = await db.getOpenKalshiPositions(scopedUserId);
  const tradeHistory = await db.getKalshiTradeHistory(1000, scopedUserId);
  
  const closedTrades = tradeHistory.filter((t: any) => t.positionStatus === "closed");
  const realizedPnL = closedTrades.reduce((sum: number, t: any) => sum + (t.realizedPnL || 0), 0);
  const unrealizedPnL = positions.reduce((sum: any, p: any) => sum + (p.unrealizedPnL || 0), 0);
  
  const capitalRecord = await db.getKalshiCapital(scopedUserId);
  const totalPnL = realizedPnL + unrealizedPnL;
  const totalCapital = Math.max(
    0,
    Number(capitalRecord?.startingBalance ?? capitalRecord?.currentBalance ?? 0)
  );
  const currentValue = Math.max(
    0,
    Number(capitalRecord?.currentBalance ?? totalCapital + totalPnL)
  );
  const totalPnLPercent = totalCapital > 0 ? (totalPnL / totalCapital) * 100 : 0;
  
  return {
    totalCapital,
    currentValue,
    totalPnL,
    totalPnLPercent,
    openPositions: positions.length,
    unrealizedPnL,
  };
}

/**
 * Risk management: Check position sizing
 */
export async function validatePositionSize(
  userId: number,
  quantity: number,
  price: number,
  maxRiskPercent: number = 2
): Promise<{ valid: boolean; reason?: string }> {
  const metrics = await getPortfolioMetrics(userId);
  const positionValue = quantity * price;
  const riskAmount = (metrics.totalCapital * maxRiskPercent) / 100;
  
  if (positionValue > riskAmount) {
    return {
      valid: false,
      reason: `Position size $${positionValue} exceeds max risk $${riskAmount}`,
    };
  }
  
  return { valid: true };
}

/**
 * Stop loss check: Close positions if loss exceeds threshold
 */
export async function checkStopLosses(userId: number, maxLossPercent: number = 5): Promise<number> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "checkStopLosses userId");
  const positions = await db.getOpenKalshiPositions(scopedUserId);
  let closedCount = 0;
  
  for (const position of positions) {
    const lossPercent = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
    
    if (lossPercent < -maxLossPercent) {
      await db.closeKalshiPosition(position.id, position.currentPrice, scopedUserId);
      closedCount++;
      console.log(`[Trading] Stop loss triggered: Position ${position.id} closed at $${position.currentPrice}`);
    }
  }
  
  return closedCount;
}

/**
 * Take profit check: Close positions if profit exceeds threshold
 */
export async function checkTakeProfits(userId: number, maxProfitPercent: number = 10): Promise<number> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "checkTakeProfits userId");
  const positions = await db.getOpenKalshiPositions(scopedUserId);
  let closedCount = 0;
  
  for (const position of positions) {
    const profitPercent = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
    
    if (profitPercent > maxProfitPercent) {
      await db.closeKalshiPosition(position.id, position.currentPrice, scopedUserId);
      closedCount++;
      console.log(`[Trading] Take profit triggered: Position ${position.id} closed at $${position.currentPrice}`);
    }
  }
  
  return closedCount;
}

/**
 * Get recent orders
 */
export async function getRecentOrders(limit: number = 20): Promise<KalshiOrder[]> {
  // In production, would fetch from Kalshi API
  // For now, return empty array as placeholder
  return [];
}
