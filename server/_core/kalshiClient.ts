/**
 * Kalshi Trade API client — production-ready signing + endpoints.
 *
 * Auth: RSA-PSS (PKCS#1 v1.5 padding=PSS, MGF1, SHA-256, salt=digest length).
 * Headers: KALSHI-ACCESS-KEY, KALSHI-ACCESS-SIGNATURE, KALSHI-ACCESS-TIMESTAMP.
 * Signed message: `${timestamp}${METHOD}${path}` (path includes /trade-api/v2 prefix).
 * Demo mode: DEMO_MODE=true → https://demo-api.kalshi.co
 * Production: https://api.elections.kalshi.com
 */

import crypto from "crypto";
import { URL } from "url";
import { fetchWithRetry } from "./fetchWithRetry";
import {
  getKalshiBaseUrl,
  getKalshiKeyId,
  getKalshiPrivateKeyPem,
} from "./env";
import { logger } from "./logger";
import { normalizePrivateKey } from "./keyUtils";

export type KalshiMethod = "GET" | "POST" | "DELETE" | "PUT";

interface SignedHeaders {
  Accept: string;
  "Content-Type"?: string;
  "KALSHI-ACCESS-KEY": string;
  "KALSHI-ACCESS-SIGNATURE": string;
  "KALSHI-ACCESS-TIMESTAMP": string;
}

function buildSignedHeaders(opts: {
  method: KalshiMethod;
  path: string;
  keyId: string;
  privateKeyPem: string;
  hasBody: boolean;
}): SignedHeaders {
  const timestamp = Date.now().toString();
  const message = `${timestamp}${opts.method.toUpperCase()}${opts.path}`;
  const keyObject = crypto.createPrivateKey({
    key: normalizePrivateKey(opts.privateKeyPem),
    format: "pem",
  });
  const signature = crypto.sign("sha256", Buffer.from(message, "utf8"), {
    key: keyObject,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });
  const headers: SignedHeaders = {
    Accept: "application/json",
    "KALSHI-ACCESS-KEY": opts.keyId,
    "KALSHI-ACCESS-SIGNATURE": signature.toString("base64"),
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
  };
  if (opts.hasBody) headers["Content-Type"] = "application/json";
  return headers;
}

export interface KalshiRequestOptions {
  method?: KalshiMethod;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Force private signing even on routes that work unauthenticated. */
  forceSigned?: boolean;
  /** Override base URL (e.g. for tests). */
  baseUrl?: string;
  /** Pass explicit credentials (e.g. for per-user encrypted keys). */
  credentials?: { keyId: string; privateKeyPem: string };
}

function appendQuery(url: string, query?: KalshiRequestOptions["query"]): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    u.searchParams.append(k, String(v));
  }
  return u.toString();
}

/**
 * Low-level Kalshi request. Handles RSA-PSS signing, JSON parse, and error
 * shaping. Throws on non-2xx.
 */
export async function kalshiRequest<T = unknown>(
  endpoint: string,
  opts: KalshiRequestOptions = {},
): Promise<T> {
  const method = opts.method ?? "GET";
  const baseUrl = opts.baseUrl ?? getKalshiBaseUrl();
  const fullUrl = appendQuery(`${baseUrl}${endpoint}`, opts.query);
  const path = new URL(fullUrl).pathname;

  const isPrivate =
    opts.forceSigned !== false &&
    (opts.forceSigned === true ||
      endpoint.startsWith("/portfolio") ||
      endpoint.startsWith("/markets/positions") ||
      endpoint.startsWith("/orders") ||
      endpoint.startsWith("/fills") ||
      endpoint.startsWith("/exchange/announcements"));

  let headers: Record<string, string>;
  if (isPrivate) {
    const creds = opts.credentials ?? {
      keyId: getKalshiKeyId(),
      privateKeyPem: getKalshiPrivateKeyPem(),
    };
    headers = buildSignedHeaders({
      method,
      path,
      keyId: creds.keyId,
      privateKeyPem: creds.privateKeyPem,
      hasBody: opts.body !== undefined,
    }) as unknown as Record<string, string>;
  } else {
    headers = { Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  }

  const response = await fetchWithRetry(fullUrl, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    const message =
      (payload as { error?: string })?.error ||
      (payload as { message?: string })?.message ||
      `Kalshi ${method} ${endpoint} → HTTP ${response.status}`;
    logger.warn(
      { endpoint, method, status: response.status, payload },
      "[KalshiClient] non-2xx response",
    );
    throw new Error(message);
  }

  return payload as T;
}

// ── Public endpoints (markets / series / orderbook / historical) ───────────

export interface KalshiMarketSummary {
  ticker: string;
  event_ticker?: string;
  series_ticker?: string;
  title: string;
  subtitle?: string;
  status: string;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  last_price?: number;
  volume?: number;
  open_interest?: number;
  liquidity?: number;
  category?: string;
  expiration_time?: string;
  close_time?: string;
  rules_primary?: string;
  rules_secondary?: string;
  can_close_early?: boolean;
}

export async function listMarkets(query?: {
  limit?: number;
  cursor?: string;
  status?: "open" | "closed" | "settled";
  series_ticker?: string;
  event_ticker?: string;
}): Promise<{ markets: KalshiMarketSummary[]; cursor?: string }> {
  return kalshiRequest("/markets", { method: "GET", query, forceSigned: false });
}

export async function getMarket(ticker: string): Promise<{
  market: KalshiMarketSummary;
}> {
  return kalshiRequest(`/markets/${encodeURIComponent(ticker)}`, {
    method: "GET",
    forceSigned: false,
  });
}

export async function listSeries(query?: {
  category?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ series: Array<Record<string, unknown>>; cursor?: string }> {
  return kalshiRequest("/series", { method: "GET", query, forceSigned: false });
}

export async function getMarketOrderbook(
  ticker: string,
  depth = 50,
): Promise<{ orderbook: { yes: Array<[number, number]>; no: Array<[number, number]> } }> {
  return kalshiRequest(`/markets/${encodeURIComponent(ticker)}/orderbook`, {
    method: "GET",
    query: { depth },
    forceSigned: false,
  });
}

export async function getHistoricalCandlesticks(
  ticker: string,
  query: {
    start_ts: number;
    end_ts: number;
    period_interval?: 1 | 60 | 1440;
  },
): Promise<{
  candlesticks: Array<{
    end_period_ts: number;
    yes_bid: { open: number; high: number; low: number; close: number };
    yes_ask: { open: number; high: number; low: number; close: number };
    price: { open: number; high: number; low: number; close: number };
    volume: number;
    open_interest: number;
  }>;
}> {
  return kalshiRequest(
    `/markets/${encodeURIComponent(ticker)}/candlesticks`,
    { method: "GET", query, forceSigned: false },
  );
}

export async function getHistoricalTrades(query: {
  ticker?: string;
  cursor?: string;
  limit?: number;
  min_ts?: number;
  max_ts?: number;
}): Promise<{
  trades: Array<{
    trade_id: string;
    ticker: string;
    yes_price: number;
    no_price: number;
    count: number;
    created_time: string;
    taker_side: "yes" | "no";
  }>;
  cursor?: string;
}> {
  return kalshiRequest("/markets/trades", { method: "GET", query, forceSigned: false });
}

// ── Private endpoints (orders / fills / portfolio) ─────────────────────────

export async function getPortfolioBalance(credentials?: {
  keyId: string;
  privateKeyPem: string;
}): Promise<{ balance: number; payout: number }> {
  return kalshiRequest("/portfolio/balance", {
    method: "GET",
    forceSigned: true,
    credentials,
  });
}

export async function listPositions(query?: {
  limit?: number;
  cursor?: string;
  ticker?: string;
  settlement_status?: "all" | "settled" | "unsettled";
}): Promise<{
  market_positions: Array<{
    ticker: string;
    position: number;
    market_exposure: number;
    realized_pnl: number;
    fees_paid: number;
    last_updated_ts: string;
  }>;
  event_positions: Array<Record<string, unknown>>;
  cursor?: string;
}> {
  return kalshiRequest("/portfolio/positions", {
    method: "GET",
    query,
    forceSigned: true,
  });
}

export interface KalshiPlaceOrderInput {
  ticker: string;
  client_order_id: string;
  type: "limit" | "market";
  side: "yes" | "no";
  action: "buy" | "sell";
  count: number;
  // For limit orders: prices in CENTS (1..99). For taker-style limits send
  // the cent at which you cross.
  yes_price?: number;
  no_price?: number;
  // Optional time-in-force (default expires at end of day on Kalshi).
  expiration_ts?: number;
  // Default true → maker-only (post-only). Strongly preferred for fee tier.
  post_only?: boolean;
}

export async function placeOrder(
  input: KalshiPlaceOrderInput,
  credentials?: { keyId: string; privateKeyPem: string },
): Promise<{
  order: {
    order_id: string;
    status: string;
    yes_price?: number;
    no_price?: number;
    side: string;
    action: string;
    type: string;
  };
}> {
  return kalshiRequest("/portfolio/orders", {
    method: "POST",
    body: input,
    forceSigned: true,
    credentials,
  });
}

export async function cancelOrder(
  orderId: string,
  credentials?: { keyId: string; privateKeyPem: string },
): Promise<{ order: { order_id: string; status: string } }> {
  return kalshiRequest(
    `/portfolio/orders/${encodeURIComponent(orderId)}`,
    { method: "DELETE", forceSigned: true, credentials },
  );
}

export async function listOrders(query?: {
  ticker?: string;
  status?: "resting" | "canceled" | "executed";
  limit?: number;
  cursor?: string;
  min_ts?: number;
  max_ts?: number;
}): Promise<{
  orders: Array<{
    order_id: string;
    ticker: string;
    status: string;
    side: string;
    action: string;
    type: string;
    yes_price?: number;
    no_price?: number;
    remaining_count: number;
    place_time: string;
  }>;
  cursor?: string;
}> {
  return kalshiRequest("/portfolio/orders", {
    method: "GET",
    query,
    forceSigned: true,
  });
}

export async function listFills(query?: {
  ticker?: string;
  order_id?: string;
  limit?: number;
  cursor?: string;
  min_ts?: number;
  max_ts?: number;
}): Promise<{
  fills: Array<{
    trade_id: string;
    order_id: string;
    ticker: string;
    side: string;
    action: string;
    count: number;
    yes_price: number;
    no_price: number;
    is_taker: boolean;
    created_time: string;
  }>;
  cursor?: string;
}> {
  return kalshiRequest("/portfolio/fills", {
    method: "GET",
    query,
    forceSigned: true,
  });
}

/**
 * Convenience: fetch orders + fills + positions + balance in parallel.
 */
export async function fetchPortfolioSnapshot() {
  const [balance, positions, fills] = await Promise.all([
    getPortfolioBalance().catch((err) => {
      logger.warn({ err }, "[KalshiClient] balance fetch failed");
      return null;
    }),
    listPositions({ limit: 100 }).catch((err) => {
      logger.warn({ err }, "[KalshiClient] positions fetch failed");
      return null;
    }),
    listFills({ limit: 100 }).catch((err) => {
      logger.warn({ err }, "[KalshiClient] fills fetch failed");
      return null;
    }),
  ]);
  return { balance, positions, fills };
}
