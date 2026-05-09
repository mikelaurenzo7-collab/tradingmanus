/**
 * Polymarket CLOB API Authentication
 *
 * Polymarket uses L2 credentials (API key / secret / passphrase) for the
 * Central Limit Order Book (CLOB) API.  These are separate from the on-chain
 * wallet keys and are generated inside the Polymarket UI.
 *
 * Reference: https://docs.polymarket.com/#authentication
 */

import crypto from "crypto";
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

const POLYMARKET_CLOB_BASE_URL = "https://clob.polymarket.com";

/**
 * Build the HMAC-SHA-256 signature required by Polymarket CLOB.
 */
function buildPolymarketSignature(
  apiSecret: string,
  timestamp: string,
  method: string,
  path: string,
  body: string = "",
) {
  const message = timestamp + method.toUpperCase() + path + body;
  return crypto.createHmac("sha256", apiSecret).update(message).digest("base64");
}

function buildPolymarketHeaders(
  apiKey: string,
  apiSecret: string,
  apiPassphrase: string,
  method: string,
  path: string,
  body: string = "",
) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = buildPolymarketSignature(apiSecret, timestamp, method, path, body);

  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "POLY-API-KEY": apiKey,
    "POLY-SIGNATURE": signature,
    "POLY-TIMESTAMP": timestamp,
    "POLY-PASSPHRASE": apiPassphrase,
  };
}

/**
 * Validate Polymarket CLOB API credentials by calling the /auth/api-key endpoint.
 */
export async function validatePolymarketCredentials(
  apiKey: string,
  apiSecret: string,
  apiPassphrase: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
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

    const path = "/auth/api-key";
    const url = `${POLYMARKET_CLOB_BASE_URL}${path}`;
    const headers = buildPolymarketHeaders(
      apiKey.trim(),
      apiSecret.trim(),
      apiPassphrase.trim(),
      "GET",
      path,
    );

    const response = await fetchWithRetry(url, { method: "GET", headers }, { label: "Polymarket.validateCredentials", breaker: polymarketBreaker });

    // A 200 means the key is accepted; anything else is an auth failure.
    if (response.ok) {
      return { valid: true };
    }

    const text = await response.text();
    let message = `HTTP ${response.status}`;
    try {
      const payload = JSON.parse(text) as Record<string, unknown>;
      if (typeof payload.error === "string") message = payload.error;
      else if (typeof payload.message === "string") message = payload.message;
    } catch {
      // ignore parse errors
    }

    return { valid: false, error: message };
  } catch (error) {
    logger.error({ err: error }, "[Polymarket Auth] Validation failed");
    return {
      valid: false,
      error:
        error instanceof Error ? error.message : "Failed to validate Polymarket credentials",
    };
  }
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
 * Place an order on Polymarket CLOB.
 *
 * KNOWN LIMITATION: the production Polymarket CLOB rejects this simplified
 * `{ token_id, price, size, side, order_type }` body.  The real `/order`
 * endpoint expects an EIP-712-signed `order` object containing maker/taker
 * amounts (USDC scaled to 6 decimals + token quantity scaled to 6 decimals),
 * `owner`, `signer`, `signature`, and a typed-data structure signed against
 * the Polymarket CTF Exchange contract on Polygon.  Building that signing
 * layer is a separate ~200 LOC subproject (viem + USDC scaling + typed-data
 * domain).  Until that lands, autonomy + auto-close are GUARDED off via the
 * `POLYMARKET_LIVE_TRADING_ENABLED=false` default below; only the read-only
 * cross-platform arb DETECTION + Gamma market scan are wired to live data.
 *
 * This function is left in place (rather than throwing immediately) so the
 * test suite + audit-event shape stay intact.  The runtime gate at the
 * call sites returns `success: false` with a clear error before reaching
 * here; if you remove that gate without first wiring EIP-712 signing, this
 * function will reach Polymarket and be rejected at the API boundary.
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
  },
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  if (!ENV.polymarketLiveTradingEnabled) {
    return {
      success: false,
      error:
        "Polymarket live trading is disabled (POLYMARKET_LIVE_TRADING_ENABLED=false). " +
        "The CLOB requires an EIP-712 signed order body which is not yet implemented; " +
        "flip the env var only after that signing layer lands or trades will be rejected.",
    };
  }
  try {
    const path = "/order";
    const url = `${POLYMARKET_CLOB_BASE_URL}${path}`;
    const bodyObj = {
      token_id: order.tokenId,
      price: order.price,
      size: order.size,
      side: order.side,
      order_type: "GTC",
    };
    const body = JSON.stringify(bodyObj);
    const headers = buildPolymarketHeaders(
      apiKey,
      apiSecret,
      apiPassphrase,
      "POST",
      path,
      body,
    );

    const response = await fetchWithRetry(url, { method: "POST", headers, body }, { label: "Polymarket.placeOrder", breaker: polymarketBreaker });
    const payload = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const msg =
        typeof payload.error === "string"
          ? payload.error
          : typeof payload.message === "string"
            ? payload.message
            : `HTTP ${response.status}`;
      return { success: false, error: msg };
    }

    return {
      success: true,
      orderId: typeof payload.order_id === "string" ? payload.order_id : undefined,
    };
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
  position: { tokenId: string; sizeUsdc: number; price: number },
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  // CLOB `size` is TOKEN quantity, not USDC notional.  Convert the USDC
  // budget into tokens via `sizeUsdc / price`.  Floor a hair below to avoid
  // rounding above the requested notional.
  const tokens = Math.max(
    0,
    Math.floor((position.sizeUsdc / Math.max(position.price, 1e-6)) * 100) / 100,
  );
  return placePolymarketOrder(apiKey, apiSecret, apiPassphrase, {
    tokenId: position.tokenId,
    side: "SELL",
    price: position.price,
    size: tokens,
  });
}
