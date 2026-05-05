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
 *
 * Enhanced capabilities (matching Kalshi):
 *   - AI trader review (Claude)
 *   - Dynamic risk limits based on capital and posture
 *   - Training instructions support
 *   - Comprehensive signal filtering
 *   - Performance metrics tracking
 */

import * as db from "../db";
import * as polymarketCredDb from "../db.polymarket-credentials";
import * as tradingPreferencesDb from "../db.trading-preferences";
import type { RiskPosture } from "../db.trading-preferences";
import { getUserTrainingInstructions, isInstructionActiveNow, applyInstructionsToSignals } from "../db.training";
import { fetchPolymarketMarkets, placePolymarketOrder } from "./polymarketAuth";
import { generatePolymarketSignals, type PolymarketSignal } from "./polymarketSignals";
import {
  estimateSizeForRiskBudget,
  validatePolymarketOrderRisk,
  MAX_POLYMARKET_ORDER_USDC,
} from "./polymarketRisk";
import { assertPositiveIntegerUserId } from "./userScope";
import { recordPolymarketTradeEntry } from "./polymarketLearning";
import { logger } from "./logger";

const MAX_SCHEDULED_MARKETS = 80;
const BASE_RISK_LIMITS = {
  maxLossPerTrade: 5,
  maxLossPerDay: 10,
  maxPositionSize: 20,
  maxOpenPositions: 5,
} as const;

const POSTURE_MULTIPLIERS: Record<RiskPosture, { sizeScale: number; confidenceBoost: number; positionScale: number }> = {
  conservative: { sizeScale: 0.5,  confidenceBoost: 0.08,  positionScale: 0.6 },
  balanced:     { sizeScale: 1.0,  confidenceBoost: 0.0,   positionScale: 1.0 },
  aggressive:   { sizeScale: 1.5,  confidenceBoost: -0.05, positionScale: 1.4 },
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

/**
 * Calculate dynamic risk limits based on capital and risk posture
 */
async function getDynamicRiskLimitsForPolymarket(
  riskPosture: RiskPosture,
  userId: number
) {
  const scopedUserId = assertPositiveIntegerUserId(
    userId,
    "polymarket risk limits userId"
  );
  const capital = await db.getKalshiCapital(scopedUserId);
  const maxCapital = Math.max(
    0,
    Number(capital?.currentBalance ?? capital?.startingBalance ?? 0)
  );

  if (maxCapital <= 0) {
    return {
      maxCapital,
      maxLossPerTrade: 0,
      maxLossPerDay: 0,
      maxPositionSize: 0,
      maxOpenPositions: 0,
      effectiveMinConfidence: 0,
    };
  }

  const { positionScale, confidenceBoost } =
    POSTURE_MULTIPLIERS[riskPosture] ?? POSTURE_MULTIPLIERS.balanced;

  return {
    maxCapital,
    maxLossPerTrade: clamp(
      maxCapital * 0.05 * positionScale,
      1,
      BASE_RISK_LIMITS.maxLossPerTrade
    ),
    maxLossPerDay: clamp(maxCapital * 0.1, 2, BASE_RISK_LIMITS.maxLossPerDay),
    maxPositionSize: clamp(
      maxCapital * 0.2 * positionScale,
      2,
      BASE_RISK_LIMITS.maxPositionSize
    ),
    maxOpenPositions: BASE_RISK_LIMITS.maxOpenPositions,
    effectiveMinConfidence: confidenceBoost,
  };
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

  // --- 0. Subscription gate: user must be subscribed to Polymarket ---
  const subscribed = await polymarketCredDb.isUserSubscribedToPolymarket(scopedUserId);
  if (!subscribed) {
    logger.info({ userId: scopedUserId }, "[PolymarketAutonomy] Run skipped — user not subscribed to Polymarket");
    return {
      success: true,
      status: "skipped",
      reason: "user is not subscribed to Polymarket",
      signalsGenerated: 0,
      executionCandidates: 0,
      orderPlaced: false,
    };
  }

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

  // Load training instructions and apply to signals
  const allInstructions = await getUserTrainingInstructions(scopedUserId);
  const activeInstructions = allInstructions.filter(isInstructionActiveNow);

  // Apply instructions to filter markets before signal generation
  let filteredMarkets = markets;
  if (activeInstructions.length > 0) {
    filteredMarkets = markets.filter((market) => {
      for (const instruction of activeInstructions) {
        for (const rule of instruction.rules ?? []) {
          if (rule.ruleType === "exclude" || rule.ruleType === "forbid") {
            if (
              rule.ruleKey === "category" &&
              String(market.category ?? "")
                .toLowerCase()
                .includes(String(rule.ruleValue).toLowerCase())
            ) {
              return false;
            }
            if (
              rule.ruleKey === "question" &&
              String(market.question ?? "")
                .toLowerCase()
                .includes(String(rule.ruleValue).toLowerCase())
            ) {
              return false;
            }
          }
          if (rule.ruleType === "include" || rule.ruleType === "require") {
            if (rule.ruleKey === "category") {
              if (
                !String(market.category ?? "")
                  .toLowerCase()
                  .includes(String(rule.ruleValue).toLowerCase())
              ) {
                return false;
              }
            }
          }
        }
      }
      return true;
    });
  }

  const { sizeScale, confidenceBoost } =
    POSTURE_MULTIPLIERS[preferences.riskPosture as RiskPosture] ??
    POSTURE_MULTIPLIERS.balanced;

  const baseMinConfidence = clamp(preferences.minSignalConfidence, 0.5, 0.99);
  const effectiveMinConfidence = clamp(
    baseMinConfidence + confidenceBoost,
    0.5,
    0.99
  );

  const allSignals = generatePolymarketSignals(filteredMarkets, {
    minConfidence: effectiveMinConfidence,
    minLiquidity: 200,
  });

  // Filter out wash-volume warnings (not executable)
  let executableSignals = allSignals.filter(
    (s) => s.signalType !== "wash_volume_warning"
  );

  // Apply training instructions to signals
  if (activeInstructions.length > 0) {
    executableSignals = applyInstructionsToSignals(
      executableSignals,
      activeInstructions
    );
  }

  // Import and use AI trader duo review
  const { reviewPolymarketSignalsWithTrader } = await import(
    "./polymarketSignalReviewer"
  );

  // Claude is the trading reviewer.  Passing userId enables per-desk memory
  // injection — each Polymarket desk loads its prior win/loss tape from
  // the deskMemory table before this call.  Telemetry captures cache hit
  // rate, web_search invocations, and triage stats for the audit log.
  const { newReviewerTelemetry, getCacheHitRatio } = await import("./aiToolbelt");
  const telemetry = newReviewerTelemetry();
  const reviewedSignals = await reviewPolymarketSignalsWithTrader(
    {
      markets: filteredMarkets,
      signals: executableSignals,
      maxSignals: 12,
    },
    { userId: scopedUserId, telemetry },
  );

  await db.logAuditEvent(
    "polymarket_reviewer_telemetry",
    JSON.stringify({
      desks: telemetry.desks,
      cacheHitRatio: Number(getCacheHitRatio(telemetry).toFixed(3)),
      cacheReadInputTokens: telemetry.cacheReadInputTokens,
      cacheCreationInputTokens: telemetry.cacheCreationInputTokens,
      inputTokens: telemetry.inputTokens,
      outputTokens: telemetry.outputTokens,
      webSearchInvocations: telemetry.webSearchInvocations,
      extendedThinkingInvocations: telemetry.extendedThinkingInvocations,
      triageRan: telemetry.triageRan,
      triageInputCount: telemetry.triageInputCount,
      triageKeptCount: telemetry.triageKeptCount,
      anthropicCalls: telemetry.anthropicCalls,
      anthropicFailures: telemetry.anthropicFailures,
    }),
    triggeredByOpenId,
  );

  if (reviewedSignals.length === 0) {
    await db.logAuditEvent(
      "polymarket_autonomy_run_generated_only",
      JSON.stringify({
        signalsGenerated: allSignals.length,
        reason: "no signals passed AI trader duo review",
      }),
      triggeredByOpenId
    );
    return {
      success: true,
      status: "generated_only",
      reason: "no signals passed AI trader duo review",
      signalsGenerated: allSignals.length,
      executionCandidates: 0,
      orderPlaced: false,
    };
  }

  const sorted = sortSignals(reviewedSignals);
  const candidates = sorted.slice(0, 5);

  // --- 4. Pick best candidate and size position with dynamic risk limits ---
  const riskLimits = await getDynamicRiskLimitsForPolymarket(
    preferences.riskPosture as RiskPosture,
    scopedUserId
  );

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
  const bankroll = Math.max(
    0,
    Number(
      kalshiCapital?.currentBalance ??
        kalshiCapital?.startingBalance ??
        riskLimits.maxCapital ??
        0
    )
  );

  const maxBudget = Math.min(
    preferences.maxOrderNotional,
    riskLimits.maxPositionSize,
    riskLimits.maxLossPerTrade,
    bankroll
  );

  const rawSize = estimateSizeForRiskBudget(
    bankroll,
    best.fairValueEstimate,
    best.limitPrice,
    MAX_POLYMARKET_ORDER_USDC,
    0.25
  );
  const scaledSize = clamp(rawSize * sizeScale, 0.01, maxBudget);

  if (bankroll <= 0) {
    const blockReasonZero = "bankroll is zero — cannot size Polymarket order";
    await db.logAuditEvent(
      "polymarket_autonomy_run_blocked",
      JSON.stringify({ reason: blockReasonZero, marketId: best.marketId }),
      triggeredByOpenId,
    );
    await db.logAuditEvent(
      "polymarket_order_blocked_or_failed",
      JSON.stringify({
        market: best.marketId,
        side: best.side,
        reason: "RISK_BLOCK_ZERO_BANKROLL",
        size: scaledSize,
      }),
      triggeredByOpenId,
    );
    return {
      success: true,
      status: "blocked",
      reason: blockReasonZero,
      signalsGenerated: allSignals.length,
      executionCandidates: candidates.length,
      orderPlaced: false,
    };
  }

  const riskCheck = validatePolymarketOrderRisk(
    { price: best.limitPrice, size: scaledSize },
    {
      maxOrderUsdc: preferences.maxOrderNotional,
      maxExposurePercent: 0.05,
      bankroll,
    },
  );

  if (!riskCheck.valid) {
    await db.logAuditEvent(
      "polymarket_autonomy_run_blocked",
      JSON.stringify({ reason: riskCheck.reason, marketId: best.marketId }),
      triggeredByOpenId,
    );
    await db.logAuditEvent(
      "polymarket_order_blocked_or_failed",
      JSON.stringify({
        market: best.marketId,
        side: best.side,
        reason: "RISK_BLOCK_VALIDATION",
        size: scaledSize,
        error: riskCheck.reason ?? "order failed risk validation",
      }),
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
    await db.logAuditEvent(
      "polymarket_order_blocked_or_failed",
      JSON.stringify({
        market: best.marketId,
        side: best.side,
        reason: "RISK_BLOCK_APPROVAL_REQUIRED",
        size: scaledSize,
      }),
      triggeredByOpenId,
    );
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
      await db.logAuditEvent(
        "polymarket_order_blocked_or_failed",
        JSON.stringify({
          market: best.marketId,
          side: best.side,
          reason: "REST_ERROR",
          error: orderResult.error ?? "order placement failed",
        }),
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
      triggeredByOpenId
    );

    // Record trade entry for learning loop
    await recordPolymarketTradeEntry(
      scopedUserId,
      best.marketId,
      best.tokenId,
      `signal-${Date.now()}`,
      best.signalType,
      best.side,
      best.limitPrice,
      scaledSize,
      best.reasoning
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
    logger.error({ err: error, marketId: best.marketId }, "[PolymarketAutonomy] Order placement error");
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
