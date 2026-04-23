import { db } from "../db";
import { kalshiMarkets } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

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
  try {
    // Update market with latest snapshot data
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
    console.error("[Kalshi] Save market snapshot failed:", error);
    throw error;
  }
}

/**
 * Get market history (last N snapshots)
 */
export async function getMarketHistory(marketId: string, limit: number = 60): Promise<MarketSnapshot[]> {
  try {
    // For now, return current market data
    // In production, would query a separate market_snapshots table with timestamps
    const market = await db
      .select()
      .from(kalshiMarkets)
      .where(eq(kalshiMarkets.marketId, marketId))
      .limit(1);

    if (!market.length) {
      return [];
    }

    const m = market[0];
    return [
      {
        marketId: m.marketId,
        timestamp: m.lastUpdated,
        yesPrice: m.yesPrice,
        noPrice: m.noPrice,
        yesVolume: m.yesVolume,
        noVolume: m.noVolume,
        impliedProbability: m.impliedProbability,
      },
    ];
  } catch (error) {
    console.error("[Kalshi] Get market history failed:", error);
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
    console.error("[Kalshi] Batch save market snapshots failed:", error);
    throw error;
  }
}
