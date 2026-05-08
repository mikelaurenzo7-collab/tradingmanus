/**
 * Desk attention weighting based on rolling win rate.
 *
 * Turns the existing `deskMemory` learning tape (per-user, per-platform,
 * per-desk win/loss counts) into actual capital allocation by biasing
 * the adaptive-cadence gate.  Winning desks get reviewed more
 * aggressively (tighter effective TTL); losing desks get throttled
 * (looser effective TTL) so we burn fewer AI cycles on categories that
 * have been losing money.
 *
 * Design notes
 *
 *  - We read from `deskMemory` rows the desk-memory module already
 *    persists.  No schema change.
 *
 *  - "Cold" desks (insufficient trade history) get a neutral weight of
 *    1.0 — we don't bias attention until we have signal.  The threshold
 *    is 10 trades; below that, win-rate variance is too large to act on.
 *
 *  - The mapping from win-rate to weight is intentionally conservative:
 *      winRate >= 65% → 0.5  (review 2× more often)
 *      winRate >= 55% → 0.75 (review 1.33× more often)
 *      winRate 45-55% → 1.0  (neutral)
 *      winRate <  45% → 1.5  (review 1.5× less often)
 *      winRate <  35% → 2.0  (review 2× less often)
 *    Multiplied INTO the adaptive-cadence stale TTL — a smaller weight
 *    means tighter TTL means more frequent reviews.
 *
 *  - Cache: weights are loaded once per user-platform per process and
 *    refreshed every 5 minutes.  This keeps the per-tick read cost
 *    negligible.  Stale-but-recent weights are fine for a probabilistic
 *    attention bias.
 */

import type { DeskPlatform } from "../db.desk-memory";
import type { MarketCategory } from "./marketCategoryRouter";

/** Minimum trade count before a desk's win rate is trusted. */
const COLD_DESK_TRADE_THRESHOLD = 10;
/** Cache TTL for desk weights — re-read at most every 5 min. */
const WEIGHT_CACHE_TTL_MS = 5 * 60 * 1000;

type DeskWeightRow = { tradeCount: number; winCount: number; lossCount: number };
type WeightTable = Map<string, number>;

type CachedWeights = {
  table: WeightTable;
  loadedAtMs: number;
};

const WEIGHT_CACHE = new Map<string, CachedWeights>();

function cacheKey(userId: number, platform: DeskPlatform): string {
  return `${platform}:${userId}`;
}

/**
 * Map (winRate, tradeCount) → cadence multiplier.  Pure / unit-testable.
 *
 *   weight < 1   tightens cadence  (winning desk → review more often)
 *   weight = 1   neutral
 *   weight > 1   loosens cadence   (losing desk → review less often)
 */
export function weightForRow(row: DeskWeightRow): number {
  if (row.tradeCount < COLD_DESK_TRADE_THRESHOLD) return 1.0;
  if (row.tradeCount === 0) return 1.0;
  const winRate = row.winCount / row.tradeCount;
  if (winRate >= 0.65) return 0.5;
  if (winRate >= 0.55) return 0.75;
  if (winRate >= 0.45) return 1.0;
  if (winRate >= 0.35) return 1.5;
  return 2.0;
}

/**
 * Build the in-memory weight table for one user-platform from the
 * deskMemory rows.  Each entry maps deskId → cadence multiplier.
 */
function buildWeightTable(
  rows: Array<{ deskId: string; tradeCount: number; winCount: number; lossCount: number }>,
): WeightTable {
  const table: WeightTable = new Map();
  for (const row of rows) {
    table.set(row.deskId, weightForRow(row));
  }
  return table;
}

/**
 * Load (or refresh from cache) the desk-weight table for a user-platform.
 * The DB read is hoisted behind a TTL cache so per-tick cost is bounded
 * to a single query every 5 min per user-platform.
 *
 * Failure mode: if the DB read errors, returns an empty table so every
 * desk falls back to neutral weight 1.0.  The autonomy loop must never
 * be blocked by attention weighting.
 */
export async function getDeskWeights(
  userId: number,
  platform: DeskPlatform,
  now: number = Date.now(),
): Promise<WeightTable> {
  const key = cacheKey(userId, platform);
  const cached = WEIGHT_CACHE.get(key);
  if (cached && now - cached.loadedAtMs < WEIGHT_CACHE_TTL_MS) {
    return cached.table;
  }
  try {
    const { getDb } = await import("../db");
    const database = await getDb();
    if (!database) return new Map();
    const { deskMemory } = await import("../../drizzle/schema");
    const { and, eq } = await import("drizzle-orm");
    const rows = await database
      .select({
        deskId: deskMemory.deskId,
        tradeCount: deskMemory.tradeCount,
        winCount: deskMemory.winCount,
        lossCount: deskMemory.lossCount,
      })
      .from(deskMemory)
      .where(and(eq(deskMemory.userId, userId), eq(deskMemory.platform, platform)));
    const table = buildWeightTable(rows);
    WEIGHT_CACHE.set(key, { table, loadedAtMs: now });
    return table;
  } catch {
    // Fail-soft — empty table = every desk neutral.  Logged at the
    // caller when applied (deskAttention is best-effort).
    return new Map();
  }
}

/**
 * Resolve the cadence weight for a (platform, category) combo, given a
 * pre-loaded weight table.  Falls back to 1.0 (neutral) for any desk
 * that doesn't appear in the table.
 *
 * Caller is responsible for translating MarketCategory → deskId via the
 * category-personas helper; this fn is pure and just looks up.
 */
export function getCategoryWeight(
  table: WeightTable,
  deskId: string,
): number {
  return table.get(deskId) ?? 1.0;
}

// ── Test-only helpers ───────────────────────────────────────────────────────

export const __TEST_ONLY__ = {
  reset(): void {
    WEIGHT_CACHE.clear();
  },
  setCached(userId: number, platform: DeskPlatform, table: WeightTable): void {
    WEIGHT_CACHE.set(cacheKey(userId, platform), { table, loadedAtMs: Date.now() });
  },
  buildWeightTable,
  COLD_DESK_TRADE_THRESHOLD,
  WEIGHT_CACHE_TTL_MS,
};

// Re-export the type so callers don't have to import from category router
// just for typing.
export type { MarketCategory };
