import {
  users,
  auditLog,
  autonomyRuns,
  kalshiMarkets,
  kalshiOrders,
  kalshiFills,
  kalshiPositions,
  kalshiSignals,
  kalshiPerformance,
  kalshiCapital,
  kalshiCredentials,
  tradingPreferences,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { eq, and, desc, gte, inArray, ne } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleInit } from "drizzle-orm/neon-http";
import { assertPositiveIntegerUserId } from "./_core/userScope";

let _db: any = null;
let _dbInitPromise: Promise<any> | null = null;

async function initializeDb(forceRefresh: boolean = false) {
  if (!ENV.databaseUrl) {
    return null;
  }

  if (_db && !forceRefresh) {
    return _db;
  }

  if (_dbInitPromise && !forceRefresh) {
    return _dbInitPromise;
  }

  _dbInitPromise = (async () => {
    if (forceRefresh) {
      _db = null;
    }

    try {
      const sql = neon(ENV.databaseUrl);
      _db = drizzleInit(sql);
      return _db;
    } catch (error) {
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
  if (!_db) {
    return initializeDb();
  }

  return _db;
}

function assertNonEmptyOpenId(openId: unknown, context: string = "openId") {
  if (typeof openId !== "string" || openId.trim().length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }

  return openId.trim();
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
    return null;
  }
}

export async function runMigrations(): Promise<void> {
  // Vercel serverless functions must not mutate schema during cold starts.
  // Run `corepack pnpm db:push` or `corepack pnpm db:generate && corepack pnpm db:migrate`
  // against Neon before deploying production traffic.
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
export async function upsertUser(payload: { 
  openId: string; 
  name?: string; 
  email?: string; 
  loginMethod?: string; 
  lastSignedIn?: Date;
  twoFactorSecret?: string | null;
  twoFactorEnabled?: number;
  backupCodesHash?: string | null;
}) {
  const database = await getDb();
  if (!database) {
    console.warn("[Database] Connection not available, skipping upsertUser");
    return;
  }

  const values: any = { openId: payload.openId };
  if (payload.name !== undefined) values.name = payload.name;
  if (payload.email !== undefined) values.email = payload.email;
  if (payload.lastSignedIn !== undefined) values.lastSignedIn = payload.lastSignedIn;
  if (payload.twoFactorSecret !== undefined) values.twoFactorSecret = payload.twoFactorSecret;
  if (payload.twoFactorEnabled !== undefined) values.twoFactorEnabled = payload.twoFactorEnabled;
  if (payload.backupCodesHash !== undefined) values.backupCodesHash = payload.backupCodesHash;

  const updates: any = {};
  if (payload.name !== undefined) updates.name = payload.name;
  if (payload.email !== undefined) updates.email = payload.email;
  if (payload.lastSignedIn !== undefined) updates.lastSignedIn = payload.lastSignedIn;
  if (payload.twoFactorSecret !== undefined) updates.twoFactorSecret = payload.twoFactorSecret;
  if (payload.twoFactorEnabled !== undefined) updates.twoFactorEnabled = payload.twoFactorEnabled;
  if (payload.backupCodesHash !== undefined) updates.backupCodesHash = payload.backupCodesHash;

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
    if (error?.code === "23505") {
      return;
    }
    console.error("[Database] Upsert user failed:", error);
    // Don't throw - allow auth to proceed even if DB sync fails
  }
}

export async function getUserById(userId: number) {
  const database = await getDb();
  if (!database) {
    return null;
  }

  const result = await database.select().from(users).where(eq(users.id, userId)).limit(1);
  return result[0] ?? null;
}

export async function updateUser(
  userId: number,
  updates: {
    twoFactorSecret?: string | null;
    twoFactorEnabled?: number;
    backupCodesHash?: string | null;
    lastSignedIn?: Date;
  }
) {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not available");
  }

  try {
    await database
      .update(users)
      .set(updates)
      .where(eq(users.id, userId));
    
    return { success: true };
  } catch (error) {
    console.error("[Database] Error updating user:", error);
    throw error;
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

export async function getUsersEligibleForAutomaticScheduledTrading() {
  const database = await getDb();
  if (!database) return [];

  return database
    .select({
      id: users.id,
      openId: users.openId,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .innerJoin(tradingPreferences, eq(users.id, tradingPreferences.userId))
    .innerJoin(kalshiCredentials, eq(users.id, kalshiCredentials.userId))
    .where(
      and(
        inArray(users.role, ["user", "admin"]),
        eq(tradingPreferences.liveTradingEnabled, 1),
        inArray(tradingPreferences.autonomyMode, ["semi_autonomous", "fully_autonomous"]),
        inArray(tradingPreferences.executionCadence, ["hourly_watch", "continuous_watch"]),
        eq(kalshiCredentials.accountStatus, "connected"),
        ne(kalshiCredentials.apiKeyEncrypted, ""),
        ne(kalshiCredentials.privateKeyEncrypted, "")
      )
    );
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
  const safeTitle = String(market.title ?? marketId).slice(0, 255);
  const safeCategory = String(market.category ?? "uncategorized").slice(0, 128);
  const safeDescription = market.description ? String(market.description) : null;

  await database
    .insert(kalshiMarkets)
    .values({
      marketId,
      title: safeTitle,
      category: safeCategory,
      description: safeDescription,
      resolutionDate: market.resolutionDate ? new Date(market.resolutionDate) : null,
      status: market.status,
      yesPrice: market.yesPrice,
      noPrice: market.noPrice,
      yesVolume: market.yesVolume,
      noVolume: market.noVolume,
      impliedProbability: market.impliedProbability,
      liquidity,
    })
    .onConflictDoUpdate({
      target: kalshiMarkets.marketId,
      set: {
        title: safeTitle,
        category: safeCategory,
        description: safeDescription,
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

function toKalshiMarketRecord(record: any) {
  if (!record) return null;

  return {
    ...record,
    id: String(record.marketId ?? record.id ?? ""),
    marketId: String(record.marketId ?? record.id ?? ""),
    title: String(record.title ?? record.marketId ?? record.id ?? ""),
    category: String(record.category ?? "general"),
    description: String(record.description ?? ""),
    resolutionDate:
      record.resolutionDate instanceof Date
        ? record.resolutionDate.toISOString()
        : String(record.resolutionDate ?? new Date().toISOString()),
    yesPrice: Number(record.yesPrice ?? 0),
    noPrice: Number(record.noPrice ?? 0),
    yesVolume: Number(record.yesVolume ?? 0),
    noVolume: Number(record.noVolume ?? 0),
    impliedProbability: Number(record.impliedProbability ?? 0.5),
    liquidity: Number(record.liquidity ?? 0),
    status:
      record.status === "closed" || record.status === "resolved"
        ? record.status
        : "open",
  };
}

export async function getKalshiMarket(marketId: string) {
  const database = await getDb();
  if (!database) return null;
  
  const result = await database
    .select()
    .from(kalshiMarkets)
    .where(eq(kalshiMarkets.marketId, marketId));
  return toKalshiMarketRecord(result[0]);
}

export async function getOpenKalshiMarkets() {
  const database = await getDb();
  if (!database) return [];
  
  const rows = await database
    .select()
    .from(kalshiMarkets)
    .where(eq(kalshiMarkets.status, "open"));

  return rows.map((row: any) => toKalshiMarketRecord(row));
}

// Kalshi order queries
export async function createKalshiOrder(order: any) {
  const database = await getDb();
  if (!database) return;
  const userId = assertPositiveIntegerUserId(order.userId, "createKalshiOrder userId");
  
  await database.insert(kalshiOrders).values({
    userId,
    orderId: order.orderId,
    marketId: order.marketId,
    action: order.action ?? "buy",
    side: order.side,
    quantity: order.quantity,
    limitPrice: order.limitPrice,
    status: "pending",
  });
}

export async function updateKalshiOrderStatus(orderId: string, status: string, userId: number, filledQuantity?: number, averagePrice?: number) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "updateKalshiOrderStatus userId");
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
    .where(
      and(eq(kalshiOrders.orderId, orderId), eq(kalshiOrders.userId, scopedUserId))
    );
}

export async function getKalshiOrder(orderId: string, userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getKalshiOrder userId");
  const database = await getDb();
  if (!database) return null;
  
  const result = await database
    .select()
    .from(kalshiOrders)
    .where(
      and(eq(kalshiOrders.orderId, orderId), eq(kalshiOrders.userId, scopedUserId))
    );
  return result[0] || null;
}

export async function getKalshiOrdersByMarket(marketId: string, userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getKalshiOrdersByMarket userId");
  const database = await getDb();
  if (!database) return [];
  
  return await database
    .select()
    .from(kalshiOrders)
    .where(
      and(eq(kalshiOrders.marketId, marketId), eq(kalshiOrders.userId, scopedUserId))
    );
}

export async function getTodayKalshiOrderCount(userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getTodayKalshiOrderCount userId");
  const database = await getDb();
  if (!database) return 0;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const orders = await database
    .select()
    .from(kalshiOrders)
    .where(
      and(eq(kalshiOrders.userId, scopedUserId), gte(kalshiOrders.createdAt, startOfDay))
    );

  return orders.length;
}

// Kalshi position queries
export async function createKalshiPosition(position: any) {
  const database = await getDb();
  if (!database) return;
  const userId = assertPositiveIntegerUserId(position.userId, "createKalshiPosition userId");
  
  await database.insert(kalshiPositions).values({
    userId,
    marketId: position.marketId,
    side: position.side,
    quantity: position.quantity,
    entryPrice: position.entryPrice,
    currentPrice: position.entryPrice,
  });
}

export async function updateKalshiPositionPrice(positionId: number, currentPrice: number, userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "updateKalshiPositionPrice userId");
  const database = await getDb();
  if (!database) return;
  
  const position = await database
    .select()
    .from(kalshiPositions)
    .where(
      and(eq(kalshiPositions.id, positionId), eq(kalshiPositions.userId, scopedUserId))
    )
    .then((rows: any[]) => rows[0]);
  
  if (!position) return;
  
  const unrealizedPnl = position.side === "no"
    ? position.quantity * (position.entryPrice - currentPrice)
    : position.quantity * (currentPrice - position.entryPrice);
  
  await database
    .update(kalshiPositions)
    .set({ currentPrice, unrealizedPnl })
    .where(
      and(eq(kalshiPositions.id, positionId), eq(kalshiPositions.userId, scopedUserId))
    );
}

export async function closeKalshiPosition(positionId: number, exitPrice: number, userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "closeKalshiPosition userId");
  const database = await getDb();
  if (!database) return;
  
  const position = await database
    .select()
    .from(kalshiPositions)
    .where(
      and(eq(kalshiPositions.id, positionId), eq(kalshiPositions.userId, scopedUserId))
    )
    .then((rows: any[]) => rows[0]);
  
  if (!position) return;
  
  const realizedPnl = position.side === "no"
    ? position.quantity * (position.entryPrice - exitPrice)
    : position.quantity * (exitPrice - position.entryPrice);
  
  await database
    .update(kalshiPositions)
    .set({
      positionStatus: "closed",
      closedAt: new Date(),
      realizedPnl,
    })
    .where(
      and(eq(kalshiPositions.id, positionId), eq(kalshiPositions.userId, scopedUserId))
    );

  // Side-effect: grow the desk's learning tape with what just happened.
  // Wrapped + swallowed inside tryRecordKalshiCloseToDeskMemory so a memory
  // failure can never block a real trade close.
  try {
    const { tryRecordKalshiCloseToDeskMemory } = await import("./db.desk-memory");
    await tryRecordKalshiCloseToDeskMemory({
      userId: scopedUserId,
      marketId: position.marketId,
      side: position.side,
      entryPrice: Number(position.entryPrice),
      exitPrice,
      quantity: Number(position.quantity),
      realizedPnl,
    });
  } catch {
    // Already swallowed inside the helper; this catch is belt-and-suspenders.
  }
}

export async function getOpenKalshiPositions(userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getOpenKalshiPositions userId");
  const database = await getDb();
  if (!database) return [];
  
  return await database
    .select()
    .from(kalshiPositions)
    .where(
      and(
        eq(kalshiPositions.userId, scopedUserId),
        inArray(kalshiPositions.positionStatus, ["open", "closing"])
      )
    );
}

export async function getKalshiTradeHistory(limit: number, userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getKalshiTradeHistory userId");
  const database = await getDb();
  if (!database) return [];

  const query = database
    .select()
    .from(kalshiPositions)
    .where(eq(kalshiPositions.userId, scopedUserId));

  return await query
    .orderBy(desc(kalshiPositions.closedAt), desc(kalshiPositions.id))
    .limit(limit);
}

export async function getTodayRealizedLoss(userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getTodayRealizedLoss userId");
  const database = await getDb();
  if (!database) return 0;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const closedToday = await database
    .select()
    .from(kalshiPositions)
    .where(
      and(
        eq(kalshiPositions.userId, scopedUserId),
        eq(kalshiPositions.positionStatus, "closed"),
        gte(kalshiPositions.closedAt, startOfDay)
      )
    );

  return closedToday.reduce((total: number, position: any) => {
    const pnl = Number(position.realizedPnl ?? 0);
    return pnl < 0 ? total + Math.abs(pnl) : total;
  }, 0);
}

// Kalshi signal queries
export async function createKalshiSignal(signal: any) {
  const database = await getDb();
  if (!database) return;
  const userId = assertPositiveIntegerUserId(signal.userId, "createKalshiSignal userId");
  
  const result = await database.insert(kalshiSignals).values({
    userId,
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

export async function getRecentSignals(limit: number, userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getRecentSignals userId");
  const database = await getDb();
  if (!database) return [];
  
  const query = database
    .select()
    .from(kalshiSignals)
    .where(eq(kalshiSignals.userId, scopedUserId));

  const rows = await query
    .orderBy(desc(kalshiSignals.createdAt))
    .limit(limit * 5);

  return rows
    .filter((signal: any) => {
      const marketPrice = Number(signal.marketPrice ?? 0);
      const impliedProbability = Number(signal.impliedProbability ?? 0.5);
      const expectedValue = Number(signal.expectedValue ?? 0);

      return (
        Number.isFinite(marketPrice) &&
        Number.isFinite(impliedProbability) &&
        Number.isFinite(expectedValue) &&
        marketPrice > 0.01 &&
        marketPrice < 0.99 &&
        impliedProbability > 0.01 &&
        impliedProbability < 0.99 &&
        expectedValue > 0
      );
    })
    .slice(0, limit);
}

// Kalshi capital queries
export async function initializeKalshiCapital(startingBalance: number, userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "initializeKalshiCapital userId");
  const database = await getDb();
  if (!database) return;

  const normalizedBalance = Number.isFinite(startingBalance)
    ? Math.max(0, Number(startingBalance))
    : 0;
  const existing = await getKalshiCapital(scopedUserId);

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
    userId: scopedUserId,
    startingBalance: normalizedBalance,
    currentBalance: normalizedBalance,
  });
}

export async function getKalshiCapital(userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getKalshiCapital userId");
  const database = await getDb();
  if (!database) return null;

  const result = await database
    .select()
    .from(kalshiCapital)
    .where(eq(kalshiCapital.userId, scopedUserId))
    .limit(1);
  return result[0] || null;
}

export async function syncKalshiCapitalWithLiveEquity(liveEquity: number, userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "syncKalshiCapitalWithLiveEquity userId");
  const database = await getDb();
  if (!database) return null;

  const normalizedEquity = Number.isFinite(liveEquity)
    ? Math.max(0, Number(liveEquity))
    : 0;
  const existing = await getKalshiCapital(scopedUserId);

  if (!existing) {
    await database.insert(kalshiCapital).values({
      userId: scopedUserId,
      startingBalance: normalizedEquity,
      currentBalance: normalizedEquity,
    });
    return await getKalshiCapital(scopedUserId);
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

  return await getKalshiCapital(scopedUserId);
}

export async function updateKalshiCapital(updates: any, userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "updateKalshiCapital userId");
  const database = await getDb();
  if (!database) return;

  const existing = await getKalshiCapital(scopedUserId);
  if (!existing) {
    const currentBalance = Number.isFinite(Number(updates?.currentBalance))
      ? Math.max(0, Number(updates.currentBalance))
      : Number.isFinite(Number(updates?.startingBalance))
        ? Math.max(0, Number(updates.startingBalance))
        : 0;

    await database.insert(kalshiCapital).values({
      userId: scopedUserId,
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

// Autonomous run ledger queries
export async function createAutonomyRun(run: {
  runId: string;
  runKey: string;
  userId: number;
  triggeredByOpenId: string;
  triggerSource: string;
  autonomyMode: "manual" | "approval_required" | "semi_autonomous" | "fully_autonomous";
  executionCadence: "manual_only" | "session_assisted" | "hourly_watch" | "continuous_watch";
  appliedGuardrails?: string | null;
}) {
  const scopedUserId = assertPositiveIntegerUserId(run.userId, "createAutonomyRun userId");
  const database = await getDb();
  if (!database) return null;

  try {
    await database.insert(autonomyRuns).values({
      runId: run.runId,
      runKey: run.runKey,
      userId: scopedUserId,
      triggeredByOpenId: assertNonEmptyOpenId(run.triggeredByOpenId, "createAutonomyRun triggeredByOpenId"),
      triggerSource: String(run.triggerSource || "unknown").slice(0, 32),
      autonomyMode: run.autonomyMode,
      executionCadence: run.executionCadence,
      appliedGuardrails: run.appliedGuardrails ?? null,
    });
  } catch (error: any) {
    if (error?.code === "23505") {
      return null;
    }
    throw error;
  }

  const created = await database
    .select()
    .from(autonomyRuns)
    .where(
      and(eq(autonomyRuns.runId, run.runId), eq(autonomyRuns.userId, scopedUserId))
    )
    .then((rows: any[]) => rows[0]);

  return created ?? null;
}

export async function updateAutonomyRun(
  runId: string,
  userId: number,
  updates: Record<string, unknown>
) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "updateAutonomyRun userId");
  const database = await getDb();
  if (!database) return null;

  await database
    .update(autonomyRuns)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(
      and(eq(autonomyRuns.runId, runId), eq(autonomyRuns.userId, scopedUserId))
    );

  const updated = await database
    .select()
    .from(autonomyRuns)
    .where(
      and(eq(autonomyRuns.runId, runId), eq(autonomyRuns.userId, scopedUserId))
    )
    .then((rows: any[]) => rows[0]);

  return updated ?? null;
}

export async function getLatestAutonomyRun(userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getLatestAutonomyRun userId");
  const database = await getDb();
  if (!database) return null;

  const result = await database
    .select()
    .from(autonomyRuns)
    .where(eq(autonomyRuns.userId, scopedUserId))
    .orderBy(desc(autonomyRuns.startedAt), desc(autonomyRuns.id))
    .limit(1);

  return result[0] || null;
}

export async function getRecentAutonomyRuns(userId: number, limit: number = 8) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getRecentAutonomyRuns userId");
  const database = await getDb();
  if (!database) return [];

  return await database
    .select()
    .from(autonomyRuns)
    .where(eq(autonomyRuns.userId, scopedUserId))
    .orderBy(desc(autonomyRuns.startedAt), desc(autonomyRuns.id))
    .limit(limit);
}

// Audit log queries
export async function logAuditEvent(
  eventType: string,
  details: string,
  triggeredByOpenId: string,
  entityType: string = "system",
  entityId?: number | null,
) {
  const scopedOpenId = assertNonEmptyOpenId(triggeredByOpenId, "logAuditEvent triggeredByOpenId");
  const database = await getDb();
  if (!database) return false;

  try {
    await database.insert(auditLog).values({
      eventType,
      entityType,
      entityId: entityId ?? null,
      details,
      triggeredByOpenId: scopedOpenId,
    });
    return true;
  } catch (error) {
    console.error("[AuditLog] Failed to write audit event:", error);
    return false;
  }
}

export async function getLatestAuditEventByType(
  eventType: string,
  triggeredByOpenId: string,
) {
  const scopedOpenId = assertNonEmptyOpenId(triggeredByOpenId, "getLatestAuditEventByType triggeredByOpenId");
  const database = await getDb();
  if (!database) return null;

  const conditions = and(
    eq(auditLog.eventType, eventType),
    eq(auditLog.triggeredByOpenId, scopedOpenId)
  );

  const result = await database
    .select()
    .from(auditLog)
    .where(conditions)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(1);

  return result[0] || null;
}

/**
 * Sum today's realized loss from Polymarket trade-exit audit events.
 *
 * Polymarket exits don't write to a positions table; we encode realizedPnl
 * into the `polymarket_trade_exit` audit event's JSON details.  This helper
 * scans events for the given user since the start of today and returns the
 * absolute total of negative PnL.  Returns 0 if the DB is unavailable so
 * the autonomy loop fails open rather than blocking trading on a query
 * outage (the per-trade risk gate still applies).
 */
export async function getTodayPolymarketRealizedLoss(userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getTodayPolymarketRealizedLoss userId",
  );
  const database = await getDb();
  if (!database) return 0;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  try {
    const rows = await database
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventType, "polymarket_trade_exit"),
          eq(auditLog.triggeredByOpenId, `user:${scopedUserId}`),
          gte(auditLog.createdAt, startOfDay),
        ),
      );

    return rows.reduce((total: number, row: any) => {
      try {
        const parsed = JSON.parse(String(row.details ?? "{}"));
        const pnl = Number(parsed.realizedPnl);
        if (Number.isFinite(pnl) && pnl < 0) {
          return total + Math.abs(pnl);
        }
      } catch {
        // Older exit events without realizedPnl simply contribute 0.
      }
      return total;
    }, 0);
  } catch (error) {
    console.error(
      "[Database] getTodayPolymarketRealizedLoss failed:",
      error,
    );
    return 0;
  }
}

export async function getAuditLog(
  limitDays: number = 7,
  triggeredByOpenId: string,
) {
  const scopedOpenId = assertNonEmptyOpenId(triggeredByOpenId, "getAuditLog triggeredByOpenId");
  const database = await getDb();
  if (!database) return [];

  const cutoffDate = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000);
  const conditions = and(
    gte(auditLog.createdAt, cutoffDate),
    eq(auditLog.triggeredByOpenId, scopedOpenId)
  );

  return await database
    .select()
    .from(auditLog)
    .where(conditions)
    .orderBy(desc(auditLog.createdAt));
}
