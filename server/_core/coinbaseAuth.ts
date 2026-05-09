/**
 * Coinbase Auth — Phase 10 SCAFFOLDING ONLY.
 *
 * This module is INTENTIONALLY INERT.  Connection + format-only credential
 * validation is implemented; live trading is gated behind
 * `ENV.enableCoinbaseLive=false` (see coinbaseExecution.ts which throws
 * on placement).  The scaffold exists so:
 *
 *   1. The operator can connect credentials in the dashboard now and
 *      have them encrypted at rest, ready for when instruments are
 *      decided.
 *   2. A future Coinbase trading PR can drop in real signal/execution
 *      logic without re-doing the auth boundary.
 *
 * Format guard mirrors the Polymarket validator:
 *   - All three fields non-empty, ≥ 4 chars
 *   - On the first real exchange call (when ENABLE_COINBASE_LIVE=true)
 *     any genuine auth issue surfaces with a clear exchange rejection.
 *
 * DO NOT add live trading logic to this file.  See `sparkling-churning-dusk.md`
 * Phase 10 for the deferred-implementation plan.
 */

import { logger } from "./logger";

export interface CoinbaseValidationResult {
  valid: boolean;
  error?: string;
}

export async function validateCoinbaseCredentials(
  apiKey: string,
  apiSecret: string,
  apiPassphrase: string | null,
): Promise<CoinbaseValidationResult> {
  if (!apiKey || apiKey.trim().length < 4) {
    return { valid: false, error: "Invalid API key — must be at least 4 characters." };
  }
  if (!apiSecret || apiSecret.trim().length < 4) {
    return { valid: false, error: "Invalid API secret — must be at least 4 characters." };
  }
  // Coinbase Advanced API doesn't always require a passphrase (depends on
  // legacy vs CDP keys); accept null/empty.
  if (apiPassphrase != null && apiPassphrase.length > 0 && apiPassphrase.trim().length < 4) {
    return {
      valid: false,
      error: "Invalid API passphrase — if provided, must be at least 4 characters.",
    };
  }
  return { valid: true };
}

/**
 * Future: real balance fetch from Coinbase.  Stub returns 0 so callers
 * relying on bankroll see "balance_unknown" and don't accidentally trade.
 */
export async function fetchCoinbaseAccountBalance(): Promise<{
  balance: number;
  error?: string;
}> {
  logger.debug("[CoinbaseAuth] balance fetch is stubbed pending Phase 10 build-out");
  return { balance: 0, error: "Coinbase balance fetch not implemented" };
}
