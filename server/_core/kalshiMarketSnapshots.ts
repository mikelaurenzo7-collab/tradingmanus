import { db } from "../db";
import { kalshiMarkets, kalshiMarketSnapshots } from "../../drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Phase 2: Market Snapshot Persistence
 * Stores timestamped market data for historical analysis
 */

export interface MarketSnapshot {
  marketId: string;
  timestamp: Date;
  yesPrice: number;
  noPrice: number;
  yesVolume: number;
  noVolume: number;
  impliedProbability: number;
}

/**
 * Save market snapshot to database
 */
export async function saveMarketSnapshot(snapshot: MarketSnapshot): Promise<void> {
  const liquidity = snapshot.yesVolume + snapshot.noVolume;

  // Insert immutable timestamped row into history table.
  // The schema column `snapshotTime` defaults to `now()`, but we insert it
  // explicitly so the persisted timestamp matches the in-memory snapshot.
  try {
    await db.insert(kalshiMarketSnapshots).values({
      marketId: snapshot.marketId,
      yesPrice: snapshot.yesPrice,
      noPrice: snapshot.noPrice,
      yesVolume: snapshot.yesVolume,
      noVolume: snapshot.noVolume,
      impliedProbability: snapshot.impliedProbability,
      liquidity,
      snapshotTime: snapshot.timestamp,
    });
  } catch (error) {
    logger.error({ err: error, marketId: snapshot.marketId }, "[Kalshi] Insert market snapshot failed");
    throw error;
  }

  // Update the latest-known market row so dashboards see fresh prices.
  // Failure here is logged but not fatal — the immutable history row is
  // already persisted, which is what historical analysis depends on.
  try {
    await db
      .update(kalshiMarkets)
      .set({
        yesPrice: snapshot.yesPrice,
        noPrice: snapshot.noPrice,
        yesVolume: snapshot.yesVolume,
        noVolume: snapshot.noVolume,
        impliedProbability: snapshot.impliedProbability,
        lastUpdated: snapshot.timestamp,
      })
      .where(eq(kalshiMarkets.marketId, snapshot.marketId));
  } catch (error) {
    logger.error({ err: error, marketId: snapshot.marketId }, "[Kalshi] Update market latest snapshot failed");
  }
}

/**
 * Get market history (last N snapshots)
 */
export async function getMarketHistory(marketId: string, limit: number = 60): Promise<MarketSnapshot[]> {
  try {
    // Read from the dedicated history table. Rows are returned newest-first
    // so callers can take the head of the array; we reverse to chronological
    // order for momentum/volatility helpers that expect oldest-first.
    const rows = await db
      .select()
      .from(kalshiMarketSnapshots)
      .where(eq(kalshiMarketSnapshots.marketId, marketId))
      .orderBy(desc(kalshiMarketSnapshots.snapshotTime))
      .limit(limit);

    return rows
      .map((s: typeof kalshiMarketSnapshots.$inferSelect) => ({
        marketId: s.marketId,
        timestamp: s.snapshotTime,
        yesPrice: s.yesPrice,
        noPrice: s.noPrice,
        yesVolume: s.yesVolume,
        noVolume: s.noVolume,
        impliedProbability: s.impliedProbability,
      }))
      .reverse();
  } catch (error) {
    logger.error({ err: error, marketId }, "[Kalshi] Get market history failed");
    return [];
  }
}

/**
 * Calculate price momentum from snapshots
 */
export function calculatePriceMomentum(snapshots: MarketSnapshot[], side: "yes" | "no"): number {
  if (snapshots.length < 2) return 0;

  const prices = snapshots.map((s) => (side === "yes" ? s.yesPrice : s.noPrice));
  const oldPrice = prices[0];
  const newPrice = prices[prices.length - 1];

  if (oldPrice === 0) return 0;
  return (newPrice - oldPrice) / oldPrice;
}

/**
 * Calculate volume momentum from snapshots
 */
export function calculateVolumeMomentum(snapshots: MarketSnapshot[], side: "yes" | "no"): number {
  if (snapshots.length < 2) return 0;

  const volumes = snapshots.map((s) => (side === "yes" ? s.yesVolume : s.noVolume));
  const oldVolume = volumes[0];
  const newVolume = volumes[volumes.length - 1];

  if (oldVolume === 0) return 0;
  return (newVolume - oldVolume) / oldVolume;
}

/**
 * Calculate volatility from snapshots
 */
export function calculateVolatility(snapshots: MarketSnapshot[]): number {
  if (snapshots.length < 2) return 0;

  const prices = snapshots.map((s) => s.impliedProbability);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / prices.length;
  return Math.sqrt(variance);
}

/**
 * Detect liquidity from volume
 */
export function calculateLiquidity(snapshot: MarketSnapshot): "high" | "medium" | "low" {
  const totalVolume = snapshot.yesVolume + snapshot.noVolume;

  if (totalVolume > 1000) return "high";
  if (totalVolume > 100) return "medium";
  return "low";
}

/**
 * Batch save market snapshots
 */
export async function batchSaveMarketSnapshots(snapshots: MarketSnapshot[]): Promise<void> {
  try {
    await Promise.all(snapshots.map((snapshot) => saveMarketSnapshot(snapshot)));
  } catch (error) {
    logger.error({ err: error, count: snapshots.length }, "[Kalshi] Batch save market snapshots failed");
    throw error;
  }
}
