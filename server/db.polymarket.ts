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
  return database
    .select()
    .from(polymarketPositions)
    .where(
      and(
        eq(polymarketPositions.userId, scopedUserId),
        inArray(polymarketPositions.positionStatus, ["open", "closing"]),
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
    await database
      .update(polymarketPositions)
      .set({
        currentPrice: position.currentPrice,
        unrealizedPnl: position.unrealizedPnl,
        realizedPnl: position.realizedPnl,
        positionStatus: position.positionStatus,
        closedAt: position.positionStatus === "closed" ? new Date() : undefined,
      })
      .where(eq(polymarketPositions.id, existing.id));
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
