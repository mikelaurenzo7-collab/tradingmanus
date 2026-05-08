/**
 * Per-user effective paper-trade mode.
 *
 * Live trading is now open to every authenticated user.  Paper-mode is
 * opt-in, controlled at two levels:
 *
 *   1. ENV.paperTradeMode === true
 *      → EVERYONE is paper.  Global emergency kill-switch the operator
 *        sets via Railway env.  Wins over per-user preferences.
 *
 *   2. tradingPreferences.paperTradeMode === 1 for this user
 *      → THIS user is paper.  Per-user opt-in toggle accessible from
 *        the dashboard's Trading Preferences page.  Default 0 = live.
 *
 *   3. otherwise → LIVE.
 *
 * Compared to the previous behaviour (owner-only live, others forced
 * paper-then-graduation), the model is now: anyone authenticated and
 * properly configured can trade live; paper is opt-in.  All the other
 * safety layers stay in place: per-user `liveTradingEnabled` toggle,
 * required Kalshi credentials, profit guardrails, max order notional,
 * max daily orders, withUserLock around order placement.
 *
 * Cached per-userId for 5 minutes so an autonomy run that opens one
 * Kalshi order + one Polymarket order pays at most one DB read.
 *
 * Failure mode: when the lookup fails we conservatively return TRUE
 * (paper).  Defaulting to live on failure would silently let real
 * orders through during a transient DB outage; paper is the safer
 * default.
 */

import { ENV } from "./env";
import { logger } from "./logger";

interface CachedEntry {
  paperMode: boolean;
  computedAtMs: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<number, CachedEntry>();

/**
 * Pure resolver — does not touch the DB.  Exported for testing and for
 * callers that already have the user's preference in hand.
 */
export function resolveEffectivePaperTradeMode(input: {
  envPaperMode: boolean;
  userPaperPreference: boolean;
}): boolean {
  if (input.envPaperMode) return true;
  if (input.userPaperPreference) return true;
  return false;
}

export async function getEffectivePaperTradeMode(userId: number): Promise<boolean> {
  if (ENV.paperTradeMode) return true;

  const now = Date.now();
  const cached = cache.get(userId);
  if (cached && now - cached.computedAtMs < CACHE_TTL_MS) {
    return cached.paperMode;
  }

  let paperMode = true;
  try {
    // Late-import to avoid the server module pulling drizzle schema into
    // the test bootstrap; same pattern as the previous version.
    const { getDb } = await import("../db");
    const { tradingPreferences } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const database = await getDb();
    if (!database) {
      paperMode = true;
    } else {
      const rows = await database
        .select({ paperTradeMode: tradingPreferences.paperTradeMode })
        .from(tradingPreferences)
        .where(eq(tradingPreferences.userId, userId))
        .limit(1);
      const userPaperPreference = (rows[0]?.paperTradeMode ?? 0) === 1;
      paperMode = resolveEffectivePaperTradeMode({
        envPaperMode: ENV.paperTradeMode,
        userPaperPreference,
      });
    }
  } catch (err) {
    logger.warn(
      { err, userId },
      "[effectivePaperMode] lookup failed; defaulting to paper",
    );
    paperMode = true;
  }

  cache.set(userId, { paperMode, computedAtMs: now });
  return paperMode;
}

export function invalidateEffectivePaperTradeMode(userId: number): void {
  cache.delete(userId);
}

export function _resetEffectivePaperTradeModeCacheForTests(): void {
  cache.clear();
}
