/**
 * Kalshi Market Feed Subscription
 * Real-time market data polling and snapshot management
 */

import { fetchKalshiMarkets, fetchKalshiMarketDetails, KalshiMarket } from "./kalshiMarketData";
import { saveMarketSnapshot } from "./kalshiMarketSnapshots";
import * as db from "../db";
import { logger } from "./logger";

export interface MarketSnapshot {
  marketId: string;
  timestamp: number;
  yesPrice: number;
  noPrice: number;
  yesVolume: number;
  noVolume: number;
  impliedProbability: number;
}

export interface MarketFeed {
  marketId: string;
  title: string;
  category: string;
  status: "open" | "closed" | "resolved";
  currentSnapshot: MarketSnapshot;
  priceHistory: MarketSnapshot[];
  volumeHistory: Array<{ timestamp: number; yesVolume: number; noVolume: number }>;
  dataQualityScore: number;
  lastUpdateTime: number;
}

// In-memory feed cache (per-market)
const feedCache = new Map<string, MarketFeed>();
const subscriptionTimers = new Map<string, NodeJS.Timeout>();

/**
 * Persist a single in-memory snapshot to the dedicated history table.
 *
 * The in-memory snapshot uses `timestamp: number` (epoch millis), but the
 * persistence layer expects a `Date`. We adapt here so callers don't have
 * to think about the boundary. Failures are swallowed (and logged inside
 * `saveMarketSnapshot`) so a transient DB error never tears down the
 * polling loop or causes a market subscription to fail.
 */
async function persistSnapshot(snapshot: MarketSnapshot): Promise<void> {
  try {
    await saveMarketSnapshot({
      marketId: snapshot.marketId,
      timestamp: new Date(snapshot.timestamp),
      yesPrice: snapshot.yesPrice,
      noPrice: snapshot.noPrice,
      yesVolume: snapshot.yesVolume,
      noVolume: snapshot.noVolume,
      impliedProbability: snapshot.impliedProbability,
    });
  } catch (error) {
    logger.error({ err: error, marketId: snapshot.marketId }, "[MarketFeed] Persist snapshot failed for %s", snapshot.marketId);
  }
}

/**
 * Start polling a market for real-time updates
 * Polls every 5 seconds and maintains a 1-hour history
 */
export async function subscribeToMarketFeed(
  marketId: string,
  pollIntervalMs: number = 5000
): Promise<MarketFeed | null> {
  // If already subscribed, return existing feed
  if (feedCache.has(marketId)) {
    return feedCache.get(marketId) || null;
  }

  // Fetch initial market data
  const market = await fetchKalshiMarketDetails(marketId);
  if (!market) {
    logger.error({ marketId }, "[MarketFeed] Failed to fetch initial data for market %s", marketId);
    return null;
  }

  // Initialize feed
  const snapshot: MarketSnapshot = {
    marketId,
    timestamp: Date.now(),
    yesPrice: market.yesPrice,
    noPrice: market.noPrice,
    yesVolume: market.yesVolume,
    noVolume: market.noVolume,
    impliedProbability: market.impliedProbability,
  };

  const feed: MarketFeed = {
    marketId,
    title: market.title,
    category: market.category,
    status: market.status,
    currentSnapshot: snapshot,
    priceHistory: [snapshot],
    volumeHistory: [{ timestamp: snapshot.timestamp, yesVolume: market.yesVolume, noVolume: market.noVolume }],
    dataQualityScore: 1.0,
    lastUpdateTime: Date.now(),
  };

  feedCache.set(marketId, feed);

  // Persist initial market row and a timestamped history snapshot so the
  // dedicated kalshiMarketSnapshots table reflects subscribe-time state.
  await db.upsertKalshiMarket(market);
  await persistSnapshot(snapshot);

  // Start polling
  const timer = setInterval(async () => {
    await updateMarketFeed(marketId);
  }, pollIntervalMs);

  subscriptionTimers.set(marketId, timer);

  logger.info({ marketId, pollIntervalMs }, "[MarketFeed] Subscribed to market %s with %dms polling", marketId, pollIntervalMs);
  return feed;
}

/**
 * Update a market feed with fresh data
 */
async function updateMarketFeed(marketId: string): Promise<void> {
  const feed = feedCache.get(marketId);
  if (!feed) return;

  try {
    const market = await fetchKalshiMarketDetails(marketId);
    if (!market) {
      // Degrade data quality on fetch failure
      feed.dataQualityScore = Math.max(0, feed.dataQualityScore - 0.1);
      return;
    }

    const snapshot: MarketSnapshot = {
      marketId,
      timestamp: Date.now(),
      yesPrice: market.yesPrice,
      noPrice: market.noPrice,
      yesVolume: market.yesVolume,
      noVolume: market.noVolume,
      impliedProbability: market.impliedProbability,
    };

    // Update current snapshot
    feed.currentSnapshot = snapshot;

    // Maintain 1-hour history (720 snapshots at 5s intervals)
    feed.priceHistory.push(snapshot);
    if (feed.priceHistory.length > 720) {
      feed.priceHistory.shift();
    }

    // Track volume history
    feed.volumeHistory.push({
      timestamp: snapshot.timestamp,
      yesVolume: market.yesVolume,
      noVolume: market.noVolume,
    });
    if (feed.volumeHistory.length > 720) {
      feed.volumeHistory.shift();
    }

    // Improve data quality on successful fetch
    feed.dataQualityScore = Math.min(1.0, feed.dataQualityScore + 0.05);
    feed.lastUpdateTime = Date.now();

    // Persist update: refresh the latest-known market row and append a
    // new immutable history row in the snapshots table.
    await db.upsertKalshiMarket(market);
    await persistSnapshot(snapshot);
  } catch (error) {
    logger.error({ err: error, marketId }, "[MarketFeed] Update failed for market %s", marketId);
    feed.dataQualityScore = Math.max(0, feed.dataQualityScore - 0.1);
  }
}

/**
 * Unsubscribe from a market feed
 */
export function unsubscribeFromMarketFeed(marketId: string): void {
  const timer = subscriptionTimers.get(marketId);
  if (timer) {
    clearInterval(timer);
    subscriptionTimers.delete(marketId);
  }

  feedCache.delete(marketId);
  logger.info({ marketId }, "[MarketFeed] Unsubscribed from market %s", marketId);
}

/**
 * Get current market feed
 */
export function getMarketFeed(marketId: string): MarketFeed | null {
  return feedCache.get(marketId) || null;
}

/**
 * Get all active market feeds
 */
export function getAllMarketFeeds(): MarketFeed[] {
  return Array.from(feedCache.values());
}

/**
 * Subscribe to multiple markets
 */
export async function subscribeToMarketFeeds(marketIds: string[]): Promise<MarketFeed[]> {
  const feeds = await Promise.all(marketIds.map((id) => subscribeToMarketFeed(id)));
  return feeds.filter((f): f is MarketFeed => f !== null);
}

/**
 * Unsubscribe from all markets
 */
export function unsubscribeFromAllMarkets(): void {
  subscriptionTimers.forEach((timer) => clearInterval(timer));
  subscriptionTimers.clear();
  feedCache.clear();
  logger.info("[MarketFeed] Unsubscribed from all markets");
}

/**
 * Calculate price momentum (% change over time window)
 */
export function calculatePriceMomentum(
  feed: MarketFeed,
  windowMs: number = 60000 // 1 minute
): { yesMomentum: number; noMomentum: number } {
  const latestTimestamp =
    feed.priceHistory[feed.priceHistory.length - 1]?.timestamp ??
    feed.currentSnapshot?.timestamp;
  if (latestTimestamp === undefined) {
    return { yesMomentum: 0, noMomentum: 0 };
  }
  const cutoff = latestTimestamp - windowMs;
  const recentSnapshots = feed.priceHistory.filter((s) => s.timestamp >= cutoff);

  if (recentSnapshots.length < 2) {
    return { yesMomentum: 0, noMomentum: 0 };
  }

  const oldest = recentSnapshots[0];
  const newest = recentSnapshots[recentSnapshots.length - 1];

  const yesMomentum = (newest.yesPrice - oldest.yesPrice) / oldest.yesPrice;
  const noMomentum = (newest.noPrice - oldest.noPrice) / oldest.noPrice;

  return { yesMomentum, noMomentum };
}

/**
 * Calculate volume momentum
 */
export function calculateVolumeMomentum(
  feed: MarketFeed,
  windowMs: number = 60000
): { yesVolumeMomentum: number; noVolumeMomentum: number } {
  const latestTimestamp =
    feed.volumeHistory[feed.volumeHistory.length - 1]?.timestamp ??
    feed.currentSnapshot?.timestamp;
  if (latestTimestamp === undefined) {
    return { yesVolumeMomentum: 0, noVolumeMomentum: 0 };
  }
  const cutoff = latestTimestamp - windowMs;
  const recentVolumes = feed.volumeHistory.filter((v) => v.timestamp >= cutoff);

  if (recentVolumes.length < 2) {
    return { yesVolumeMomentum: 0, noVolumeMomentum: 0 };
  }

  const oldest = recentVolumes[0];
  const newest = recentVolumes[recentVolumes.length - 1];

  const yesVolumeMomentum = (newest.yesVolume - oldest.yesVolume) / (oldest.yesVolume || 1);
  const noVolumeMomentum = (newest.noVolume - oldest.noVolume) / (oldest.noVolume || 1);

  return { yesVolumeMomentum, noVolumeMomentum };
}

/**
 * Detect volatility (price standard deviation)
 */
export function detectVolatility(feed: MarketFeed, windowMs: number = 300000): number {
  const latestTimestamp =
    feed.priceHistory[feed.priceHistory.length - 1]?.timestamp ??
    feed.currentSnapshot?.timestamp;
  if (latestTimestamp === undefined) return 0;
  const cutoff = latestTimestamp - windowMs;
  const recentSnapshots = feed.priceHistory.filter((s) => s.timestamp >= cutoff);

  if (recentSnapshots.length < 2) return 0;

  const prices = recentSnapshots.map((s) => s.impliedProbability);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
  const stdDev = Math.sqrt(variance);

  return stdDev;
}

/**
 * Check if market data is stale
 */
export function isMarketDataStale(feed: MarketFeed, maxAgeMs: number = 30000): boolean {
  return Date.now() - feed.lastUpdateTime > maxAgeMs;
}
