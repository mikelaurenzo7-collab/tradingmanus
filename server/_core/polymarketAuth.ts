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
import { logger } from "./logger";

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

    const response = await fetch(url, { method: "GET", headers });

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

    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Polymarket gamma API returned HTTP ${response.status}`);
    }

    const raw = (await response.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.map((m) => {
      const tokens = Array.isArray(m.tokens)
        ? (m.tokens as Array<Record<string, unknown>>).map((t) => ({
            token_id: String(t.token_id ?? t.tokenId ?? ""),
            outcome: String(t.outcome ?? ""),
            price: Number(t.price ?? 0),
          }))
        : [];

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

    const response = await fetch(url, { method: "POST", headers, body });
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
