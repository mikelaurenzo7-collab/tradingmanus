/**
 * Per-user effective paper-trade mode with graduation for non-owners.
 *
 * Owner (matching OWNER_EMAIL) trades LIVE immediately.
 * Non-owners start in paper and must "graduate" by hitting performance target
 * (win rate ≥ 55% over ≥ 30 trades + positive cumulative EV).
 *
 * High-leverage wins only: live trading requires strict profit guardrails
 * (high EV + high confidence + dual-bot consensus) for everyone.
 */

import { ENV } from "./env";
import { getUserById } from "../db";
import { logger } from "./logger";
import { getDeskMemoryBatch } from "./db.desk-memory";

interface CachedEntry {
  paperMode: boolean;
  computedAtMs: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<number, CachedEntry>();

function ownerEmailNormalised(): string {
  return ENV.ownerEmail.trim().toLowerCase();
}

function isOwnerEmail(email: string | null | undefined): boolean {
  const owner = ownerEmailNormalised();
  if (!owner) return false;
  return String(email ?? "").trim().toLowerCase() === owner;
}

/**
 * Check if non-owner has graduated from paper.
 * Target: ≥ 55% win rate over ≥ 30 trades with positive total EV.
 */
export async function hasGraduatedFromPaper(userId: number): Promise<boolean> {
  if (!userId) return false;
  try {
    const memory = await getDeskMemoryBatch(userId, "kalshi", []);
    if (memory.size === 0) return false;

    let totalTrades = 0;
    let wins = 0;
    let totalEV = 0;

    for (const [_, record] of memory) {
      const stats = record.stats || {};
      totalTrades += stats.totalTrades || 0;
      wins += stats.wins || 0;
      totalEV += (stats.totalEV || 0);
    }

    if (totalTrades < (ENV.paperMinTrades || 30)) return false;

    const winRate = totalTrades > 0 ? wins / totalTrades : 0;
    const graduated = winRate >= (ENV.paperGraduationWinRate || 0.55) && totalEV > 0;

    return graduated;
  } catch (err) {
    logger.warn({ err, userId }, "[effectivePaperMode] graduation check failed");
    return false;
  }
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
    const user = await getUserById(userId);
    const email = user?.email ?? null;

    if (isOwnerEmail(email)) {
      // Owner = live immediately (guardrails still apply)
      paperMode = false;
    } else {
      const graduated = await hasGraduatedFromPaper(userId);
      paperMode = !graduated;
    }
  } catch (err) {
    logger.warn({ err, userId }, "[effectivePaperMode] lookup failed; defaulting to paper");
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

export const _OWNER_EMAIL_NORMALISED_FOR_TESTS = ownerEmailNormalised;
export { isOwnerEmail };
