/**
 * Phase 7: Kalshi API Integration
 * Live trading execution, order management, and position tracking
 */

import * as db from "../db";

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
  marketId: string,
  side: "yes" | "no",
  quantity: number,
  maxPrice: number
): Promise<KalshiOrder> {
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
    marketId,
    side,
    quantity,
    price: maxPrice,
    status: "pending",
  });

  console.log(`[Trading] Order placed: ${orderId} - ${side} ${quantity} @ $${maxPrice}`);
  
  // Simulate immediate fill (in production, would check actual Kalshi API)
  setTimeout(async () => {
    order.status = "filled";
    order.filledAt = new Date();
    
    // Create position
    await db.createKalshiPosition({
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
  positionId: number,
  exitPrice: number
): Promise<{ pnl: number; pnlPercent: number }> {
  await db.closeKalshiPosition(positionId, exitPrice);
  
  console.log(`[Trading] Position closed: ${positionId} @ $${exitPrice}`);
  
  return {
    pnl: 0, // Would calculate from position data
    pnlPercent: 0,
  };
}

/**
 * Get all open positions
 */
export async function getOpenPositions(): Promise<KalshiPosition[]> {
  const positions = await db.getOpenKalshiPositions();
  
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
export async function updatePositionPrices(marketPrices: Map<string, number>): Promise<void> {
  const positions = await db.getOpenKalshiPositions();
  
  for (const position of positions) {
    const marketPrice = marketPrices.get(position.marketId);
    if (marketPrice) {
      await db.updateKalshiPositionPrice(position.id, marketPrice);
      console.log(`[Trading] Updated ${position.marketId}: $${marketPrice}`);
    }
  }
}

/**
 * Execute a trading signal
 * Converts signal to market order
 */
export async function executeSignal(
  signal: any,
  maxPrice: number,
  quantity: number
): Promise<KalshiOrder | null> {
  try {
    // Validate signal
    if (!signal.marketId || !signal.side || signal.confidence < 0.5) {
      console.warn("[Trading] Signal rejected: insufficient confidence or missing data");
      return null;
    }

    // Place order
    const order = await placeMarketOrder(signal.marketId, signal.side, quantity, maxPrice);
    
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
export async function getPortfolioMetrics(): Promise<{
  totalCapital: number;
  currentValue: number;
  totalPnL: number;
  totalPnLPercent: number;
  openPositions: number;
  unrealizedPnL: number;
}> {
  const positions = await db.getOpenKalshiPositions();
  const tradeHistory = await db.getKalshiTradeHistory(1000);
  
  const closedTrades = tradeHistory.filter((t: any) => t.positionStatus === "closed");
  const realizedPnL = closedTrades.reduce((sum: number, t: any) => sum + (t.realizedPnL || 0), 0);
  const unrealizedPnL = positions.reduce((sum: any, p: any) => sum + (p.unrealizedPnL || 0), 0);
  
  const totalPnL = realizedPnL + unrealizedPnL;
  const totalCapital = 100; // Starting capital
  const currentValue = totalCapital + totalPnL;
  
  return {
    totalCapital,
    currentValue,
    totalPnL,
    totalPnLPercent: (totalPnL / totalCapital) * 100,
    openPositions: positions.length,
    unrealizedPnL,
  };
}

/**
 * Risk management: Check position sizing
 */
export async function validatePositionSize(
  quantity: number,
  price: number,
  maxRiskPercent: number = 2
): Promise<{ valid: boolean; reason?: string }> {
  const metrics = await getPortfolioMetrics();
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
export async function checkStopLosses(maxLossPercent: number = 5): Promise<number> {
  const positions = await db.getOpenKalshiPositions();
  let closedCount = 0;
  
  for (const position of positions) {
    const lossPercent = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
    
    if (lossPercent < -maxLossPercent) {
      await db.closeKalshiPosition(position.id, position.currentPrice);
      closedCount++;
      console.log(`[Trading] Stop loss triggered: Position ${position.id} closed at $${position.currentPrice}`);
    }
  }
  
  return closedCount;
}

/**
 * Take profit check: Close positions if profit exceeds threshold
 */
export async function checkTakeProfits(maxProfitPercent: number = 10): Promise<number> {
  const positions = await db.getOpenKalshiPositions();
  let closedCount = 0;
  
  for (const position of positions) {
    const profitPercent = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
    
    if (profitPercent > maxProfitPercent) {
      await db.closeKalshiPosition(position.id, position.currentPrice);
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
