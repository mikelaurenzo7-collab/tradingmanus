/**
 * Daily-play pick lifecycle persistence.
 *
 * One row per pick fired by the daily sports / moonshot plays across both
 * Kalshi and Polymarket.  Lifecycle:
 *
 *   insert (status=pending) → linkPosition (after position-sync) →
 *   close (status=won|lost|closed_breakeven|partial)
 *
 * The unique index on (userId, platform, playType, playDate) makes the
 * insert idempotent at the DB level — a duplicate run within the same
 * UTC day no-ops via ON CONFLICT DO NOTHING and returns null.  Callers
 * treat null as "already ran today, skip".
 */

import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { dailyPlayPicks, type DailyPlayPick, type NewDailyPlayPick } from "../drizzle/schema";
import { getDb } from "./db";
import { logger } from "./_core/logger";

export type DailyPlayPlatform = "kalshi" | "polymarket";
export type DailyPlayType = "sports" | "moonshot";
export type DailyPlayStatus =
  | "pending"
  | "won"
  | "lost"
  | "partial"
  | "closed_breakeven"
  | "voided";

export interface InsertDailyPlayPickInput {
  userId: number;
  platform: DailyPlayPlatform;
  playType: DailyPlayType;
  /** UTC date string YYYY-MM-DD. */
  playDate: string;
  marketId: string;
  tokenId?: string | null;
  signalId?: number | null;
  side: "yes" | "no";
  stakeUsd: number;
  entryPrice: number;
  quantity?: number | null;
  confidence?: number | null;
  expectedValue?: number | null;
  reasoning?: string | null;
  linkedPositionId?: number | null;
}

/**
 * Insert a new pending pick.  Returns the inserted row, or `null` if a
 * pick already exists for this (userId, platform, playType, playDate)
 * — the caller should treat that as "already ran today".
 */
export async function insertDailyPlayPick(
  input: InsertDailyPlayPickInput,
): Promise<DailyPlayPick | null> {
  const database = await getDb();
  if (!database) throw new Error("Database not initialized");

  const row: NewDailyPlayPick = {
    userId: input.userId,
    platform: input.platform,
    playType: input.playType,
    playDate: input.playDate,
    marketId: input.marketId,
    tokenId: input.tokenId ?? null,
    signalId: input.signalId ?? null,
    side: input.side,
    stakeUsd: input.stakeUsd,
    entryPrice: input.entryPrice,
    quantity: input.quantity ?? null,
    confidence: input.confidence ?? null,
    expectedValue: input.expectedValue ?? null,
    reasoning: input.reasoning ?? null,
    status: "pending",
    linkedPositionId: input.linkedPositionId ?? null,
  };

  try {
    const inserted = await database
      .insert(dailyPlayPicks)
      .values(row)
      .onConflictDoNothing({
        target: [
          dailyPlayPicks.userId,
          dailyPlayPicks.platform,
          dailyPlayPicks.playType,
          dailyPlayPicks.playDate,
        ],
      })
      .returning();
    return inserted[0] ?? null;
  } catch (err) {
    logger.error({ err, input }, "[DailyPlayPicks] insert failed");
    throw err;
  }
}

/**
 * Populate `linkedPositionId` once position-sync has surfaced the row.
 * Matches by (userId, platform, playType, marketId, tokenId?, playDate) so
 * we can link even when the caller doesn't yet have the pick id (e.g. async
 * position-sync poll discovering the position after order placement).
 *
 * `playType` is required so a sports pick and moonshot pick on the same
 * market+date never collide on linkage.
 */
export async function linkPositionToPick(args: {
  userId: number;
  platform: DailyPlayPlatform;
  playType: DailyPlayType;
  marketId: string;
  tokenId?: string | null;
  playDate: string;
  linkedPositionId: number;
}): Promise<void> {
  const database = await getDb();
  if (!database) throw new Error("Database not initialized");
  const conditions = [
    eq(dailyPlayPicks.userId, args.userId),
    eq(dailyPlayPicks.platform, args.platform),
    eq(dailyPlayPicks.playType, args.playType),
    eq(dailyPlayPicks.marketId, args.marketId),
    eq(dailyPlayPicks.playDate, args.playDate),
    isNull(dailyPlayPicks.linkedPositionId),
  ];
  if (args.tokenId) {
    conditions.push(eq(dailyPlayPicks.tokenId, args.tokenId));
  }
  await database
    .update(dailyPlayPicks)
    .set({ linkedPositionId: args.linkedPositionId, updatedAt: new Date() })
    .where(and(...conditions));
}

/**
 * Mark a previously-reserved pick as `voided` — used when the runner
 * pre-reserves the daily slot before order placement and the order then
 * fails / is rejected.  Voiding (instead of deleting) preserves the
 * audit trail; a fresh insert for the same (userId, platform, playType,
 * playDate) key would still conflict, so retries within the same UTC
 * day are intentionally suppressed (matches the original "one shot per
 * day" intent).
 */
export async function voidDailyPlayPick(args: {
  pickId: number;
  reason: string;
}): Promise<void> {
  const database = await getDb();
  if (!database) return;
  try {
    await database
      .update(dailyPlayPicks)
      .set({
        status: "voided",
        reasoning: args.reason.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(dailyPlayPicks.id, args.pickId));
  } catch (err) {
    logger.warn({ err, args }, "[DailyPlayPicks] void failed");
  }
}

/**
 * Close any pending daily pick that links to the given position.  Status
 * derived from realizedPnl: `>0` won, `<0` lost, `=0` closed_breakeven.
 *
 * Best-effort: errors are logged and swallowed so a flaky DB never
 * blocks the upstream position close.
 */
export async function closeDailyPlayPickByPosition(args: {
  platform: DailyPlayPlatform;
  linkedPositionId: number;
  exitPrice: number | null;
  realizedPnl: number;
  closedAt: Date;
}): Promise<void> {
  const database = await getDb();
  if (!database) return;
  const status: DailyPlayStatus =
    args.realizedPnl > 0 ? "won" : args.realizedPnl < 0 ? "lost" : "closed_breakeven";
  try {
    await database
      .update(dailyPlayPicks)
      .set({
        status,
        exitPrice: args.exitPrice ?? null,
        realizedPnl: args.realizedPnl,
        closedAt: args.closedAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dailyPlayPicks.platform, args.platform),
          eq(dailyPlayPicks.linkedPositionId, args.linkedPositionId),
          eq(dailyPlayPicks.status, "pending"),
        ),
      );
  } catch (err) {
    logger.warn({ err, args }, "[DailyPlayPicks] closeByPosition failed");
  }
}

/**
 * Fallback close hook for when `linkedPositionId` is null on the pick row
 * (the 30s window between order placement and position-sync surfacing).
 *
 * Predicate is narrowed by `playDate` (required) and optionally `playType`
 * to avoid sweeping unrelated pending rows on the same market.  Callers
 * that don't know the playType (most close paths — they only know the
 * position is closing) should anchor `playDate` to today's UTC date so
 * we only update the very recent reservation in the linkage race window.
 */
export async function closeDailyPlayPickByMarketFallback(args: {
  userId: number;
  platform: DailyPlayPlatform;
  playDate: string;
  playType?: DailyPlayType;
  marketId: string;
  tokenId?: string | null;
  exitPrice: number | null;
  realizedPnl: number;
  closedAt: Date;
}): Promise<void> {
  const database = await getDb();
  if (!database) return;
  const status: DailyPlayStatus =
    args.realizedPnl > 0 ? "won" : args.realizedPnl < 0 ? "lost" : "closed_breakeven";
  const conditions = [
    eq(dailyPlayPicks.userId, args.userId),
    eq(dailyPlayPicks.platform, args.platform),
    eq(dailyPlayPicks.playDate, args.playDate),
    eq(dailyPlayPicks.marketId, args.marketId),
    eq(dailyPlayPicks.status, "pending"),
    isNull(dailyPlayPicks.linkedPositionId),
  ];
  if (args.playType) conditions.push(eq(dailyPlayPicks.playType, args.playType));
  if (args.tokenId) conditions.push(eq(dailyPlayPicks.tokenId, args.tokenId));
  try {
    await database
      .update(dailyPlayPicks)
      .set({
        status,
        exitPrice: args.exitPrice ?? null,
        realizedPnl: args.realizedPnl,
        closedAt: args.closedAt,
        updatedAt: new Date(),
      })
      .where(and(...conditions));
  } catch (err) {
    logger.warn({ err, args }, "[DailyPlayPicks] fallback close failed");
  }
}

/**
 * Fetch picks for the scoreboard.  Returns picks ordered newest-first
 * within the lookback window.
 */
export async function getDailyPlayPicks(args: {
  userId: number;
  platform?: DailyPlayPlatform;
  daysBack?: number;
}): Promise<DailyPlayPick[]> {
  const database = await getDb();
  if (!database) return [];
  const daysBack = args.daysBack ?? 30;
  const sinceDate = new Date();
  sinceDate.setUTCHours(0, 0, 0, 0);
  sinceDate.setUTCDate(sinceDate.getUTCDate() - (daysBack - 1));
  const sinceStr = sinceDate.toISOString().slice(0, 10);

  const conditions = [
    eq(dailyPlayPicks.userId, args.userId),
    gte(dailyPlayPicks.playDate, sinceStr),
  ];
  if (args.platform) {
    conditions.push(eq(dailyPlayPicks.platform, args.platform));
  }
  return database
    .select()
    .from(dailyPlayPicks)
    .where(and(...conditions))
    .orderBy(desc(dailyPlayPicks.playDate), desc(dailyPlayPicks.id));
}

export async function getTodayDailyPlayPicks(args: {
  userId: number;
  utcDate: string;
}): Promise<DailyPlayPick[]> {
  const database = await getDb();
  if (!database) return [];
  return database
    .select()
    .from(dailyPlayPicks)
    .where(
      and(
        eq(dailyPlayPicks.userId, args.userId),
        eq(dailyPlayPicks.playDate, args.utcDate),
      ),
    )
    .orderBy(desc(dailyPlayPicks.platform));
}

/**
 * Roll up a list of picks into the scoreboard shape consumed by the UI.
 * Computed in JS so we don't pay for round-trip aggregation queries on
 * the (single-tenant, ≤2-rows-per-day) table.
 */
export interface DayRollup {
  date: string;
  kalshi: PlatformDayRollup;
  polymarket: PlatformDayRollup;
  combined: PlatformDayRollup;
}
export interface PlatformDayRollup {
  wins: number;
  losses: number;
  pending: number;
  picks: number;
  totalStaked: number;
  totalPnl: number;
}
export interface ScoreboardResponse {
  today: { kalshi: DailyPlayPick | null; polymarket: DailyPlayPick | null };
  days: DayRollup[];
  lifetime: {
    totalPicks: number;
    totalPnl: number;
    winRate: number;
    byPlatform: { kalshi: PlatformDayRollup; polymarket: PlatformDayRollup };
  };
}

function emptyPlatformRollup(): PlatformDayRollup {
  return { wins: 0, losses: 0, pending: 0, picks: 0, totalStaked: 0, totalPnl: 0 };
}

function accumulate(target: PlatformDayRollup, pick: DailyPlayPick): void {
  target.picks++;
  target.totalStaked += pick.stakeUsd;
  if (pick.realizedPnl != null) target.totalPnl += pick.realizedPnl;
  if (pick.status === "won") target.wins++;
  else if (pick.status === "lost") target.losses++;
  else if (pick.status === "pending") target.pending++;
}

export function rollupScoreboard(
  picks: DailyPlayPick[],
  utcToday: string,
): ScoreboardResponse {
  const byDay = new Map<string, DayRollup>();
  const lifetimeKalshi = emptyPlatformRollup();
  const lifetimePoly = emptyPlatformRollup();

  for (const pick of picks) {
    const day = byDay.get(pick.playDate) ?? {
      date: pick.playDate,
      kalshi: emptyPlatformRollup(),
      polymarket: emptyPlatformRollup(),
      combined: emptyPlatformRollup(),
    };
    if (pick.platform === "kalshi") {
      accumulate(day.kalshi, pick);
      accumulate(lifetimeKalshi, pick);
    } else {
      accumulate(day.polymarket, pick);
      accumulate(lifetimePoly, pick);
    }
    accumulate(day.combined, pick);
    byDay.set(pick.playDate, day);
  }

  const days = Array.from(byDay.values()).sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );

  const todayRow = days.find((d) => d.date === utcToday);
  const today = {
    kalshi:
      picks.find((p) => p.playDate === utcToday && p.platform === "kalshi") ?? null,
    polymarket:
      picks.find((p) => p.playDate === utcToday && p.platform === "polymarket") ?? null,
  };

  const totalPicks = picks.length;
  const totalPnl = picks.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
  const resolved = picks.filter((p) => p.status === "won" || p.status === "lost");
  const winRate =
    resolved.length > 0
      ? resolved.filter((p) => p.status === "won").length / resolved.length
      : 0;
  void todayRow;
  void sql; // import retained for future query expansion

  return {
    today,
    days,
    lifetime: {
      totalPicks,
      totalPnl,
      winRate,
      byPlatform: { kalshi: lifetimeKalshi, polymarket: lifetimePoly },
    },
  };
}
