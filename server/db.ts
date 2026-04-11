import { eq, desc, asc, gte, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  bots,
  positions,
  trades,
  reasoningLogs,
  equitySnapshots,
  alerts,
  killSwitchEvents,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ============================================
// PORTFOLIO & ANALYTICS QUERIES
// ============================================

export async function getLatestEquitySnapshot(
  scope: "global" | "stocks" | "crypto" | "prediction"
) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(equitySnapshots)
    .where(eq(equitySnapshots.scope, scope))
    .orderBy(desc(equitySnapshots.recordedAt))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getEquityHistory(
  scope: "global" | "stocks" | "crypto" | "prediction",
  limitDays: number = 30
) {
  const db = await getDb();
  if (!db) return [];

  const cutoffDate = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000);

  return await db
    .select()
    .from(equitySnapshots)
    .where(
      and(
        eq(equitySnapshots.scope, scope),
        gte(equitySnapshots.recordedAt, cutoffDate)
      )
    )
    .orderBy(asc(equitySnapshots.recordedAt));
}

// ============================================
// BOT QUERIES
// ============================================

export async function getAllBots() {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(bots).orderBy(desc(bots.updatedAt));
}

export async function getBotById(botId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(bots)
    .where(eq(bots.id, botId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getBotsByMarket(
  market: "stocks" | "crypto" | "prediction"
) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(bots)
    .where(eq(bots.market, market))
    .orderBy(desc(bots.updatedAt));
}

export async function updateBotStatus(
  botId: number,
  status: "running" | "paused" | "stopped"
) {
  const db = await getDb();
  if (!db) return false;

  try {
    await db
      .update(bots)
      .set({ status, updatedAt: new Date() })
      .where(eq(bots.id, botId));
    return true;
  } catch (error) {
    console.error("[Database] Failed to update bot status:", error);
    return false;
  }
}

// ============================================
// POSITION QUERIES
// ============================================

export async function getOpenPositions() {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(positions)
    .where(eq(positions.status, "open"))
    .orderBy(desc(positions.openedAt));
}

export async function getOpenPositionsByMarket(
  market: "stocks" | "crypto" | "prediction"
) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(positions)
    .where(and(eq(positions.status, "open"), eq(positions.market, market)))
    .orderBy(desc(positions.openedAt));
}

export async function getPositionById(positionId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(positions)
    .where(eq(positions.id, positionId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function closePosition(
  positionId: number,
  closingPrice: number
) {
  const db = await getDb();
  if (!db) return false;

  try {
    const position = await getPositionById(positionId);
    if (!position) return false;

    // Calculate PnL based on position side
    let realizedPnl = 0;
    if (position.side === "long") {
      realizedPnl = (closingPrice - position.entryPrice) * position.size;
    } else if (position.side === "short") {
      realizedPnl = (position.entryPrice - closingPrice) * position.size;
    } else if (position.side === "yes") {
      // Prediction market YES side: profit if price goes to 1
      realizedPnl = (1 - position.entryPrice) * position.size;
    } else if (position.side === "no") {
      // Prediction market NO side: profit if price goes to 0
      realizedPnl = position.entryPrice * position.size;
    }

    await db
      .update(positions)
      .set({
        status: "closed",
        closedAt: new Date(),
        realizedPnl,
        updatedAt: new Date(),
      })
      .where(eq(positions.id, positionId));

    return true;
  } catch (error) {
    console.error("[Database] Failed to close position:", error);
    return false;
  }
}

// ============================================
// TRADE QUERIES
// ============================================

export async function getTradeHistory(limitDays: number = 30) {
  const db = await getDb();
  if (!db) return [];

  const cutoffDate = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000);

  return await db
    .select()
    .from(trades)
    .where(gte(trades.executedAt, cutoffDate))
    .orderBy(desc(trades.executedAt));
}

export async function getTradesByMarket(
  market: "stocks" | "crypto" | "prediction",
  limitDays: number = 30
) {
  const db = await getDb();
  if (!db) return [];

  const cutoffDate = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000);

  return await db
    .select()
    .from(trades)
    .where(
      and(eq(trades.market, market), gte(trades.executedAt, cutoffDate))
    )
    .orderBy(desc(trades.executedAt));
}

export async function createTrade(
  botId: number,
  symbol: string,
  market: "stocks" | "crypto" | "prediction",
  side: "long" | "short" | "yes" | "no",
  action: "open" | "close" | "rebalance" | "hedge",
  quantity: number,
  fillPrice: number,
  strategyTag: string
) {
  const db = await getDb();
  if (!db) return undefined;

  try {
    const result = await db.insert(trades).values({
      botId,
      symbol,
      market,
      side,
      action,
      quantity,
      fillPrice,
      pnl: 0,
      strategyTag,
      executedAt: new Date(),
    });

    return result;
  } catch (error) {
    console.error("[Database] Failed to create trade:", error);
    return undefined;
  }
}

// ============================================
// REASONING LOG QUERIES
// ============================================

export async function getReasoningLogs(limitDays: number = 7) {
  const db = await getDb();
  if (!db) return [];

  const cutoffDate = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000);

  return await db
    .select()
    .from(reasoningLogs)
    .where(gte(reasoningLogs.createdAt, cutoffDate))
    .orderBy(desc(reasoningLogs.createdAt));
}

export async function getReasoningLogsByMarket(
  market: "stocks" | "crypto" | "prediction",
  limitDays: number = 7
) {
  const db = await getDb();
  if (!db) return [];

  const cutoffDate = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000);

  return await db
    .select()
    .from(reasoningLogs)
    .where(
      and(
        eq(reasoningLogs.market, market),
        gte(reasoningLogs.createdAt, cutoffDate)
      )
    )
    .orderBy(desc(reasoningLogs.createdAt));
}

export async function createReasoningLog(
  botId: number | null,
  market: "stocks" | "crypto" | "prediction",
  signal: "trade" | "hold" | "reduce" | "close" | "hedge",
  correlationScore: number,
  confidenceScore: number,
  headline: string,
  explanation: string,
  regimeSummary: string,
  opportunityTitle: string
) {
  const db = await getDb();
  if (!db) return undefined;

  try {
    const result = await db.insert(reasoningLogs).values({
      botId,
      market,
      signal,
      correlationScore,
      confidenceScore,
      headline,
      explanation,
      regimeSummary,
      opportunityTitle,
      createdAt: new Date(),
    });

    return result;
  } catch (error) {
    console.error("[Database] Failed to create reasoning log:", error);
    return undefined;
  }
}

// ============================================
// ALERT QUERIES
// ============================================

export async function getAlerts(limitDays: number = 7) {
  const db = await getDb();
  if (!db) return [];

  const cutoffDate = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000);

  return await db
    .select()
    .from(alerts)
    .where(gte(alerts.createdAt, cutoffDate))
    .orderBy(desc(alerts.createdAt));
}

export async function createAlert(
  eventType:
    | "position_open"
    | "position_close"
    | "drawdown_breach"
    | "kill_switch",
  severity: "info" | "warning" | "critical",
  title: string,
  content: string,
  dedupeKey: string
) {
  const db = await getDb();
  if (!db) return false;

  try {
    await db.insert(alerts).values({
      eventType,
      severity,
      title,
      content,
      dedupeKey,
      createdAt: new Date(),
    });

    return true;
  } catch (error) {
    console.error("[Database] Failed to create alert:", error);
    return false;
  }
}

// ============================================
// KILL SWITCH QUERIES
// ============================================

export async function recordKillSwitchEvent(
  triggeredByOpenId: string,
  reason: string,
  flattenedPositions: number,
  haltedBots: number
) {
  const db = await getDb();
  if (!db) return false;

  try {
    await db.insert(killSwitchEvents).values({
      triggeredByOpenId,
      reason,
      flattenedPositions,
      haltedBots,
      createdAt: new Date(),
    });

    return true;
  } catch (error) {
    console.error("[Database] Failed to record kill switch event:", error);
    return false;
  }
}

export async function getKillSwitchHistory(limitDays: number = 30) {
  const db = await getDb();
  if (!db) return [];

  const cutoffDate = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000);

  return await db
    .select()
    .from(killSwitchEvents)
    .where(gte(killSwitchEvents.createdAt, cutoffDate))
    .orderBy(desc(killSwitchEvents.createdAt));
}
