/**
 * Polymarket Autonomous Trading Engine
 *
 * Mirrors the patterns of kalshiAutonomy.ts but for the Polymarket CLOB.
 * Generates signals from live Polymarket markets, applies risk/preference
 * guardrails, and (when live trading is enabled) places the best-scoring
 * CLOB order.
 *
 * Key differences from Kalshi autonomy:
 *   - Uses Polymarket tokens (not Kalshi contracts).
 *   - Order size in USDC (not contracts × price).
 *   - Reads Polymarket credentials from polymarketCredDb.
 *   - Does NOT use the Kalshi-specific DB tables (autonomyRuns, positions).
 *     Instead it logs via the shared audit log.
 */

import * as db from "../db";
import * as polymarketCredDb from "../db.polymarket-credentials";
import * as tradingPreferencesDb from "../db.trading-preferences";
import type { RiskPosture } from "../db.trading-preferences";
import { fetchPolymarketMarkets, placePolymarketOrder } from "./polymarketAuth";
import { generatePolymarketSignals, type PolymarketSignal } from "./polymarketSignals";
import {
  estimateSizeForRiskBudget,
  validatePolymarketOrderRisk,
  MAX_POLYMARKET_ORDER_USDC,
} from "./polymarketRisk";
import { assertPositiveIntegerUserId } from "./userScope";

const MAX_SCHEDULED_MARKETS = 80;

const POSTURE_MULTIPLIERS: Record<RiskPosture, { sizeScale: number; confidenceBoost: number }> = {
  conservative: { sizeScale: 0.5,  confidenceBoost: 0.08  },
  balanced:     { sizeScale: 1.0,  confidenceBoost: 0.0   },
  aggressive:   { sizeScale: 1.5,  confidenceBoost: -0.05 },
};

export type PolymarketAutonomyRunResult = {
  success: boolean;
  status: "executed" | "generated_only" | "skipped" | "blocked" | "error";
  reason: string;
  signalsGenerated: number;
  executionCandidates: number;
  orderPlaced: boolean;
  orderId?: string;
  executedMarketId?: string;
  executedTokenId?: string;
  executedSide?: "yes" | "no";
  executedPrice?: number;
  executedSizeUsdc?: number;
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
}

function sortSignals(signals: PolymarketSignal[]): PolymarketSignal[] {
  return [...signals].sort((a, b) => {
    // Primary: confidence; secondary: expected value
    const scoreDiff = b.confidence - a.confidence;
    if (Math.abs(scoreDiff) > 0.01) return scoreDiff;
    return b.expectedValue - a.expectedValue;
  });
}

/**
 * Determine whether this autonomy run should be skipped given the user's
 * trading preferences.
 */
function shouldSkip(
  preferences: Awaited<ReturnType<typeof tradingPreferencesDb.getTradingPreferences>>,
): string | null {
  if (!preferences.liveTradingEnabled) {
    return "live trading is disarmed";
  }
  if (preferences.autonomyMode === "manual") {
    return "manual mode forbids automatic execution";
  }
  if (preferences.executionCadence === "manual_only") {
    return "manual-only cadence skips away-from-chat execution";
  }
  if (preferences.executionCadence === "session_assisted") {
    return "session-assisted cadence only allows supervised in-app execution";
  }
  return null;
}

/**
 * Run a single autonomous Polymarket trading cycle for one user.
 */
export async function runPolymarketAutonomousTrading(
  userId: number,
  options: { triggeredByOpenId?: string } = {},
): Promise<PolymarketAutonomyRunResult> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "polymarket autonomy userId");
  const triggeredByOpenId = options.triggeredByOpenId ?? `user:${scopedUserId}`;

  // --- 1. Load preferences ---
  const preferences = await tradingPreferencesDb.getTradingPreferences(scopedUserId);
  const skipReason = shouldSkip(preferences);
  if (skipReason) {
    return {
      success: true,
      status: "skipped",
      reason: skipReason,
      signalsGenerated: 0,
      executionCandidates: 0,
      orderPlaced: false,
    };
  }

  // --- 2. Load Polymarket credentials ---
  const creds = await polymarketCredDb.getPolymarketCredentials(scopedUserId);
  if (!creds || creds.accountStatus !== "connected") {
    return {
      success: false,
      status: "blocked",
      reason: "no connected Polymarket account",
      signalsGenerated: 0,
      executionCandidates: 0,
      orderPlaced: false,
    };
  }

  // --- 3. Fetch markets and generate signals ---
  const markets = await fetchPolymarketMarkets({ limit: MAX_SCHEDULED_MARKETS });
  if (markets.length === 0) {
    return {
      success: true,
      status: "generated_only",
      reason: "no live Polymarket markets available",
      signalsGenerated: 0,
      executionCandidates: 0,
      orderPlaced: false,
    };
  }

  const { sizeScale, confidenceBoost } =
    POSTURE_MULTIPLIERS[preferences.riskPosture as RiskPosture] ?? POSTURE_MULTIPLIERS.balanced;

  const baseMinConfidence = clamp(preferences.minSignalConfidence, 0.5, 0.99);
  const effectiveMinConfidence = clamp(baseMinConfidence + confidenceBoost, 0.5, 0.99);

  const allSignals = generatePolymarketSignals(markets, {
    minConfidence: effectiveMinConfidence,
    minLiquidity: 200,
  });

  // Filter out wash-volume warnings (not executable)
  const executableSignals = allSignals.filter(
    (s) => s.signalType !== "wash_volume_warning",
  );

  if (executableSignals.length === 0) {
    await db.logAuditEvent(
      "polymarket_autonomy_run_generated_only",
      JSON.stringify({ signalsGenerated: 0, reason: "no executable signals above confidence threshold" }),
      triggeredByOpenId,
    );
    return {
      success: true,
      status: "generated_only",
      reason: "no executable signals above confidence threshold",
      signalsGenerated: allSignals.length,
      executionCandidates: 0,
      orderPlaced: false,
    };
  }

  const sorted = sortSignals(executableSignals);
  const candidates = sorted.slice(0, 5);

  // --- 4. Pick best candidate and size position ---
  const best = candidates[0];
  if (!best) {
    return {
      success: true,
      status: "generated_only",
      reason: "no candidate signals",
      signalsGenerated: allSignals.length,
      executionCandidates: 0,
      orderPlaced: false,
    };
  }

  // Use Kalshi capital as a proxy for Polymarket bankroll. This is a
  // reasonable starting point because most users fund both from the same
  // overall budget, but a dedicated Polymarket balance endpoint (not yet
  // available in the public CLOB API) should replace this when accessible.
  const kalshiCapital = await db.getKalshiCapital(scopedUserId);
  const bankroll = Math.max(0, Number(kalshiCapital?.currentBalance ?? kalshiCapital?.startingBalance ?? 0));

  const rawSize = estimateSizeForRiskBudget(
    bankroll,
    best.fairValueEstimate,
    best.limitPrice,
    MAX_POLYMARKET_ORDER_USDC,
    0.25,
  );
  const scaledSize = clamp(rawSize * sizeScale, 0.01, preferences.maxOrderNotional);

  const riskCheck = validatePolymarketOrderRisk(
    { price: best.limitPrice, size: scaledSize },
    {
      maxOrderUsdc: preferences.maxOrderNotional,
      maxExposurePercent: 0.05,
      bankroll: bankroll > 0 ? bankroll : 1000,
    },
  );

  if (!riskCheck.valid) {
    await db.logAuditEvent(
      "polymarket_autonomy_run_blocked",
      JSON.stringify({ reason: riskCheck.reason, marketId: best.marketId }),
      triggeredByOpenId,
    );
    return {
      success: true,
      status: "blocked",
      reason: riskCheck.reason ?? "order failed risk validation",
      signalsGenerated: allSignals.length,
      executionCandidates: candidates.length,
      orderPlaced: false,
    };
  }

  // --- 5. Gating: semi-autonomous requires approval above threshold ---
  if (
    preferences.autonomyMode === "semi_autonomous" &&
    scaledSize > preferences.requireApprovalAbove
  ) {
    return {
      success: true,
      status: "blocked",
      reason: "semi-autonomous mode requires manual approval for orders above threshold",
      signalsGenerated: allSignals.length,
      executionCandidates: candidates.length,
      orderPlaced: false,
    };
  }

  // --- 6. Place the order ---
  try {
    const orderResult = await placePolymarketOrder(
      creds.apiKey,
      creds.apiSecret,
      creds.apiPassphrase,
      {
        tokenId: best.tokenId,
        side: "BUY",
        price: best.limitPrice,
        size: scaledSize,
      },
    );

    if (!orderResult.success) {
      await db.logAuditEvent(
        "polymarket_autonomy_run_error",
        JSON.stringify({ error: orderResult.error, marketId: best.marketId }),
        triggeredByOpenId,
      );
      return {
        success: false,
        status: "error",
        reason: orderResult.error ?? "order placement failed",
        signalsGenerated: allSignals.length,
        executionCandidates: candidates.length,
        orderPlaced: false,
      };
    }

    await db.logAuditEvent(
      "polymarket_autonomy_order_placed",
      JSON.stringify({
        orderId: orderResult.orderId,
        marketId: best.marketId,
        tokenId: best.tokenId,
        side: best.side,
        price: best.limitPrice,
        sizeUsdc: scaledSize,
        confidence: best.confidence,
        signalType: best.signalType,
        reasoning: best.reasoning,
      }),
      triggeredByOpenId,
    );

    return {
      success: true,
      status: "executed",
      reason: `placed ${best.side.toUpperCase()} order on ${best.marketId} at ${best.limitPrice} for ${scaledSize.toFixed(2)} USDC`,
      signalsGenerated: allSignals.length,
      executionCandidates: candidates.length,
      orderPlaced: true,
      orderId: orderResult.orderId,
      executedMarketId: best.marketId,
      executedTokenId: best.tokenId,
      executedSide: best.side,
      executedPrice: best.limitPrice,
      executedSizeUsdc: scaledSize,
    };
  } catch (error) {
    console.error("[PolymarketAutonomy] Order placement error:", error);
    await db.logAuditEvent(
      "polymarket_autonomy_run_error",
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        marketId: best.marketId,
      }),
      triggeredByOpenId,
    );
    return {
      success: false,
      status: "error",
      reason: error instanceof Error ? error.message : "unexpected error during order placement",
      signalsGenerated: allSignals.length,
      executionCandidates: candidates.length,
      orderPlaced: false,
    };
  }
}
