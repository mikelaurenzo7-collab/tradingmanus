/**
 * Polymarket DB helpers
 *
 * Provides typed query helpers for the polymarketOrders, polymarketFills,
 * and polymarketPositions tables.  These replace the previous DEBT workaround
 * in polymarketLearning.ts that proxied Kalshi tables for Polymarket data.
 */

import {
  polymarketOrders,
  polymarketFills,
  polymarketPositions,
  type PolymarketOrder,
  type PolymarketPosition,
} from "../drizzle/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { assertPositiveIntegerUserId } from "./_core/userScope";

// ── Orders ────────────────────────────────────────────────────────────────────

export async function getPolymarketOrders(
  userId: number,
  limit = 1000,
): Promise<PolymarketOrder[]> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getPolymarketOrders");
  const database = await getDb();
  if (!database) return [];
  return database
    .select()
    .from(polymarketOrders)
    .where(eq(polymarketOrders.userId, scopedUserId))
    .orderBy(desc(polymarketOrders.createdAt))
    .limit(limit);
}

export async function getPolymarketTradeHistory(
  userId: number,
  limit = 1000,
): Promise<PolymarketOrder[]> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getPolymarketTradeHistory");
  const database = await getDb();
  if (!database) return [];
  return database
    .select()
    .from(polymarketOrders)
    .where(
      and(
        eq(polymarketOrders.userId, scopedUserId),
        inArray(polymarketOrders.status, ["filled", "cancelled"]),
      ),
    )
    .orderBy(desc(polymarketOrders.createdAt))
    .limit(limit);
}

// ── Positions ─────────────────────────────────────────────────────────────────

export async function getOpenPolymarketPositions(userId: number): Promise<PolymarketPosition[]> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getOpenPolymarketPositions");
  const database = await getDb();
  if (!database) return [];
  // Restrict to status='open' so the exit monitor doesn't re-trigger on
  // positions whose SELL has already been submitted (those are 'closing').
  // Live auto-close marks the row 'closing' specifically to debounce until
  // reconciliation flips it to 'closed'.
  return database
    .select()
    .from(polymarketPositions)
    .where(
      and(
        eq(polymarketPositions.userId, scopedUserId),
        eq(polymarketPositions.positionStatus, "open"),
      ),
    )
    .orderBy(desc(polymarketPositions.openedAt));
}

export async function getPolymarketPositions(userId: number): Promise<PolymarketPosition[]> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getPolymarketPositions");
  const database = await getDb();
  if (!database) return [];
  return database
    .select()
    .from(polymarketPositions)
    .where(eq(polymarketPositions.userId, scopedUserId))
    .orderBy(desc(polymarketPositions.openedAt));
}

export async function upsertPolymarketPosition(
  userId: number,
  position: Omit<PolymarketPosition, "id" | "userId" | "openedAt" | "closedAt">,
): Promise<void> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "upsertPolymarketPosition");
  const database = await getDb();
  if (!database) return;

  const existing = await database
    .select()
    .from(polymarketPositions)
    .where(
      and(
        eq(polymarketPositions.userId, scopedUserId),
        eq(polymarketPositions.marketId, position.marketId),
        eq(polymarketPositions.tokenId, position.tokenId),
        inArray(polymarketPositions.positionStatus, ["open", "closing"]),
      ),
    )
    .then((rows: PolymarketPosition[]) => rows[0]);

  if (existing) {
    const closingNow =
      position.positionStatus === "closed" && existing.positionStatus !== "closed";
    const closedAt = closingNow ? new Date() : undefined;
    await database
      .update(polymarketPositions)
      .set({
        // Refresh size + entry from the incoming reconciliation payload so a
        // remote position that grew, shrank, or rolled its average entry
        // stays in sync with our local row.  Without this, exposure and
        // PnL drift after every adjustment.
        sizeUsdc: position.sizeUsdc,
        entryPrice: position.entryPrice,
        currentPrice: position.currentPrice,
        unrealizedPnl: position.unrealizedPnl,
        realizedPnl: position.realizedPnl,
        positionStatus: position.positionStatus,
        closedAt,
      })
      .where(eq(polymarketPositions.id, existing.id));

    // Daily-pick scoreboard hook: only fires on a transition to 'closed'
    // (defensive — drift-close in polymarketPositionSync.ts is the primary
    // close detector for the data-API path).
    if (closingNow) {
      try {
        const { closeDailyPlayPickByPosition, closeDailyPlayPickByMarketFallback } =
          await import("./db.daily-play-picks");
        const exitPrice = Number(position.currentPrice ?? 0);
        const realizedPnl = Number(position.realizedPnl ?? 0);
        await closeDailyPlayPickByPosition({
          platform: "polymarket",
          linkedPositionId: existing.id,
          exitPrice: Number.isFinite(exitPrice) ? exitPrice : null,
          realizedPnl,
          closedAt: closedAt ?? new Date(),
        });
        await closeDailyPlayPickByMarketFallback({
          userId: scopedUserId,
          platform: "polymarket",
          marketId: position.marketId,
          tokenId: position.tokenId,
          exitPrice: Number.isFinite(exitPrice) ? exitPrice : null,
          realizedPnl,
          closedAt: closedAt ?? new Date(),
        });
      } catch (err) {
        console.warn("[upsertPolymarketPosition] dailyPlayPicks hook failed", err);
      }
    }
  } else {
    await database.insert(polymarketPositions).values({
      userId: scopedUserId,
      ...position,
    });
  }
}

// ── Fills ─────────────────────────────────────────────────────────────────────

export async function insertPolymarketFill(
  userId: number,
  fill: {
    orderId: string;
    marketId: string;
    tokenId: string;
    fillPrice: number;
    fillSizeUsdc: number;
  },
): Promise<void> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "insertPolymarketFill");
  const database = await getDb();
  if (!database) return;
  await database.insert(polymarketFills).values({ userId: scopedUserId, ...fill });
}
