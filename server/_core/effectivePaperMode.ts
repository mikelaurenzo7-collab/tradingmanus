/**
 * Per-user effective paper-trade mode with graduation for non-owners.
 *
 * Owner (matching OWNER_EMAIL) trades LIVE immediately.
 * Non-owners start in paper and must "graduate" by hitting performance target
 * (win rate ≥ PAPER_GRADUATION_WIN_RATE over ≥ PAPER_MIN_TRADES + positive total P&L).
 *
 * Resolution order (first match wins):
 *
 *   1. ENV.paperTradeMode === true
 *      → EVERYONE is paper.  Global emergency kill-switch.
 *
 *   2. The user matches OWNER_EMAIL (case- and whitespace-insensitive)
 *      → LIVE.  The founder's bots place real orders.
 *
 *   3. Non-owner who has graduated → LIVE.
 *
 *   4. Non-owner who has not graduated (or graduation check fails) → PAPER.
 *
 * Cached per-userId for 5 minutes so an autonomy run that opens one Kalshi
 * order + one Polymarket order pays at most one users-table read + one
 * paper-PnL summary fetch.
 *
 * Failure mode: when any lookup fails we conservatively return TRUE
 * (paper) — refusing to assume the caller is the owner OR has graduated
 * is the safer default.
 */

import { ENV } from "./env";
import { getUserById } from "../db";
import { logger } from "./logger";
import { getPnlSummary } from "./paperPnlSummary";

interface CachedEntry {
  paperMode: boolean;
  computedAtMs: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<number, CachedEntry>();

// Look-back window for graduation accounting.  90 days is wide enough
// to accumulate the trade count required for graduation while still
// reflecting current performance.
const GRADUATION_WINDOW_DAYS = 90;

function ownerEmailNormalised(): string {
  return ENV.ownerEmail.trim().toLowerCase();
}

function isOwnerEmail(email: string | null | undefined): boolean {
  const owner = ownerEmailNormalised();
  if (!owner) return false;
  return String(email ?? "").trim().toLowerCase() === owner;
}

/**
 * Pure resolver — does not touch the DB.  Exported for testing and for
 * callers that already have the user record + graduation status on hand.
 */
export function resolveEffectivePaperTradeMode(input: {
  envPaperMode: boolean;
  userEmail: string | null | undefined;
  ownerEmail: string;
  hasGraduated?: boolean;
}): boolean {
  if (input.envPaperMode) return true;
  const owner = input.ownerEmail.trim().toLowerCase();
  if (!owner) return true;
  if (String(input.userEmail ?? "").trim().toLowerCase() === owner) return false;
  // Non-owner: live only when graduated.
  return !(input.hasGraduated === true);
}

/**
 * Check if a non-owner has graduated from paper-mode.
 *
 * Criteria (env-tunable):
 *   - At least PAPER_MIN_TRADES closed trades (combined Kalshi + Polymarket)
 *     in the look-back window
 *   - Win rate ≥ PAPER_GRADUATION_WIN_RATE
 *   - Cumulative realized P&L > 0 (positive over the window)
 *
 * All three must be true.  Returns false on any failure (safe default).
 */
export async function hasGraduatedFromPaper(userId: number): Promise<boolean> {
  if (!Number.isFinite(userId) || userId <= 0) return false;
  try {
    const summary = await getPnlSummary(userId, GRADUATION_WINDOW_DAYS);
    const minTrades = ENV.paperMinTrades || 30;
    const minWinRate = ENV.paperGraduationWinRate || 0.55;

    if (summary.combined.closedTrades < minTrades) return false;
    if (summary.combined.winRate < minWinRate) return false;
    if (summary.combined.totalPnlUsd <= 0) return false;
    return true;
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
      paperMode = false;
    } else {
      const graduated = await hasGraduatedFromPaper(userId);
      paperMode = resolveEffectivePaperTradeMode({
        envPaperMode: ENV.paperTradeMode,
        userEmail: email,
        ownerEmail: ENV.ownerEmail,
        hasGraduated: graduated,
      });
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
