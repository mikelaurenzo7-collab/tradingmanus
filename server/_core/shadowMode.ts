/**
 * Shadow trading mode.
 *
 * When enabled, the autonomy loops run through the full reviewer + signal
 * pipeline (and burn the same AI tokens) but order placement is intercepted:
 * a structured `*_shadow_order_intent` audit event is written instead of a
 * real order being sent to the exchange.
 *
 * The point is to validate edge before risking real capital.  Run the system
 * shadow for several weeks, then aggregate the audit log to compute
 * hypothetical PnL versus realized market resolutions and compare against
 * AI cost.  If shadow PnL is negative net of cost + fees + slippage, do not
 * graduate to live trading.
 *
 * Flag is global (env-level) on purpose — operators flip the bot in/out of
 * shadow mode for the whole deployment.  Per-user shadow mode can come
 * later via a column on tradingPreferences.
 */

import * as db from "../db";
import { ENV } from "./env";

export type KalshiShadowOrderIntent = {
  userId: number;
  triggeredByOpenId: string;
  marketId: string;
  marketTitle?: string | null;
  side: "yes" | "no";
  quantity: number;
  limitPrice: number;
  signalConfidence: number;
  signalReasoning: string;
  expectedValue: number;
  availableCapital: number;
  orderExposure: number;
  maxLossOnTrade: number;
};

export type PolymarketShadowOrderIntent = {
  userId: number;
  triggeredByOpenId: string;
  marketId: string;
  question?: string | null;
  tokenId: string;
  side: "yes" | "no";
  limitPrice: number;
  sizeUsdc: number;
  signalConfidence: number;
  signalType: string;
  signalReasoning: string;
};

export function isShadowModeEnabled(): boolean {
  return ENV.shadowTradingMode;
}

/**
 * Synthetic result returned to autonomy callers when an order is intercepted.
 * Matches the shape of `placeKalshiOrder` / `placePolymarketOrder` results
 * closely enough that the success branch downstream does not need bespoke
 * handling — except the orderId is prefixed `shadow:` so any downstream
 * code that tries to fetch real exchange status will fail fast.
 */
export type ShadowOrderResult = {
  success: true;
  orderId: string;
  shadow: true;
  // Empty fields keep this assignable where placeKalshiOrder /
  // placePolymarketOrder results are expected.
  error?: undefined;
  needsReconciliation?: false;
  reconciliationReason?: undefined;
  exchangeRequest?: Record<string, unknown> | undefined;
  exchangeResponse?: Record<string, unknown> | undefined;
};

function shadowOrderId(prefix: string): string {
  return `shadow:${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

export async function recordKalshiShadowOrder(
  intent: KalshiShadowOrderIntent,
): Promise<ShadowOrderResult> {
  const orderId = shadowOrderId("kalshi");
  await db.logAuditEvent(
    "kalshi_shadow_order_intent",
    JSON.stringify({
      shadowOrderId: orderId,
      marketId: intent.marketId,
      marketTitle: intent.marketTitle ?? null,
      side: intent.side,
      quantity: intent.quantity,
      limitPrice: intent.limitPrice,
      notional: intent.orderExposure,
      maxLossOnTrade: intent.maxLossOnTrade,
      signalConfidence: intent.signalConfidence,
      expectedValue: intent.expectedValue,
      reasoning: intent.signalReasoning?.slice(0, 600) ?? "",
      availableCapital: intent.availableCapital,
    }),
    intent.triggeredByOpenId,
  );
  return { success: true, orderId, shadow: true };
}

export async function recordPolymarketShadowOrder(
  intent: PolymarketShadowOrderIntent,
): Promise<ShadowOrderResult> {
  const orderId = shadowOrderId("polymarket");
  await db.logAuditEvent(
    "polymarket_shadow_order_intent",
    JSON.stringify({
      shadowOrderId: orderId,
      marketId: intent.marketId,
      question: intent.question ?? null,
      tokenId: intent.tokenId,
      side: intent.side,
      limitPrice: intent.limitPrice,
      sizeUsdc: intent.sizeUsdc,
      signalType: intent.signalType,
      signalConfidence: intent.signalConfidence,
      reasoning: intent.signalReasoning?.slice(0, 600) ?? "",
    }),
    intent.triggeredByOpenId,
  );
  return { success: true, orderId, shadow: true };
}
