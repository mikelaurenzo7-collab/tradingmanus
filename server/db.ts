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
let _pool: mysql.Pool | null = null;
let _dbInitPromise: Promise<any> | null = null;

function buildMysqlPool() {
  if (!ENV.databaseUrl) {
    return null;
  }

  const url = new URL(ENV.databaseUrl);

  return mysql.createPool({
    host: url.hostname,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    port: parseInt(url.port || "3306", 10),
    ssl: {
      rejectUnauthorized: false,
    },
    waitForConnections: true,
    connectionLimit: 10,
    maxIdle: 10,
    idleTimeout: 60_000,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });
}

async function initializeDb(forceRefresh: boolean = false) {
  if (!ENV.databaseUrl) {
    return null;
  }

  if (_db && _pool && !forceRefresh) {
    return _db;
  }

  if (_dbInitPromise && !forceRefresh) {
    return _dbInitPromise;
  }

  _dbInitPromise = (async () => {
    if (forceRefresh && _pool) {
      try {
        await _pool.end();
      } catch (error) {
        console.warn("[Database] Failed to close stale pool during refresh:", error);
      }
      _pool = null;
      _db = null;
    }

    const pool = buildMysqlPool();
    if (!pool) {
      return null;
    }

    try {
      const connection = await pool.getConnection();
      try {
        await connection.ping();
      } finally {
        connection.release();
      }

      _pool = pool;
      _db = drizzleInit(pool);
      return _db;
    } catch (error) {
      try {
        await pool.end();
      } catch (closeError) {
        console.warn("[Database] Failed to clean up failed pool init:", closeError);
      }
      _pool = null;
      _db = null;
      throw error;
    }
  })();

  try {
    return await _dbInitPromise;
  } finally {
    _dbInitPromise = null;
  }
}

async function ensureHealthyDb() {
  if (!_db || !_pool) {
    return initializeDb();
  }

  try {
    const connection = await _pool.getConnection();
    try {
      await connection.ping();
    } finally {
      connection.release();
    }

    return _db;
  } catch (error) {
    console.warn("[Database] Existing pool became unhealthy, recreating it:", error);
    return initializeDb(true);
  }
}

export async function getDb() {
  if (!ENV.databaseUrl) {
    return null;
  }

  try {
    return await ensureHealthyDb();
  } catch (error) {
    console.warn("[Database] Failed to connect:", error);
    _db = null;
    _pool = null;
    return null;
  }
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
  if (!database) {
    console.warn("[Database] Connection not available, skipping upsertUser");
    return;
  }

  const values: any = { openId: payload.openId };
  if (payload.name !== undefined) values.name = payload.name;
  if (payload.email !== undefined) values.email = payload.email;

  const updates: any = {};
  if (payload.name !== undefined) updates.name = payload.name;
  if (payload.email !== undefined) updates.email = payload.email;

  try {
    const existingUser = await database.select().from(users).where(eq(users.openId, payload.openId)).then((rows: any[]) => rows[0]);

    if (!existingUser) {
      await database.insert(users).values(values);
      return;
    }

    if (Object.keys(updates).length > 0) {
      await database.update(users).set(updates).where(eq(users.openId, payload.openId));
    }
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      return;
    }
    console.error("[Database] Upsert user failed:", error);
    // Don't throw - allow auth to proceed even if DB sync fails
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

  const marketId = market.marketId ?? market.id;
  if (!marketId) {
    throw new Error("Kalshi market payload is missing both marketId and id");
  }

  const liquidity = Number.isFinite(Number(market.liquidity))
    ? Number(market.liquidity)
    : Number(market.yesVolume ?? 0) + Number(market.noVolume ?? 0);
  
  await database
    .insert(kalshiMarkets)
    .values({
      marketId,
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
      liquidity,
    })
    .onDuplicateKeyUpdate({
      set: {
        yesPrice: market.yesPrice,
        noPrice: market.noPrice,
        yesVolume: market.yesVolume,
        noVolume: market.noVolume,
        impliedProbability: market.impliedProbability,
        liquidity,
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

export async function getKalshiTradeHistory(limit: number = 50) {
  const database = await getDb();
  if (!database) return [];

  return await database
    .select()
    .from(kalshiPositions)
    .orderBy(desc(kalshiPositions.closedAt), desc(kalshiPositions.id))
    .limit(limit);
}

export async function getTodayRealizedLoss() {
  const database = await getDb();
  if (!database) return 0;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const closedToday = await database
    .select()
    .from(kalshiPositions)
    .where(and(eq(kalshiPositions.positionStatus, "closed"), gte(kalshiPositions.closedAt, startOfDay)));

  return closedToday.reduce((total: number, position: any) => {
    const pnl = Number(position.realizedPnl ?? 0);
    return pnl < 0 ? total + Math.abs(pnl) : total;
  }, 0);
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
export async function initializeKalshiCapital(startingBalance: number = 0) {
  const database = await getDb();
  if (!database) return;

  const normalizedBalance = Number.isFinite(startingBalance)
    ? Math.max(0, Number(startingBalance))
    : 0;
  const existing = await getKalshiCapital();

  if (existing) {
    await database
      .update(kalshiCapital)
      .set({
        startingBalance: normalizedBalance,
        currentBalance: normalizedBalance,
        updatedAt: new Date(),
      })
      .where(eq(kalshiCapital.id, existing.id));
    return;
  }

  await database.insert(kalshiCapital).values({
    startingBalance: normalizedBalance,
    currentBalance: normalizedBalance,
  });
}

export async function getKalshiCapital() {
  const database = await getDb();
  if (!database) return null;

  const result = await database.select().from(kalshiCapital).limit(1);
  return result[0] || null;
}

export async function syncKalshiCapitalWithLiveEquity(liveEquity: number) {
  const database = await getDb();
  if (!database) return null;

  const normalizedEquity = Number.isFinite(liveEquity)
    ? Math.max(0, Number(liveEquity))
    : 0;
  const existing = await getKalshiCapital();

  if (!existing) {
    await database.insert(kalshiCapital).values({
      startingBalance: normalizedEquity,
      currentBalance: normalizedEquity,
    });
    return await getKalshiCapital();
  }

  const shouldResetStartingBalance =
    Number(existing.totalTrades ?? 0) === 0 &&
    (
      !Number.isFinite(Number(existing.startingBalance)) ||
      Number(existing.startingBalance) <= 0 ||
      (Number(existing.startingBalance) === 100 && normalizedEquity !== 100)
    );

  await database
    .update(kalshiCapital)
    .set({
      currentBalance: normalizedEquity,
      ...(shouldResetStartingBalance ? { startingBalance: normalizedEquity } : {}),
      updatedAt: new Date(),
    })
    .where(eq(kalshiCapital.id, existing.id));

  return await getKalshiCapital();
}

export async function updateKalshiCapital(updates: any) {
  const database = await getDb();
  if (!database) return;

  const existing = await getKalshiCapital();
  if (!existing) {
    const currentBalance = Number.isFinite(Number(updates?.currentBalance))
      ? Math.max(0, Number(updates.currentBalance))
      : Number.isFinite(Number(updates?.startingBalance))
        ? Math.max(0, Number(updates.startingBalance))
        : 0;

    await database.insert(kalshiCapital).values({
      startingBalance: Number.isFinite(Number(updates?.startingBalance))
        ? Math.max(0, Number(updates.startingBalance))
        : currentBalance,
      currentBalance,
      totalPnl: Number(updates?.totalPnl ?? 0),
      maxDrawdown: Number(updates?.maxDrawdown ?? 0),
      winRate: Number(updates?.winRate ?? 0),
      sharpeRatio: Number(updates?.sharpeRatio ?? 0),
      totalTrades: Number(updates?.totalTrades ?? 0),
      winningTrades: Number(updates?.winningTrades ?? 0),
    });
    return;
  }

  await database
    .update(kalshiCapital)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(kalshiCapital.id, existing.id));
}

// Audit log queries
export async function logAuditEvent(
  eventType: string,
  details: string,
  triggeredByOpenId: string,
  entityType: string = "system",
  entityId?: number | null,
) {
  const database = await getDb();
  if (!database) return false;

  try {
    await database.insert(auditLog).values({
      eventType,
      entityType,
      entityId: entityId ?? null,
      details,
      triggeredByOpenId,
    });
    return true;
  } catch (error) {
    console.error("[AuditLog] Failed to write audit event:", error);
    return false;
  }
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
