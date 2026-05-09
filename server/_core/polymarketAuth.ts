/**
 * Polymarket CLOB API Authentication
 *
 * Polymarket uses L2 credentials (API key / secret / passphrase) for the
 * Central Limit Order Book (CLOB) API.  These are separate from the on-chain
 * wallet keys and are generated inside the Polymarket UI.
 *
 * Reference: https://docs.polymarket.com/#authentication
 */

import { CircuitBreaker } from "./circuitBreaker";
import { fetchWithRetry } from "./fetchWithRetry";
import { logger } from "./logger";
import { ENV } from "./env";

/**
 * Single shared breaker for all Polymarket CLOB / gamma API calls.
 * Trips after 5 failures in 30 s, fails fast for 30 s, then half-open probe.
 * `now` is injectable so tests can drive the clock deterministically.
 */
export const polymarketBreaker = new CircuitBreaker({
  name: "polymarket",
  failureThreshold: 5,
  windowMs: 30_000,
  cooldownMs: 30_000,
});


/**
 * Validate Polymarket L2 API credentials by format.
 *
 * Polymarket has no GET endpoint that accepts L2 (HMAC) auth for key
 * validation — the /auth/api-key path only accepts POST (returns 405 on GET).
 * Credentials derived via @polymarket/clob-client are definitionally valid at
 * derivation time, so a remote round-trip adds latency without benefit.  We
 * enforce a format floor here; any credential error will surface on the first
 * live order attempt with a clear exchange rejection message.
 */
export async function validatePolymarketCredentials(
  apiKey: string,
  apiSecret: string,
  apiPassphrase: string,
): Promise<{ valid: boolean; error?: string }> {
  if (
    !apiKey ||
    !apiSecret ||
    !apiPassphrase ||
    apiKey.trim().length < 4 ||
    apiSecret.trim().length < 4 ||
    apiPassphrase.trim().length < 4
  ) {
    return { valid: false, error: "Invalid credential format – all three fields are required" };
  }
  return { valid: true };
}

export interface PolymarketMarket {
  marketId: string;
  conditionId: string;
  question: string;
  description: string;
  category: string;
  endDateIso: string | null;
  active: boolean;
  closed: boolean;
  tokens: Array<{ token_id: string; outcome: string; price: number }>;
  volume: number;
  liquidity: number;
  impliedProbabilityYes: number;
}

/**
 * Fetch a page of active Polymarket markets from the CLOB gamma endpoint.
 * No auth is required for public market data.
 */
export async function fetchPolymarketMarkets(options: {
  limit?: number;
  offset?: number;
}): Promise<PolymarketMarket[]> {
  try {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const url = `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=${limit}&offset=${offset}`;

    const response = await fetchWithRetry(url, { method: "GET", headers: { Accept: "application/json" } }, { label: "Polymarket.fetchMarkets", breaker: polymarketBreaker });

    if (!response.ok) {
      throw new Error(`Polymarket gamma API returned HTTP ${response.status}`);
    }

    const raw = (await response.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(raw)) {
      return [];
    }

    // Gamma `/markets` returns token data in three parallel JSON-string
    // fields (`outcomes`, `outcomePrices`, `clobTokenIds`) rather than a
    // structured `tokens` array.  We support BOTH shapes — falling back to
    // the older `tokens` array if a future Gamma response includes it
    // directly — so detection works against current production payloads.
    const parseJsonStringArray = (raw: unknown): string[] => {
      if (Array.isArray(raw)) return raw.map((v) => String(v));
      if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
        } catch {
          return [];
        }
      }
      return [];
    };

    return raw.map((m) => {
      let tokens: Array<{ token_id: string; outcome: string; price: number }> = [];

      if (Array.isArray(m.tokens)) {
        tokens = (m.tokens as Array<Record<string, unknown>>).map((t) => ({
          token_id: String(t.token_id ?? t.tokenId ?? ""),
          outcome: String(t.outcome ?? ""),
          price: Number(t.price ?? 0),
        }));
      } else {
        const outcomes = parseJsonStringArray(m.outcomes);
        const outcomePrices = parseJsonStringArray(m.outcomePrices ?? m.outcome_prices);
        const clobTokenIds = parseJsonStringArray(m.clobTokenIds ?? m.clob_token_ids);
        const len = Math.max(outcomes.length, outcomePrices.length, clobTokenIds.length);
        for (let i = 0; i < len; i++) {
          tokens.push({
            token_id: String(clobTokenIds[i] ?? ""),
            outcome: String(outcomes[i] ?? ""),
            price: Number(outcomePrices[i] ?? 0),
          });
        }
      }

      const yesToken = tokens.find((t) => t.outcome.toLowerCase() === "yes");
      const impliedProbabilityYes = yesToken ? yesToken.price : 0.5;

      return {
        marketId: String(m.id ?? m.marketId ?? m.condition_id ?? ""),
        conditionId: String(m.condition_id ?? m.conditionId ?? ""),
        question: String(m.question ?? m.title ?? ""),
        description: String(m.description ?? ""),
        category: String(m.category ?? "General"),
        endDateIso:
          typeof m.end_date_iso === "string"
            ? m.end_date_iso
            : typeof m.endDateIso === "string"
              ? m.endDateIso
              : null,
        active: Boolean(m.active ?? true),
        closed: Boolean(m.closed ?? false),
        tokens,
        volume: Number(m.volume ?? 0),
        liquidity: Number(m.liquidity ?? m.liquidityNum ?? 0),
        impliedProbabilityYes: Number.isFinite(impliedProbabilityYes)
          ? Math.max(0.01, Math.min(0.99, impliedProbabilityYes))
          : 0.5,
      } satisfies PolymarketMarket;
    });
  } catch (error) {
    logger.error({ err: error }, "[Polymarket] Fetch markets failed");
    return [];
  }
}

/**
 * Place a signed order on Polymarket CLOB.
 *
 * Real Polymarket order submission uses EIP-712 typed-data signing against
 * the CTF Exchange contract on Polygon (chainId 137).  This is wired through
 * `@polymarket/clob-client` in `polymarketSigner.ts` — that module wraps
 * Polymarket's official client with our credential decryption boundary so
 * the wallet private key only lives in plaintext for the lifetime of one
 * call.
 *
 * Caller responsibilities:
 *   • `size` MUST be in TOKEN quantity (not USDC notional).  Polymarket's
 *     `size` field is the token count; the autonomy loop converts from a
 *     USDC budget via `floor(usdc / price)` before invoking us.
 *   • `walletPrivateKey` MUST already be decrypted; we never re-encrypt or
 *     persist it.
 *   • Setting `POLYMARKET_LIVE_TRADING_ENABLED=false` short-circuits this
 *     to a no-op (returns failure) so a misconfigured deploy can't fire
 *     live orders.  Default is now ON, since signing is implemented.
 */
export async function placePolymarketOrder(
  apiKey: string,
  apiSecret: string,
  apiPassphrase: string,
  order: {
    tokenId: string;
    side: "BUY" | "SELL";
    price: number;
    size: number;
    walletPrivateKey: string;
    walletAddress: string;
    signatureType?: number;
  },
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  if (!ENV.polymarketLiveTradingEnabled) {
    return {
      success: false,
      error:
        "Polymarket live trading is disabled (POLYMARKET_LIVE_TRADING_ENABLED=false). " +
        "Flip the env var to enable live order placement.",
    };
  }
  if (!order.walletPrivateKey || !order.walletAddress) {
    return {
      success: false,
      error: "Polymarket wallet private key + funder address required for order signing",
    };
  }
  // Gate live placement on POLYMARKET_OWNER_ADDRESS being set.  Without it,
  // syncPolymarketPositions() silently no-ops, so newly opened live positions
  // are invisible to the exit monitor (no auto-close, no trailing stop, no
  // drift-close detection).  Failing closed here is safer than placing an
  // order we can't reconcile.
  if (!ENV.polymarketOwnerAddress) {
    return {
      success: false,
      error:
        "POLYMARKET_OWNER_ADDRESS is not set — live placement blocked.  " +
        "Without the EOA proxy address, position-sync cannot reconcile new " +
        "positions and the exit monitor would never see them.  Set the " +
        "env var to your Polymarket wallet address (the 0x... shown on " +
        "your account page) and redeploy.",
    };
  }
  try {
    const { buildPolymarketClobClient, submitSignedPolymarketOrder } = await import(
      "./polymarketSigner"
    );
    const client = buildPolymarketClobClient({
      apiKey,
      apiSecret,
      apiPassphrase,
      privateKey: order.walletPrivateKey,
      walletAddress: order.walletAddress,
      signatureType: order.signatureType as 0 | 1 | 2 | undefined,
    });
    return await submitSignedPolymarketOrder(client, {
      tokenId: order.tokenId,
      side: order.side,
      price: order.price,
      size: order.size,
    });
  } catch (error) {
    logger.error({ err: error }, "[Polymarket] Place order failed");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to place order",
    };
  }
}


/**
 * Close a Polymarket position by placing a SELL order at the given limit
 * price.  On the Polymarket CLOB, "closing" a position means placing a
 * SELL for the same token-id you previously bought; when the SELL fills,
 * your token balance returns to zero.
 *
 * The SELL is GTC at the supplied limit (typically the current market
 * price from a fresh fetchPolymarketMarkets() call).  If the book lacks
 * matching bids the order rests until cancelled — callers should treat
 * non-immediate fills as a known limitation.  A future pass should add
 * IOC + price-improvement retry logic.
 */
export async function closePolymarketPosition(
  apiKey: string,
  apiSecret: string,
  apiPassphrase: string,
  position: {
    tokenId: string;
    sizeUsdc: number;
    /** Limit price for the SELL order — typically the current mark. */
    price: number;
    /**
     * Entry price of the position being closed.  Required so we can compute
     * the TOKEN quantity actually held (`sizeUsdc / entryPrice`).  Closing
     * with `sizeUsdc / exitPrice` was wrong: at a stop-loss it tried to
     * SELL more tokens than we hold, and at a profit-target it left
     * exposure behind.
     */
    entryPrice: number;
    walletPrivateKey: string;
    walletAddress: string;
    signatureType?: number;
  },
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  // tokens-held = sizeUsdc / entryPrice (deployed USDC ÷ price paid).  We
  // SELL exactly that quantity, regardless of where the exit price lands.
  // Floor down a hair (×100/100 truncate) so we never round above the held
  // balance and trip "insufficient balance".
  const tokens = Math.max(
    0,
    Math.floor((position.sizeUsdc / Math.max(position.entryPrice, 1e-6)) * 100) / 100,
  );
  return placePolymarketOrder(apiKey, apiSecret, apiPassphrase, {
    tokenId: position.tokenId,
    side: "SELL",
    price: position.price,
    size: tokens,
    walletPrivateKey: position.walletPrivateKey,
    walletAddress: position.walletAddress,
    signatureType: position.signatureType,
  });
}
