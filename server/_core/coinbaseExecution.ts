/**
 * Coinbase Execution — Phase 10 SCAFFOLDING ONLY.
 *
 * `placeCoinbaseOrder` is intentionally inert.  It THROWS on every call
 * unless `ENV.enableCoinbaseLive=true`, and even then it currently has no
 * real implementation — the throw message points the caller back to the
 * deferred plan.
 *
 * Why this shape:
 *   - Future Coinbase trading code can import `placeCoinbaseOrder` without
 *     having to re-wire its callers when the real impl lands.
 *   - The hard throw prevents accidental live trading via the inert
 *     scaffolding (a future contributor who forgets the deferred status).
 *
 * See `sparkling-churning-dusk.md` Phase 10 for instrument selection +
 * signal sources + risk caps before unblocking this.
 */

import { ENV } from "./env";

export interface CoinbaseOrderInput {
  productId: string;
  side: "buy" | "sell";
  size: number;
  limitPrice?: number;
  clientOrderId?: string;
}

export interface CoinbaseOrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
}

export async function placeCoinbaseOrder(
  _credentials: { apiKey: string; apiSecret: string; apiPassphrase: string | null },
  _order: CoinbaseOrderInput,
): Promise<CoinbaseOrderResult> {
  if (!ENV.enableCoinbaseLive) {
    return {
      success: false,
      error:
        "Coinbase trading is disabled (ENABLE_COINBASE_LIVE=false). " +
        "Phase 10 scaffolding only — no instruments / signal logic / risk " +
        "caps wired yet.  See docs/plans/sparkling-churning-dusk.md.",
    };
  }
  // Intentionally throw even when live-flag is true — the scaffold has no
  // real implementation.  Operator must add the real Coinbase Advanced API
  // call here before flipping the env var.
  throw new Error(
    "Coinbase live trading flag is on but the execution path is not " +
      "implemented.  Build out coinbaseExecution.ts before flipping " +
      "ENABLE_COINBASE_LIVE=true.",
  );
}
