/**
 * Per-user effective paper-trade mode.
 *
 * Founder/owner-friendly default: the configured OWNER_EMAIL trades LIVE
 * by default; every other user trades in paper mode by default until they
 * graduate.  This lets the owner accept the risk for themselves while
 * keeping any future invited users on the safe rails.
 *
 * Resolution order (first match wins):
 *
 *   1. ENV.paperTradeMode === true
 *      → EVERYONE is paper.  This preserves the previous global emergency
 *        kill-switch: an operator can force the entire deployment into
 *        paper mode in one env-var flip without touching per-user state.
 *
 *   2. The user matches OWNER_EMAIL (case- and whitespace-insensitive)
 *      → LIVE.  The founder's bots place real orders.
 *
 *   3. Otherwise (any non-owner user)
 *      → PAPER.  Future invited users are forced into paper-mode learning
 *        before they can graduate to live trading.  The graduation path
 *        (UI, time-in-paper minimums, win-rate threshold) is a follow-up.
 *
 * Cached per call site for the lifetime of one autonomy/order tick by
 * memoising on (userId).  An autonomy run that places one Kalshi order
 * + one Polymarket order pays exactly one DB read.
 *
 * Failure mode: when the user lookup fails or the user record is missing
 * we conservatively return TRUE (paper) — refusing to assume the caller
 * is the owner is the safer default for an unknown user.
 */

import { ENV } from "./env";
import { getUserById } from "../db";
import { logger } from "./logger";

interface CachedEntry {
  /** Effective paper mode for this userId in this process. */
  paperMode: boolean;
  /** When this entry was first computed; lets the caller invalidate after long pauses. */
  computedAtMs: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes is more than enough for one tick
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
 * Pure resolver — does not touch the DB.  Exported for testing and for
 * callers that already have the user record on hand.
 */
export function resolveEffectivePaperTradeMode(input: {
  envPaperMode: boolean;
  userEmail: string | null | undefined;
  ownerEmail: string;
}): boolean {
  // Priority 1: global override.
  if (input.envPaperMode) return true;
  const owner = input.ownerEmail.trim().toLowerCase();
  if (!owner) {
    // No owner configured — fall back to paper for safety.
    return true;
  }
  // Priority 2: owner gets live by default.
  if (String(input.userEmail ?? "").trim().toLowerCase() === owner) {
    return false;
  }
  // Priority 3: everyone else is paper.
  return true;
}

export async function getEffectivePaperTradeMode(userId: number): Promise<boolean> {
  if (ENV.paperTradeMode) return true; // global emergency switch fast path

  const now = Date.now();
  const cached = cache.get(userId);
  if (cached && now - cached.computedAtMs < CACHE_TTL_MS) {
    return cached.paperMode;
  }

  let paperMode = true;
  try {
    const user = await getUserById(userId);
    paperMode = resolveEffectivePaperTradeMode({
      envPaperMode: ENV.paperTradeMode,
      userEmail: user?.email ?? null,
      ownerEmail: ENV.ownerEmail,
    });
  } catch (err) {
    logger.warn(
      { err, userId },
      "[effectivePaperMode] user lookup failed; defaulting to paper",
    );
    paperMode = true;
  }

  cache.set(userId, { paperMode, computedAtMs: now });
  return paperMode;
}

/**
 * Forget the cached effective-mode for a user.  Call when their email
 * changes or a per-user override is added in the future.
 */
export function invalidateEffectivePaperTradeMode(userId: number): void {
  cache.delete(userId);
}

/**
 * Reset all cached entries.  Tests use this between cases.
 */
export function _resetEffectivePaperTradeModeCacheForTests(): void {
  cache.clear();
}

export const _OWNER_EMAIL_NORMALISED_FOR_TESTS = ownerEmailNormalised;
export { isOwnerEmail };
