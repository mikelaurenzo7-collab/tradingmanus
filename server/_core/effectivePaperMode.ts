/**
 * Single-owner ALWAYS-LIVE mode (post-pivot).
 *
 * The Kalshi-only pivot is single-owner and has no paper-mode graduation
 * policy: the owner trades live by default. The ONLY exception is the
 * global `PAPER_TRADE_MODE=true` env emergency kill-switch — when that's
 * set, every order is paper regardless of caller. This lets the operator
 * pause real trading without redeploying the autonomy loop.
 *
 * The exports below preserve the old call signatures so existing call
 * sites compile.
 */

import { ENV } from "./env";

export function resolveEffectivePaperTradeMode(input: {
  envPaperMode: boolean;
  userPaperPreference: boolean;
}): boolean {
  // Per-user paper graduation was removed in the pivot. The only paper
  // signal that still matters is the env-level emergency kill-switch.
  return input.envPaperMode === true;
}

export async function getEffectivePaperTradeMode(
  _userId: number,
): Promise<boolean> {
  return ENV.paperTradeMode === true;
}

export function invalidateEffectivePaperTradeMode(_userId: number): void {
  // No-op — there is no cache in always-live mode.
}

export function _resetEffectivePaperTradeModeCacheForTests(): void {
  // No-op.
}
