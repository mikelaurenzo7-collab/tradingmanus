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
  polymarketCredentials,
  tradingPreferences,
  marketTimeframeAnalysis,
  marketMicrostructure,
  signalBayesianUpdates,
  portfolioVolatilityHistory,
  positionExits,
  mlEnsembleModels,
  marketSentimentHistory,
  executionQualityMetrics,
  crossPlatformArbitrageExecutions,
  onlineLearningUpdates,
  performanceAttribution,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { eq, and, desc, gte, inArray, ne, sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleInit } from "drizzle-orm/neon-http";
import { assertPositiveIntegerUserId } from "./_core/userScope";
import { logger } from "./_core/logger";
import {
  applyOnlineLearningUpdate,
  deriveModelFromUpdates,
  type TradeOutcome,
} from "./_core/onlineLearning";
import { calculateAttributionBreakdown } from "./_core/performanceAttribution";

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
    logger.warn({ err: error }, "[Database] Failed to connect");
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
  passwordHash?: string | null;
  role?: "user" | "admin";
  betaAccessLevel?: "none" | "internal" | "invited" | "public";
  subscriptionTier?: "starter" | "pro" | "fund";
  subscriptionStatus?:
    | "trialing"
    | "active"
    | "past_due"
    | "cancelled"
    | "unpaid";
  subscriptionCurrentPeriodEnd?: Date | null;
  stripeCustomerId?: string | null;
}) {
  const database = await getDb();
  if (!database) {
    logger.warn("[Database] Connection not available, skipping upsertUser");
    return;
  }

  const values: any = { openId: payload.openId };
  if (payload.name !== undefined) values.name = payload.name;
  if (payload.email !== undefined) values.email = payload.email;
  if (payload.lastSignedIn !== undefined)
    values.lastSignedIn = payload.lastSignedIn;
  if (payload.twoFactorSecret !== undefined)
    values.twoFactorSecret = payload.twoFactorSecret;
  if (payload.twoFactorEnabled !== undefined)
    values.twoFactorEnabled = payload.twoFactorEnabled;
  if (payload.backupCodesHash !== undefined)
    values.backupCodesHash = payload.backupCodesHash;
  if (payload.stripeCustomerId !== undefined)
    values.stripeCustomerId = payload.stripeCustomerId;
  if (payload.subscriptionCurrentPeriodEnd !== undefined)
    values.subscriptionCurrentPeriodEnd = payload.subscriptionCurrentPeriodEnd;
  if (payload.subscriptionStatus !== undefined)
    values.subscriptionStatus = payload.subscriptionStatus;
  if (payload.subscriptionTier !== undefined)
    values.subscriptionTier = payload.subscriptionTier;
  if (payload.passwordHash !== undefined)
    values.passwordHash = payload.passwordHash;
  if (payload.role !== undefined) values.role = payload.role;
  if (payload.betaAccessLevel !== undefined)
    values.betaAccessLevel = payload.betaAccessLevel;

  const updates: any = {};
  if (payload.name !== undefined) updates.name = payload.name;
  if (payload.email !== undefined) updates.email = payload.email;
  if (payload.lastSignedIn !== undefined)
    updates.lastSignedIn = payload.lastSignedIn;
  if (payload.twoFactorSecret !== undefined)
    updates.twoFactorSecret = payload.twoFactorSecret;
  if (payload.twoFactorEnabled !== undefined)
    updates.twoFactorEnabled = payload.twoFactorEnabled;
  if (payload.backupCodesHash !== undefined)
    updates.backupCodesHash = payload.backupCodesHash;
  if (payload.stripeCustomerId !== undefined)
    updates.stripeCustomerId = payload.stripeCustomerId;
  if (payload.subscriptionCurrentPeriodEnd !== undefined)
    updates.subscriptionCurrentPeriodEnd = payload.subscriptionCurrentPeriodEnd;
  if (payload.subscriptionStatus !== undefined)
    updates.subscriptionStatus = payload.subscriptionStatus;
  if (payload.subscriptionTier !== undefined)
    updates.subscriptionTier = payload.subscriptionTier;
  if (payload.passwordHash !== undefined)
    updates.passwordHash = payload.passwordHash;
  if (payload.role !== undefined) updates.role = payload.role;
  if (payload.betaAccessLevel !== undefined)
    updates.betaAccessLevel = payload.betaAccessLevel;

  try {
    const existingUser = await database
      .select()
      .from(users)
      .where(eq(users.openId, payload.openId))
      .then((rows: any[]) => rows[0]);

    if (!existingUser) {
      await database.insert(users).values(values);
      return;
    }

    if (Object.keys(updates).length > 0) {
      await database
        .update(users)
        .set(updates)
        .where(eq(users.openId, payload.openId));
    }
  } catch (error: any) {
    if (error?.code === "23505") {
      return;
    }
    logger.error({ err: error }, "[Database] Upsert user failed");
    // Don't throw - allow auth to proceed even if DB sync fails
  }
}

export async function getUserByEmail(email: string) {
  const database = await getDb();
  if (!database) return null;

  const normalizedEmail = email.trim().toLowerCase();
  const result = await database
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);
  return result[0] ?? null;
}

export async function createUserAccount(payload: {
  openId: string;
  name?: string | null;
  email: string;
  passwordHash: string;
  subscriptionTier: "starter" | "pro" | "fund";
  subscriptionStatus:
    | "trialing"
    | "active"
    | "past_due"
    | "cancelled"
    | "unpaid";
  subscriptionCurrentPeriodEnd?: Date | null;
}) {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not available");
  }

  const values = {
    openId: payload.openId,
    name: payload.name ?? null,
    email: payload.email.trim().toLowerCase(),
    passwordHash: payload.passwordHash,
    subscriptionTier: payload.subscriptionTier,
    subscriptionStatus: payload.subscriptionStatus,
    subscriptionCurrentPeriodEnd: payload.subscriptionCurrentPeriodEnd ?? null,
    lastSignedIn: new Date(),
  };

  const inserted = await database.insert(users).values(values).returning();
  return inserted[0] ?? null;
}

export async function getUserById(userId: number) {
  const database = await getDb();
  if (!database) {
    return null;
  }

  const result = await database
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return result[0] ?? null;
}

export async function updateUser(
  userId: number,
  updates: {
    twoFactorSecret?: string | null;
    twoFactorEnabled?: number;
    backupCodesHash?: string | null;
    lastSignedIn?: Date;
    subscriptionTier?: "starter" | "pro" | "fund";
    subscriptionStatus?:
      | "trialing"
      | "active"
      | "past_due"
      | "cancelled"
      | "unpaid";
    subscriptionCurrentPeriodEnd?: Date | null;
    stripeCustomerId?: string | null;
  }
) {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not available");
  }

  try {
    await database.update(users).set(updates).where(eq(users.id, userId));

    return { success: true };
  } catch (error) {
    logger.error({ err: error }, "[Database] Error updating user");
    throw error;
  }
}

export async function getUser(openId: string) {
  const database = await getDb();
  if (!database) return null;

  const result = await database
    .select()
    .from(users)
    .where(eq(users.openId, openId));
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
        inArray(tradingPreferences.autonomyMode, [
          "semi_autonomous",
          "fully_autonomous",
        ]),
        inArray(tradingPreferences.executionCadence, [
          "hourly_watch",
          "continuous_watch",
        ]),
        eq(kalshiCredentials.accountStatus, "connected"),
        ne(kalshiCredentials.apiKeyEncrypted, ""),
        ne(kalshiCredentials.privateKeyEncrypted, "")
      )
    );
}

/**
 * Returns true if at least one user has BOTH Kalshi and Polymarket
 * credentials connected.  Used to gate the cross-platform arbitrage
 * scanner — running it without dual connectivity wastes Kalshi /
 * Polymarket fetch quotas on opportunities the user can't act on.
 */
export async function hasAnyDualConnectedUser(): Promise<boolean> {
  const database = await getDb();
  if (!database) return false;
  const [hit] = await database
    .select({ userId: kalshiCredentials.userId })
    .from(kalshiCredentials)
    .innerJoin(polymarketCredentials, eq(kalshiCredentials.userId, polymarketCredentials.userId))
    .where(
      and(
        eq(kalshiCredentials.accountStatus, "connected"),
        eq(polymarketCredentials.accountStatus, "connected"),
      ),
    )
    .limit(1);
  return Boolean(hit);
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
  const safeDescription = market.description
    ? String(market.description)
    : null;

  await database
    .insert(kalshiMarkets)
    .values({
      marketId,
      title: safeTitle,
      category: safeCategory,
      description: safeDescription,
      resolutionDate: market.resolutionDate
        ? new Date(market.resolutionDate)
        : null,
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
  const userId = assertPositiveIntegerUserId(
    order.userId,
    "createKalshiOrder userId"
  );

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

export async function updateKalshiOrderStatus(
  orderId: string,
  status: string,
  userId: number,
  filledQuantity?: number,
  averagePrice?: number
) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "updateKalshiOrderStatus userId"
  );
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
      and(
        eq(kalshiOrders.orderId, orderId),
        eq(kalshiOrders.userId, scopedUserId)
      )
    );
}

export async function getKalshiOrder(orderId: string, userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getKalshiOrder userId"
  );
  const database = await getDb();
  if (!database) return null;

  const result = await database
    .select()
    .from(kalshiOrders)
    .where(
      and(
        eq(kalshiOrders.orderId, orderId),
        eq(kalshiOrders.userId, scopedUserId)
      )
    );
  return result[0] || null;
}

export async function getKalshiOrdersByMarket(
  marketId: string,
  userId: number
) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getKalshiOrdersByMarket userId"
  );
  const database = await getDb();
  if (!database) return [];

  return await database
    .select()
    .from(kalshiOrders)
    .where(
      and(
        eq(kalshiOrders.marketId, marketId),
        eq(kalshiOrders.userId, scopedUserId)
      )
    );
}

/**
 * Returns the user's open (pending) Kalshi orders.  Used by the autonomy
 * scheduler to avoid double-fill races against the 30-second order-sync —
 * if an order is still pending in the local ledger we already have an
 * exposure on that market and should not stack another buy on top of it.
 */
export async function getPendingKalshiOrders(userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getPendingKalshiOrders userId"
  );
  const database = await getDb();
  if (!database) return [];

  return await database
    .select()
    .from(kalshiOrders)
    .where(
      and(
        eq(kalshiOrders.userId, scopedUserId),
        eq(kalshiOrders.status, "pending")
      )
    );
}

export async function getTodayKalshiOrderCount(userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getTodayKalshiOrderCount userId"
  );
  const database = await getDb();
  if (!database) return 0;

  // Use UTC midnight so the daily cap is anchored to a real calendar day
  // and is deterministic across server restarts and timezone changes.
  const now = new Date();
  const startOfDay = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );

  const orders = await database
    .select()
    .from(kalshiOrders)
    .where(
      and(
        eq(kalshiOrders.userId, scopedUserId),
        gte(kalshiOrders.createdAt, startOfDay)
      )
    );

  return orders.length;
}

// Kalshi position queries
export async function createKalshiPosition(position: any) {
  const database = await getDb();
  if (!database) return;
  const userId = assertPositiveIntegerUserId(
    position.userId,
    "createKalshiPosition userId"
  );

  await database.insert(kalshiPositions).values({
    userId,
    marketId: position.marketId,
    side: position.side,
    quantity: position.quantity,
    entryPrice: position.entryPrice,
    currentPrice: position.entryPrice,
  });
}

export async function updateKalshiPositionPrice(
  positionId: number,
  currentPrice: number,
  userId: number
) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "updateKalshiPositionPrice userId"
  );
  const database = await getDb();
  if (!database) return;

  const position = await database
    .select()
    .from(kalshiPositions)
    .where(
      and(
        eq(kalshiPositions.id, positionId),
        eq(kalshiPositions.userId, scopedUserId)
      )
    )
    .then((rows: any[]) => rows[0]);

  if (!position) return;

  const unrealizedPnl =
    position.side === "no"
      ? position.quantity * (position.entryPrice - currentPrice)
      : position.quantity * (currentPrice - position.entryPrice);

  await database
    .update(kalshiPositions)
    .set({ currentPrice, unrealizedPnl })
    .where(
      and(
        eq(kalshiPositions.id, positionId),
        eq(kalshiPositions.userId, scopedUserId)
      )
    );
}

export async function closeKalshiPosition(
  positionId: number,
  exitPrice: number,
  userId: number
) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "closeKalshiPosition userId"
  );
  const database = await getDb();
  if (!database) return;

  const position = await database
    .select()
    .from(kalshiPositions)
    .where(
      and(
        eq(kalshiPositions.id, positionId),
        eq(kalshiPositions.userId, scopedUserId)
      )
    )
    .then((rows: any[]) => rows[0]);

  if (!position) return;

  const realizedPnl =
    position.side === "no"
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
      and(
        eq(kalshiPositions.id, positionId),
        eq(kalshiPositions.userId, scopedUserId)
      )
    );

  // Best-effort online learning + attribution updates.
  // These side-effects are non-critical and must never block position closure.
  try {
    const [latestSignal] = await database
      .select()
      .from(kalshiSignals)
      .where(
        and(
          eq(kalshiSignals.userId, scopedUserId),
          eq(kalshiSignals.marketId, position.marketId)
        )
      )
      .orderBy(desc(kalshiSignals.createdAt))
      .limit(1);

    const signalType = String(latestSignal?.signalType ?? "unknown");
    const category = String(
      latestSignal?.metadata?.marketCategory ?? "unknown"
    );
    const outcome: TradeOutcome =
      realizedPnl > 0 ? "win" : realizedPnl < 0 ? "loss" : "breakeven";

    const recentLearning = await getRecentOnlineLearningUpdates(
      scopedUserId,
      "kalshi",
      200
    );
    const model = deriveModelFromUpdates({
      userId: scopedUserId,
      platform: "kalshi",
      updates: recentLearning.map((row: any) => ({
        signalType: String(row.signalType),
        outcome: row.outcome as TradeOutcome,
        pnl: Number(row.pnl),
      })),
    });

    const learningUpdate = applyOnlineLearningUpdate(model, {
      signalType,
      outcome,
      pnl: realizedPnl,
    });

    await saveOnlineLearningUpdate({
      userId: scopedUserId,
      platform: "kalshi",
      signalType,
      outcome,
      pnl: realizedPnl,
      weightBefore: learningUpdate.weightBefore,
      weightAfter: learningUpdate.weightAfter,
      emaPnl: learningUpdate.nextModel.emaPnl,
      driftDetected: learningUpdate.driftDetected,
      explorationTaken: learningUpdate.explorationTaken,
      confidenceLower: learningUpdate.confidenceLower,
      confidenceUpper: learningUpdate.confidenceUpper,
      modelVersion: learningUpdate.nextModel.modelVersion,
    });

    const attribution = calculateAttributionBreakdown({
      side: position.side,
      entryPrice: Number(position.entryPrice),
      exitPrice,
      quantity: Number(position.quantity),
      signalConfidence: Number(latestSignal?.confidence ?? 0.5),
      benchmarkWinRate: 0.5,
      expectedSlippagePct: 0.005,
    });

    await savePerformanceAttribution({
      userId: scopedUserId,
      platform: "kalshi",
      marketId: position.marketId,
      signalType,
      category,
      ...attribution,
    });
  } catch (err) {
    logger.debug(
      { err, userId: scopedUserId, positionId },
      "non-critical learning/attribution update failed"
    );
  }

  // Side-effect: grow the desk's learning tape with what just happened.
  // Wrapped + swallowed inside tryRecordKalshiCloseToDeskMemory so a memory
  // failure can never block a real trade close.
  try {
    const { tryRecordKalshiCloseToDeskMemory } = await import(
      "./db.desk-memory"
    );
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
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getOpenKalshiPositions userId"
  );
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
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getKalshiTradeHistory userId"
  );
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
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getTodayRealizedLoss userId"
  );
  const database = await getDb();
  if (!database) return 0;

  // Use UTC midnight so the daily-loss limit is anchored to a real
  // calendar day; otherwise the cap is sensitive to local server
  // timezone and can effectively reset at non-midnight wallclock
  // times across restarts.
  const now = new Date();
  const startOfDay = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );

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
  const userId = assertPositiveIntegerUserId(
    signal.userId,
    "createKalshiSignal userId"
  );

  const result = await database.insert(kalshiSignals).values({
    userId,
    marketId: signal.marketId,
    signalType: signal.signalType,
    side: signal.side,
    confidence: signal.confidence,
    bayesianProbability: signal.bayesianProbability ?? null,
    reasoning: signal.reasoning,
    impliedProbability: signal.impliedProbability,
    marketPrice: signal.marketPrice,
    expectedValue: signal.expectedValue,
  });

  return result;
}

export async function getRecentSignals(limit: number, userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getRecentSignals userId"
  );
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

// Multi-Timeframe Analysis
export async function saveTimeframeAnalysis(payload: {
  userId: number;
  marketId: string;
  platform: string;
  timeframeAnalyses: Array<{
    timeframe: number;
    momentum: number;
    volatility: number;
    volume: number;
    trendStrength: number;
  }>;
}) {
  const database = await getDb();
  if (!database) return;

  const scopedUserId = assertPositiveIntegerUserId(
    payload.userId,
    "saveTimeframeAnalysis userId"
  );

  // Insert each timeframe analysis as a separate row
  for (const analysis of payload.timeframeAnalyses) {
    try {
      await database.insert(marketTimeframeAnalysis).values({
        userId: scopedUserId,
        marketId: payload.marketId,
        platform: payload.platform,
        timeframe: analysis.timeframe.toString(),
        momentum: analysis.momentum,
        volatility: analysis.volatility,
        volume: analysis.volume,
        trendStrength: analysis.trendStrength,
        analyzedAt: new Date(),
      });
    } catch (error) {
      logger.error(
        { error, marketId: payload.marketId, timeframe: analysis.timeframe },
        "Failed to save timeframe analysis"
      );
    }
  }
}

// Market Microstructure
export async function saveMicrostructure(data: {
  marketId: string;
  spread: number;
  spreadPct: number;
  spreadScore: number;
  imbalance: number;
  vpin: number;
  microstructureScore: number;
  platform?: string;
}): Promise<void> {
  const database = await getDb();
  if (!database) return;
  await database.insert(marketMicrostructure).values({
    marketId: data.marketId,
    platform: data.platform ?? "kalshi",
    spread: data.spread,
    spreadPct: data.spreadPct,
    spreadScore: data.spreadScore,
    imbalance: data.imbalance,
    vpin: data.vpin,
    microstructureScore: data.microstructureScore,
  });
}

// Bayesian Signal Updates
export async function getSignalById(
  signalId: number,
  dbInstance?: Awaited<ReturnType<typeof getDb>>
) {
  const database = dbInstance || (await getDb());
  if (!database) return null;

  const result = await database
    .select()
    .from(kalshiSignals)
    .where(eq(kalshiSignals.id, signalId))
    .limit(1);

  return result[0] || null;
}

export async function insertBayesianUpdate(
  update: {
    signalId: number;
    userId: number;
    prior: number;
    likelihood: number;
    evidenceProb: number;
    posterior: number;
    evidenceType: string;
    evidenceValue: number;
    evidenceDirection: string;
    evidenceMetadata: string | null;
    weight: number;
  },
  dbInstance?: Awaited<ReturnType<typeof getDb>>
) {
  const database = dbInstance || (await getDb());
  if (!database) return;

  const scopedUserId = assertPositiveIntegerUserId(
    update.userId,
    "insertBayesianUpdate userId"
  );

  await database.insert(signalBayesianUpdates).values({
    signalId: update.signalId,
    userId: scopedUserId,
    prior: update.prior,
    likelihood: update.likelihood,
    evidenceProb: update.evidenceProb,
    posterior: update.posterior,
    evidenceType: update.evidenceType as any,
    evidenceValue: update.evidenceValue,
    evidenceDirection: update.evidenceDirection as any,
    evidenceMetadata: update.evidenceMetadata,
    weight: update.weight,
  });
}

export async function updateSignalBayesianProbability(
  signalId: number,
  bayesianProbability: number,
  dbInstance?: Awaited<ReturnType<typeof getDb>>
) {
  const database = dbInstance || (await getDb());
  if (!database) return;

  await database
    .update(kalshiSignals)
    .set({ bayesianProbability })
    .where(eq(kalshiSignals.id, signalId));
}

export async function getBayesianUpdatesForSignal(
  signalId: number,
  dbInstance?: Awaited<ReturnType<typeof getDb>>
) {
  const database = dbInstance || (await getDb());
  if (!database) return [];

  const updates = await database
    .select()
    .from(signalBayesianUpdates)
    .where(eq(signalBayesianUpdates.signalId, signalId))
    .orderBy(signalBayesianUpdates.updatedAt);

  return updates;
}

// Kalshi capital queries
export async function initializeKalshiCapital(
  startingBalance: number,
  userId: number
) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "initializeKalshiCapital userId"
  );
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
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getKalshiCapital userId"
  );
  const database = await getDb();
  if (!database) return null;

  const result = await database
    .select()
    .from(kalshiCapital)
    .where(eq(kalshiCapital.userId, scopedUserId))
    .limit(1);
  return result[0] || null;
}

export async function syncKalshiCapitalWithLiveEquity(
  liveEquity: number,
  userId: number
) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "syncKalshiCapitalWithLiveEquity userId"
  );
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
    (!Number.isFinite(Number(existing.startingBalance)) ||
      Number(existing.startingBalance) <= 0 ||
      (Number(existing.startingBalance) === 100 && normalizedEquity !== 100));

  await database
    .update(kalshiCapital)
    .set({
      currentBalance: normalizedEquity,
      ...(shouldResetStartingBalance
        ? { startingBalance: normalizedEquity }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(kalshiCapital.id, existing.id));

  return await getKalshiCapital(scopedUserId);
}

export async function updateKalshiCapital(updates: any, userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "updateKalshiCapital userId"
  );
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
  autonomyMode:
    | "manual"
    | "approval_required"
    | "semi_autonomous"
    | "fully_autonomous";
  executionCadence:
    | "manual_only"
    | "session_assisted"
    | "hourly_watch"
    | "continuous_watch";
  appliedGuardrails?: string | null;
}) {
  const scopedUserId = assertPositiveIntegerUserId(
    run.userId,
    "createAutonomyRun userId"
  );
  const database = await getDb();
  if (!database) return null;

  // Use ON CONFLICT DO NOTHING + a follow-up SELECT.  Catching the unique-
  // violation by inspecting `error.code` was unreliable on the neon-http
  // driver: Drizzle wraps the underlying NeonDbError in a DrizzleQueryError
  // and the Postgres SQLSTATE never reaches the top-level error object, so
  // duplicate-key inserts were re-thrown and crashed the scheduler tick.
  // onConflictDoNothing pushes the conflict resolution into the SQL plan and
  // simply returns no row when the runKey is already taken — the SELECT below
  // returns null in that case, which is exactly the dedup contract callers
  // expect.
  await database
    .insert(autonomyRuns)
    .values({
      runId: run.runId,
      runKey: run.runKey,
      userId: scopedUserId,
      triggeredByOpenId: assertNonEmptyOpenId(
        run.triggeredByOpenId,
        "createAutonomyRun triggeredByOpenId"
      ),
      triggerSource: String(run.triggerSource || "unknown").slice(0, 32),
      autonomyMode: run.autonomyMode,
      executionCadence: run.executionCadence,
      appliedGuardrails: run.appliedGuardrails ?? null,
    })
    .onConflictDoNothing({ target: autonomyRuns.runKey });

  const created = await database
    .select()
    .from(autonomyRuns)
    .where(
      and(
        eq(autonomyRuns.runId, run.runId),
        eq(autonomyRuns.userId, scopedUserId)
      )
    )
    .then((rows: any[]) => rows[0]);

  return created ?? null;
}

export async function updateAutonomyRun(
  runId: string,
  userId: number,
  updates: Record<string, unknown>
) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "updateAutonomyRun userId"
  );
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
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getLatestAutonomyRun userId"
  );
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
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getRecentAutonomyRuns userId"
  );
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
  entityId?: number | null
) {
  const scopedOpenId = assertNonEmptyOpenId(
    triggeredByOpenId,
    "logAuditEvent triggeredByOpenId"
  );
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
    logger.error({ err: error }, "[AuditLog] Failed to write audit event");
    return false;
  }
}

export async function getLatestAuditEventByType(
  eventType: string,
  triggeredByOpenId: string
) {
  const scopedOpenId = assertNonEmptyOpenId(
    triggeredByOpenId,
    "getLatestAuditEventByType triggeredByOpenId"
  );
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

export async function getAuditLog(
  limitDays: number = 7,
  triggeredByOpenId: string
) {
  const scopedOpenId = assertNonEmptyOpenId(
    triggeredByOpenId,
    "getAuditLog triggeredByOpenId"
  );
  const database = await getDb();
  if (!database) return [];

  const cutoffDate = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000);
  const conditions = and(
    gte(auditLog.createdAt, cutoffDate),
    eq(auditLog.triggeredByOpenId, scopedOpenId)
  );

  // Hard cap: the audit log can grow to millions of rows over months of
  // continuous autonomy; an unbounded query under load can stall the
  // dashboard and exhaust the Neon connection pool.  500 rows is enough
  // for the UI's audit page (which paginates client-side anyway) and the
  // 7-day cutoff already applied above.
  return await database
    .select()
    .from(auditLog)
    .where(conditions)
    .orderBy(desc(auditLog.createdAt))
    .limit(500);
}

/**
 * Delete auditLog rows older than `retentionDays` (default 90).  The
 * scheduler in server/_core/index.ts runs this once at startup and then
 * every 24 hours so the table doesn't grow unboundedly.  Indexed by
 * createdAt (drizzle/migrations/0008) so the range delete is O(deleted),
 * not O(table).
 *
 * Returns { deleted } so the caller can log the count for observability.
 */
export async function cleanupOldAuditLogEntries(retentionDays = 90) {
  const database = await getDb();
  if (!database) return { deleted: 0 };
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  // Drizzle's neon-http delete doesn't return a row count; we issue raw SQL
  // so we can surface "how much did we just prune" in the audit and logs.
  const result = await database.execute(
    sql`DELETE FROM "auditLog" WHERE "createdAt" < ${cutoff} RETURNING 1`,
  );
  // Result shape varies across drivers; prefer the standard rowCount and
  // fall back to the rows array length.
  const deleted =
    typeof (result as { rowCount?: number }).rowCount === "number"
      ? (result as { rowCount?: number }).rowCount ?? 0
      : Array.isArray((result as { rows?: unknown[] }).rows)
        ? ((result as { rows?: unknown[] }).rows ?? []).length
        : 0;
  return { deleted };
}

/**
 * Lightweight DB connectivity probe — used by the /api/health endpoint.
 * Returns true if the database responds, false otherwise.  Bounded by a
 * hard timeout so a hung Neon endpoint cannot stall the health-check
 * request and cause Railway to mark the container unhealthy.
 */
export async function pingDb(timeoutMs = 2000): Promise<boolean> {
  const database = await getDb();
  if (!database) return false;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const probe = database.execute(sql`SELECT 1`);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("pingDb timeout")), timeoutMs);
    });
    await Promise.race([probe, timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface DbHealthResult {
  status: "ok" | "error";
  latencyMs: number;
}

/**
 * Measures DB reachability and latency in a single call.
 * Returned by the /api/health and /api/health/ready routes so the logic
 * lives in one place rather than being copy-pasted between handlers.
 */
export async function checkDbHealth(): Promise<DbHealthResult> {
  const t0 = Date.now();
  const alive = await pingDb();
  return {
    status: alive ? "ok" : "error",
    latencyMs: Date.now() - t0,
  };
}

// Kalshi fill queries
export async function createKalshiFill(fill: {
  userId: number;
  orderId: string;
  marketId: string;
  fillPrice: number;
  fillQuantity: number;
}) {
  const scopedUserId = assertPositiveIntegerUserId(
    fill.userId,
    "createKalshiFill userId"
  );
  const database = await getDb();
  if (!database) return null;

  const result = await database.insert(kalshiFills).values({
    userId: scopedUserId,
    orderId: fill.orderId,
    marketId: fill.marketId,
    fillPrice: fill.fillPrice,
    fillQuantity: fill.fillQuantity,
  });

  return result;
}

export async function getKalshiFillsByOrder(orderId: string, userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getKalshiFillsByOrder userId"
  );
  const database = await getDb();
  if (!database) return [];

  return await database
    .select()
    .from(kalshiFills)
    .where(
      and(
        eq(kalshiFills.orderId, orderId),
        eq(kalshiFills.userId, scopedUserId)
      )
    )
    .orderBy(desc(kalshiFills.fillTime));
}

// Autonomy run detail query
export async function getAutonomyRunDetail(runId: string, userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getAutonomyRunDetail userId"
  );
  const database = await getDb();
  if (!database) return null;

  const result = await database
    .select()
    .from(autonomyRuns)
    .where(
      and(eq(autonomyRuns.runId, runId), eq(autonomyRuns.userId, scopedUserId))
    )
    .limit(1);

  return result[0] ?? null;
}

// Beta access helpers
export async function setBetaAccessLevel(
  userId: number,
  level: "none" | "internal" | "invited" | "public"
) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "setBetaAccessLevel userId"
  );
  const database = await getDb();
  if (!database) throw new Error("Database not available");

  await database
    .update(users)
    .set({ betaAccessLevel: level })
    .where(eq(users.id, scopedUserId));

  const updated = await database
    .select()
    .from(users)
    .where(eq(users.id, scopedUserId))
    .limit(1);

  return updated[0] ?? null;
}

export async function getUserBetaAccessLevel(userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getUserBetaAccessLevel userId"
  );
  const database = await getDb();
  if (!database) return "none" as const;

  const result = await database
    .select({ betaAccessLevel: users.betaAccessLevel })
    .from(users)
    .where(eq(users.id, scopedUserId))
    .limit(1);

  return (result[0]?.betaAccessLevel ?? "none") as
    | "none"
    | "internal"
    | "invited"
    | "public";
}

// Portfolio Volatility History
export async function savePortfolioVolatility(data: {
  userId: number;
  annualizedVol: number;
  dailyVol: number;
  volScalingFactor: number;
  positionCount: number;
  targetVol: number;
}): Promise<void> {
  const database = await getDb();
  if (!database) return;
  const scopedUserId = assertPositiveIntegerUserId(
    data.userId,
    "savePortfolioVolatility userId"
  );
  await database.insert(portfolioVolatilityHistory).values({
    userId: scopedUserId,
    annualizedVol: data.annualizedVol,
    dailyVol: data.dailyVol,
    volScalingFactor: data.volScalingFactor,
    positionCount: data.positionCount,
    targetVol: data.targetVol,
  });
}

// Position Exit Tracking
export async function savePositionExit(data: {
  positionId: string;
  userId: number;
  platform?: string;
  exitReason:
    | "stop_loss"
    | "trailing_stop"
    | "profit_target_1"
    | "profit_target_2"
    | "profit_target_3"
    | "time_decay"
    | "volatility_adjustment"
    | "manual";
  entryPrice: number;
  exitPrice: number;
  stopLevel?: number;
  profitTargetHit?: number;
}): Promise<void> {
  const database = await getDb();
  if (!database) return;
  const scopedUserId = assertPositiveIntegerUserId(
    data.userId,
    "savePositionExit userId"
  );
  const pnlPct = (data.exitPrice - data.entryPrice) / data.entryPrice;
  await database.insert(positionExits).values({
    positionId: data.positionId,
    userId: scopedUserId,
    platform: data.platform ?? "kalshi",
    exitReason: data.exitReason,
    entryPrice: data.entryPrice,
    exitPrice: data.exitPrice,
    pnlPct,
    stopLevel: data.stopLevel ?? null,
    profitTargetHit: data.profitTargetHit ?? null,
  });
}

// ── ML Ensemble Model Persistence ─────────────────────────────────────────────

/**
 * Persist a trained ensemble model to the database.
 * Deactivates all previous models for the same platform before inserting the new one.
 */
export async function saveEnsembleModel(data: {
  version: number;
  platform?: string;
  modelJson: string;
  trainingSamples: number;
  accuracy?: number;
}): Promise<void> {
  const database = await getDb();
  if (!database) return;

  const platform = data.platform ?? "kalshi";

  // Deactivate previous active models for this platform
  await database
    .update(mlEnsembleModels)
    .set({ isActive: 0 })
    .where(eq(mlEnsembleModels.platform, platform));

  await database.insert(mlEnsembleModels).values({
    version: data.version,
    platform,
    modelJson: data.modelJson,
    trainingSamples: data.trainingSamples,
    accuracy: data.accuracy ?? null,
    isActive: 1,
  });
}

export async function saveMarketSentiment(data: {
  marketId: string;
  platform?: string;
  compositeScore: number;
  compositeConfidence: number;
  sentimentMomentum: number;
  isAlertTriggered: boolean;
  gdeltScore?: number | null;
  redditScore?: number | null;
  twitterScore?: number | null;
  expertScore?: number | null;
  consensusScore?: number | null;
}): Promise<void> {
  const database = await getDb();
  if (!database) return;

  await database.insert(marketSentimentHistory).values({
    marketId: data.marketId,
    platform: data.platform ?? "kalshi",
    compositeScore: data.compositeScore,
    compositeConfidence: data.compositeConfidence,
    sentimentMomentum: data.sentimentMomentum,
    isAlertTriggered: data.isAlertTriggered ? 1 : 0,
    gdeltScore: data.gdeltScore ?? null,
    redditScore: data.redditScore ?? null,
    twitterScore: data.twitterScore ?? null,
    expertScore: data.expertScore ?? null,
    consensusScore: data.consensusScore ?? null,
  });
}

export async function saveExecutionQuality(data: {
  orderId: string;
  userId: number;
  platform?: string;
  strategy: string;
  expectedPrice: number;
  actualPrice?: number | null;
  slippagePct?: number | null;
  targetBudgetUsd: number;
}): Promise<void> {
  const database = await getDb();
  if (!database) return;

  await database.insert(executionQualityMetrics).values({
    orderId: data.orderId,
    userId: data.userId,
    platform: data.platform ?? "kalshi",
    strategy: data.strategy,
    expectedPrice: data.expectedPrice,
    actualPrice: data.actualPrice ?? null,
    slippagePct: data.slippagePct ?? null,
    targetBudgetUsd: data.targetBudgetUsd,
  });
}

export async function saveCrossPlatformArbitrageExecution(data: {
  userId: number;
  kalshiMarketId: string;
  polymarketMarketId: string;
  buyPlatform: "kalshi" | "polymarket";
  netEdge: number;
  feeBurden: number;
  executionRisk: number;
  hedgeRatio: number;
  bothLegsExecuted: boolean;
  kalshiOrderId?: string | null;
  polymarketOrderId?: string | null;
  partialLegAction?: "hold" | "hedge" | "exit" | null;
  pnlAttributionArb?: number;
  pnlAttributionMarketMove?: number;
}): Promise<void> {
  const database = await getDb();
  if (!database) return;

  await database.insert(crossPlatformArbitrageExecutions).values({
    userId: data.userId,
    kalshiMarketId: data.kalshiMarketId,
    polymarketMarketId: data.polymarketMarketId,
    buyPlatform: data.buyPlatform,
    netEdge: data.netEdge,
    feeBurden: data.feeBurden,
    executionRisk: data.executionRisk,
    hedgeRatio: data.hedgeRatio,
    bothLegsExecuted: data.bothLegsExecuted ? 1 : 0,
    kalshiOrderId: data.kalshiOrderId ?? null,
    polymarketOrderId: data.polymarketOrderId ?? null,
    partialLegAction: data.partialLegAction ?? null,
    pnlAttributionArb: data.pnlAttributionArb ?? data.netEdge,
    pnlAttributionMarketMove: data.pnlAttributionMarketMove ?? 0,
  });
}

export async function saveOnlineLearningUpdate(data: {
  userId: number;
  platform: "kalshi" | "polymarket";
  signalType: string;
  outcome: "win" | "loss" | "breakeven";
  pnl: number;
  weightBefore: number;
  weightAfter: number;
  emaPnl: number;
  driftDetected: boolean;
  explorationTaken: boolean;
  confidenceLower: number;
  confidenceUpper: number;
  modelVersion: number;
}): Promise<void> {
  const database = await getDb();
  if (!database) return;

  await database.insert(onlineLearningUpdates).values({
    userId: data.userId,
    platform: data.platform,
    signalType: data.signalType,
    outcome: data.outcome,
    pnl: data.pnl,
    weightBefore: data.weightBefore,
    weightAfter: data.weightAfter,
    emaPnl: data.emaPnl,
    driftDetected: data.driftDetected ? 1 : 0,
    explorationTaken: data.explorationTaken ? 1 : 0,
    confidenceLower: data.confidenceLower,
    confidenceUpper: data.confidenceUpper,
    modelVersion: data.modelVersion,
  });
}

export async function getRecentOnlineLearningUpdates(
  userId: number,
  platform: "kalshi" | "polymarket",
  limit: number = 200
) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getRecentOnlineLearningUpdates userId"
  );
  const database = await getDb();
  if (!database) return [];

  return await database
    .select()
    .from(onlineLearningUpdates)
    .where(
      and(
        eq(onlineLearningUpdates.userId, scopedUserId),
        eq(onlineLearningUpdates.platform, platform)
      )
    )
    .orderBy(desc(onlineLearningUpdates.createdAt))
    .limit(limit);
}

export async function savePerformanceAttribution(data: {
  userId: number;
  platform: "kalshi" | "polymarket";
  marketId: string;
  signalType: string;
  category: string;
  totalPnl: number;
  signalAlpha: number;
  execution: number;
  timing: number;
  luck: number;
}): Promise<void> {
  const database = await getDb();
  if (!database) return;

  await database.insert(performanceAttribution).values({
    userId: data.userId,
    platform: data.platform,
    marketId: data.marketId,
    signalType: data.signalType,
    category: data.category,
    totalPnl: data.totalPnl,
    signalAlpha: data.signalAlpha,
    execution: data.execution,
    timing: data.timing,
    luck: data.luck,
  });
}

export async function getPerformanceAttributionHistory(
  userId: number,
  platform: "kalshi" | "polymarket",
  limit: number = 200
) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getPerformanceAttributionHistory userId"
  );
  const database = await getDb();
  if (!database) return [];

  return await database
    .select()
    .from(performanceAttribution)
    .where(
      and(
        eq(performanceAttribution.userId, scopedUserId),
        eq(performanceAttribution.platform, platform)
      )
    )
    .orderBy(desc(performanceAttribution.createdAt))
    .limit(limit);
}

/**
 * Reconstruct an equity-curve series from closed positions.
 *
 * Returns one point per UTC day where at least one trade closed, plus a
 * leading point at the first close date with the starting balance. The
 * caller (UI) typically prepends the starting balance / appends current
 * balance as needed.
 */
export async function getKalshiEquityCurve(
  userId: number,
  limitDays: number = 365
) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getKalshiEquityCurve userId"
  );
  const database = await getDb();
  if (!database) return [];

  const cutoff = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000);

  const closed = await database
    .select({
      closedAt: kalshiPositions.closedAt,
      realizedPnl: kalshiPositions.realizedPnl,
    })
    .from(kalshiPositions)
    .where(
      and(
        eq(kalshiPositions.userId, scopedUserId),
        eq(kalshiPositions.positionStatus, "closed"),
        gte(kalshiPositions.closedAt, cutoff)
      )
    )
    .orderBy(kalshiPositions.closedAt);

  // Aggregate realized PnL per UTC day.
  const dailyPnl = new Map<string, number>();
  for (const row of closed) {
    const closedAt = row.closedAt as Date | null;
    if (!closedAt) continue;
    const key = new Date(
      Date.UTC(
        closedAt.getUTCFullYear(),
        closedAt.getUTCMonth(),
        closedAt.getUTCDate()
      )
    )
      .toISOString()
      .split("T")[0];
    const pnl = Number(row.realizedPnl ?? 0);
    if (!Number.isFinite(pnl)) continue;
    dailyPnl.set(key, (dailyPnl.get(key) ?? 0) + pnl);
  }

  return Array.from(dailyPnl.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, pnl]) => ({ date, realizedPnl: pnl }));
}

/**
 * Aggregate filled-order activity by day-of-week (0=Sun..6=Sat) and
 * UTC hour-of-day, for the activity heatmap. Falls back to order
 * createdAt when filledAt is null so pending/cancelled orders still
 * surface as "attempted" activity.
 */
export async function getKalshiActivityHeatmap(
  userId: number,
  limitDays: number = 90
) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "getKalshiActivityHeatmap userId"
  );
  const database = await getDb();
  if (!database) return [];

  const cutoff = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000);

  const orders = await database
    .select({
      createdAt: kalshiOrders.createdAt,
      filledAt: kalshiOrders.filledAt,
    })
    .from(kalshiOrders)
    .where(
      and(
        eq(kalshiOrders.userId, scopedUserId),
        gte(kalshiOrders.createdAt, cutoff)
      )
    );

  const buckets = new Map<string, number>();
  for (const row of orders) {
    const at = (row.filledAt as Date | null) ?? (row.createdAt as Date | null);
    if (!at) continue;
    const dow = at.getUTCDay(); // 0=Sun..6=Sat
    const hour = at.getUTCHours();
    const key = `${dow}:${hour}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return Array.from(buckets.entries()).map(([key, count]) => {
    const [dow, hour] = key.split(":").map(Number);
    return { dow, hour, count };
  });
}
