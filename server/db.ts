import { drizzle } from "drizzle-orm/mysql2";
import {
  users,
  auditLog,
  kalshiMarkets,
  kalshiOrders,
  kalshiFills,
  kalshiPositions,
  kalshiSignals,
  kalshiPerformance,
  kalshiCapital,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { eq, and, desc, gte } from "drizzle-orm";
import { drizzle as drizzleInit } from "drizzle-orm/mysql2";
import * as mysql from "mysql2/promise";

let _db: any = null;
let _connection: any = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);
      _connection = await mysql.createConnection({
        host: url.hostname,
        user: url.username,
        password: url.password,
        database: url.pathname.slice(1),
        port: parseInt(url.port || "3306"),
        ssl: {
          rejectUnauthorized: false,
        },
      });
      _db = drizzleInit(_connection);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export const db = {
  insert: (table: any) => {
    if (!_db) throw new Error("Database not initialized");
    return _db.insert(table);
  },
  update: (table: any) => {
    if (!_db) throw new Error("Database not initialized");
    return _db.update(table);
  },
  select: () => {
    if (!_db) throw new Error("Database not initialized");
    return _db.select();
  },
  delete: (table: any) => {
    if (!_db) throw new Error("Database not initialized");
    return _db.delete(table);
  },
};

// User queries
export async function upsertUser(payload: { openId: string; name?: string; email?: string; loginMethod?: string; lastSignedIn?: Date }) {
  const database = await getDb();
  if (!database) return;
  
  const values: any = { openId: payload.openId };
  if (payload.name) values.name = payload.name;
  if (payload.email) values.email = payload.email;
  
  const updates: any = {};
  if (payload.name) updates.name = payload.name;
  if (payload.email) updates.email = payload.email;
  
  // Always include at least one update field
  if (Object.keys(updates).length === 0) {
    updates.name = payload.name || null;
  }
  
  try {
    await database
      .insert(users)
      .values(values)
      .onDuplicateKeyUpdate({ set: updates });
  } catch (error) {
    console.error("[Database] Upsert user failed:", error);
  }
}

export async function getUser(openId: string) {
  const database = await getDb();
  if (!database) return null;
  
  const result = await database.select().from(users).where(eq(users.openId, openId));
  return result[0] || null;
}

export async function getUserByOpenId(openId: string) {
  return getUser(openId);
}

// Kalshi market queries
export async function upsertKalshiMarket(market: any) {
  const database = await getDb();
  if (!database) return;
  
  await database
    .insert(kalshiMarkets)
    .values({
      marketId: market.id,
      title: market.title,
      category: market.category,
      description: market.description,
      resolutionDate: market.resolutionDate ? new Date(market.resolutionDate) : null,
      status: market.status,
      yesPrice: market.yesPrice,
      noPrice: market.noPrice,
      yesVolume: market.yesVolume,
      noVolume: market.noVolume,
      impliedProbability: market.impliedProbability,
    })
    .onDuplicateKeyUpdate({
      set: {
        yesPrice: market.yesPrice,
        noPrice: market.noPrice,
        yesVolume: market.yesVolume,
        noVolume: market.noVolume,
        impliedProbability: market.impliedProbability,
        status: market.status,
        lastUpdated: new Date(),
      },
    });
}

export async function getKalshiMarket(marketId: string) {
  const database = await getDb();
  if (!database) return null;
  
  const result = await database
    .select()
    .from(kalshiMarkets)
    .where(eq(kalshiMarkets.marketId, marketId));
  return result[0] || null;
}

export async function getOpenKalshiMarkets() {
  const database = await getDb();
  if (!database) return [];
  
  return await database
    .select()
    .from(kalshiMarkets)
    .where(eq(kalshiMarkets.status, "open"));
}

// Kalshi order queries
export async function createKalshiOrder(order: any) {
  const database = await getDb();
  if (!database) return;
  
  await database.insert(kalshiOrders).values({
    orderId: order.orderId,
    marketId: order.marketId,
    side: order.side,
    quantity: order.quantity,
    limitPrice: order.limitPrice,
    status: "pending",
  });
}

export async function updateKalshiOrderStatus(orderId: string, status: string, filledQuantity?: number, averagePrice?: number) {
  const database = await getDb();
  if (!database) return;
  
  const updates: any = { status };
  if (filledQuantity !== undefined) updates.filledQuantity = filledQuantity;
  if (averagePrice !== undefined) updates.averagePrice = averagePrice;
  if (status === "filled") updates.filledAt = new Date();
  if (status === "cancelled") updates.cancelledAt = new Date();
  
  await database
    .update(kalshiOrders)
    .set(updates)
    .where(eq(kalshiOrders.orderId, orderId));
}

export async function getKalshiOrder(orderId: string) {
  const database = await getDb();
  if (!database) return null;
  
  const result = await database
    .select()
    .from(kalshiOrders)
    .where(eq(kalshiOrders.orderId, orderId));
  return result[0] || null;
}

export async function getKalshiOrdersByMarket(marketId: string) {
  const database = await getDb();
  if (!database) return [];
  
  return await database
    .select()
    .from(kalshiOrders)
    .where(eq(kalshiOrders.marketId, marketId));
}

// Kalshi position queries
export async function createKalshiPosition(position: any) {
  const database = await getDb();
  if (!database) return;
  
  await database.insert(kalshiPositions).values({
    marketId: position.marketId,
    side: position.side,
    quantity: position.quantity,
    entryPrice: position.entryPrice,
    currentPrice: position.entryPrice,
  });
}

export async function updateKalshiPositionPrice(positionId: number, currentPrice: number) {
  const database = await getDb();
  if (!database) return;
  
  const position = await database
    .select()
    .from(kalshiPositions)
    .where(eq(kalshiPositions.id, positionId))
    .then((rows: any[]) => rows[0]);
  
  if (!position) return;
  
  const unrealizedPnl = position.quantity * (currentPrice - position.entryPrice);
  
  await database
    .update(kalshiPositions)
    .set({ currentPrice, unrealizedPnl })
    .where(eq(kalshiPositions.id, positionId));
}

export async function closeKalshiPosition(positionId: number, exitPrice: number) {
  const database = await getDb();
  if (!database) return;
  
  const position = await database
    .select()
    .from(kalshiPositions)
    .where(eq(kalshiPositions.id, positionId))
    .then((rows: any[]) => rows[0]);
  
  if (!position) return;
  
  const realizedPnl = position.quantity * (exitPrice - position.entryPrice);
  
  await database
    .update(kalshiPositions)
    .set({
      positionStatus: "closed",
      closedAt: new Date(),
      realizedPnl,
    })
    .where(eq(kalshiPositions.id, positionId));
}

export async function getOpenKalshiPositions() {
  const database = await getDb();
  if (!database) return [];
  
  return await database
    .select()
    .from(kalshiPositions)
    .where(eq(kalshiPositions.positionStatus, "open"));
}

// Kalshi signal queries
export async function createKalshiSignal(signal: any) {
  const database = await getDb();
  if (!database) return;
  
  const result = await database.insert(kalshiSignals).values({
    marketId: signal.marketId,
    signalType: signal.signalType,
    side: signal.side,
    confidence: signal.confidence,
    reasoning: signal.reasoning,
    impliedProbability: signal.impliedProbability,
    marketPrice: signal.marketPrice,
    expectedValue: signal.expectedValue,
  });
  
  return result;
}

export async function getRecentSignals(limit: number = 10) {
  const database = await getDb();
  if (!database) return [];
  
  return await database
    .select()
    .from(kalshiSignals)
    .orderBy(desc(kalshiSignals.createdAt))
    .limit(limit);
}

// Kalshi capital queries
export async function initializeKalshiCapital(startingBalance: number = 100) {
  const database = await getDb();
  if (!database) return;
  
  await database.insert(kalshiCapital).values({
    startingBalance,
    currentBalance: startingBalance,
  });
}

export async function getKalshiCapital() {
  const database = await getDb();
  if (!database) return null;
  
  const result = await database.select().from(kalshiCapital).limit(1);
  return result[0] || null;
}

export async function updateKalshiCapital(updates: any) {
  const database = await getDb();
  if (!database) return;
  
  await database
    .update(kalshiCapital)
    .set({ ...updates, updatedAt: new Date() })
    .limit(1);
}

// Audit log queries
export async function logAuditEvent(event: string, details: string, triggeredByOpenId: string) {
  const database = await getDb();
  if (!database) return;
  
  await database.insert(auditLog).values({
    event,
    details,
    triggeredByOpenId,
  });
}

export async function getAuditLog(limitDays: number = 7) {
  const database = await getDb();
  if (!database) return [];
  
  const cutoffDate = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000);
  
  return await database
    .select()
    .from(auditLog)
    .where(gte(auditLog.createdAt, cutoffDate))
    .orderBy(desc(auditLog.createdAt));
}
