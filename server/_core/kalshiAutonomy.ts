import type { User } from "../../drizzle/schema";
import * as db from "../db";
import * as kalshiCredDb from "../db.kalshi-credentials";
import * as tradingPreferencesDb from "../db.trading-preferences";
import type { RiskPosture } from "../db.trading-preferences";
import { getUserTrainingInstructions, isInstructionActiveNow, applyInstructionsToSignals } from "../db.training";
import { fetchKalshiMarkets } from "./kalshiMarketData";
import { fetchKalshiAccountEquity } from "./kalshiAuth";
import { getMarketFeed } from "./kalshiMarketFeed";
import {
  filterSignalsByConfidence,
  filterSignalsByMarketConditions,
  generateSignalsForMarkets,
  getTopSignalsForExecution,
  saveSignals,
  type KalshiSignal,
} from "./kalshiSignals";
import { placeKalshiOrder } from "./kalshiExecution";
import { calculateKalshiBuyOrderRisk, estimateContractsForRiskBudget } from "./kalshiRisk";
import { assertPositiveIntegerUserId } from "./userScope";
import { reviewSignalsWithOpenAi } from "./openaiTrader";

const BASE_RISK_LIMITS = {
  maxLossPerTrade: 5,
  maxLossPerDay: 10,
  maxPositionSize: 20,
  maxOpenPositions: 5,
} as const;

const SCHEDULED_SCAN_EVENT = "scheduled_autonomy_scan_completed";
const HOURLY_SCAN_MIN_INTERVAL_MS = 55 * 60 * 1000;
const RECENT_MANUAL_ORDER_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_SCHEDULED_MARKETS = 24;

export type AwayTradingDecisionDetails = {
  marketId: string | null;
  side: "yes" | "no" | null;
  confidence: number | null;
  executionScore: number | null;
  expectedValue: number | null;
  limitPrice: number | null;
  quantity: number | null;
  availableCapital: number | null;
  maxBudget: number | null;
  orderExposure: number | null;
  maxLossOnTrade: number | null;
  reasoning: string | null;
  blockedBy: string | null;
};

export type AwayTradingRunResult = {
  success: boolean;
  status:
    | "executed"
    | "generated_only"
    | "skipped"
    | "blocked"
    | "error";
  reason: string;
  signalsGenerated: number;
  executionCandidates: number;
  orderPlaced: boolean;
  orderId?: string;
  executedMarketId?: string;
  candidateMarketId?: string;
  autonomyMode?: string;
  executionCadence?: string;
  decision?: AwayTradingDecisionDetails | null;
};

function clampRiskLimit(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

const POSTURE_MULTIPLIERS: Record<RiskPosture, { positionScale: number; confidenceBoost: number }> = {
  conservative: { positionScale: 0.6, confidenceBoost: 0.08 },
  balanced:     { positionScale: 1.0, confidenceBoost: 0.0  },
  aggressive:   { positionScale: 1.4, confidenceBoost: -0.05 },
};

async function getDynamicRiskLimits(riskPosture: RiskPosture, userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "autonomy risk limits userId");
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

  const { positionScale, confidenceBoost } = POSTURE_MULTIPLIERS[riskPosture] ?? POSTURE_MULTIPLIERS.balanced;

  return {
    maxCapital,
    maxLossPerTrade: clampRiskLimit(maxCapital * 0.05 * positionScale, 1, BASE_RISK_LIMITS.maxLossPerTrade),
    maxLossPerDay: clampRiskLimit(maxCapital * 0.1, 2, BASE_RISK_LIMITS.maxLossPerDay),
    maxPositionSize: clampRiskLimit(maxCapital * 0.2 * positionScale, 2, BASE_RISK_LIMITS.maxPositionSize),
    maxOpenPositions: BASE_RISK_LIMITS.maxOpenPositions,
    effectiveMinConfidence: confidenceBoost,
  };
}

function buildResult(
  input: Omit<AwayTradingRunResult, "success"> & { success?: boolean }
): AwayTradingRunResult {
  return {
    success: input.success ?? input.status !== "error",
    status: input.status,
    reason: input.reason,
    signalsGenerated: input.signalsGenerated,
    executionCandidates: input.executionCandidates,
    orderPlaced: input.orderPlaced,
    orderId: input.orderId,
    executedMarketId: input.executedMarketId,
    candidateMarketId: input.candidateMarketId,
    autonomyMode: input.autonomyMode,
    executionCadence: input.executionCadence,
    decision: input.decision ?? null,
  };
}

function buildDecisionDetails(
  signal?: (KalshiSignal & { executionScore?: number }) | null,
  overrides: Partial<AwayTradingDecisionDetails> = {}
): AwayTradingDecisionDetails | null {
  if (!signal && !overrides.marketId) {
    return null;
  }

  return {
    marketId: overrides.marketId ?? signal?.marketId ?? null,
    side: overrides.side ?? signal?.side ?? null,
    confidence: overrides.confidence ?? signal?.confidence ?? null,
    executionScore: overrides.executionScore ?? signal?.executionScore ?? null,
    expectedValue: overrides.expectedValue ?? signal?.expectedValue ?? null,
    limitPrice: overrides.limitPrice ?? signal?.marketPrice ?? null,
    quantity: overrides.quantity ?? null,
    availableCapital: overrides.availableCapital ?? null,
    maxBudget: overrides.maxBudget ?? null,
    orderExposure: overrides.orderExposure ?? null,
    maxLossOnTrade: overrides.maxLossOnTrade ?? null,
    reasoning: overrides.reasoning ?? signal?.reasoning ?? null,
    blockedBy: overrides.blockedBy ?? null,
  };
}

async function persistScheduledResult(user: User, result: AwayTradingRunResult) {
  await db.logAuditEvent(
    `scheduled_autonomy_run_${result.status}`,
    JSON.stringify({
      reason: result.reason,
      signalsGenerated: result.signalsGenerated,
      executionCandidates: result.executionCandidates,
      orderPlaced: result.orderPlaced,
      orderId: result.orderId ?? null,
      executedMarketId: result.executedMarketId ?? null,
      candidateMarketId: result.candidateMarketId ?? null,
      autonomyMode: result.autonomyMode ?? null,
      executionCadence: result.executionCadence ?? null,
      decision: result.decision ?? null,
    }),
    user.openId
  );

  return result;
}

function extractActionableMarkets(markets: Awaited<ReturnType<typeof fetchKalshiMarkets>>) {
  return markets.filter((market) => {
    const yesPrice = Number(market.yesPrice);
    const noPrice = Number(market.noPrice);
    const impliedProbability = Number(market.impliedProbability);

    return (
      Number.isFinite(yesPrice) &&
      Number.isFinite(noPrice) &&
      Number.isFinite(impliedProbability) &&
      yesPrice > 0.01 &&
      yesPrice < 0.99 &&
      noPrice > 0.01 &&
      noPrice < 0.99 &&
      impliedProbability > 0.01 &&
      impliedProbability < 0.99
    );
  });
}

function applyInstructionsToMarkets(
  markets: Awaited<ReturnType<typeof fetchKalshiMarkets>>,
  activeInstructions: any[]
) {
  if (activeInstructions.length === 0) return markets;

  return markets.filter((market) => {
    for (const instruction of activeInstructions) {
      for (const rule of (instruction.rules ?? [])) {
        if (rule.ruleType === "exclude" || rule.ruleType === "forbid") {
          if (
            rule.ruleKey === "category" &&
            String(market.category ?? "").toLowerCase().includes(String(rule.ruleValue).toLowerCase())
          ) {
            return false;
          }
          if (
            rule.ruleKey === "title" &&
            String(market.title ?? "").toLowerCase().includes(String(rule.ruleValue).toLowerCase())
          ) {
            return false;
          }
        }
        if (rule.ruleType === "include" || rule.ruleType === "require") {
          if (rule.ruleKey === "category") {
            if (!String(market.category ?? "").toLowerCase().includes(String(rule.ruleValue).toLowerCase())) {
              return false;
            }
          }
        }
      }
    }
    return true;
  });
}

async function generateScheduledSignals(userId: number, minConfidence: number, activeInstructions: any[] = []) {
  const markets = await fetchKalshiMarkets({ status: "open" });
  const filteredMarkets = applyInstructionsToMarkets(markets, activeInstructions);
  const actionableMarkets = extractActionableMarkets(filteredMarkets).slice(0, MAX_SCHEDULED_MARKETS);

  if (actionableMarkets.length === 0) {
    return {
      actionableMarkets,
      savedSignals: [] as KalshiSignal[],
      executionCandidates: [] as Array<KalshiSignal & { executionScore: number }>,
    };
  }

  const feeds = new Map();
  for (const market of actionableMarkets) {
    const feed = getMarketFeed(market.id);
    if (feed) {
      feeds.set(market.id, feed);
    }
  }

  const sentimentContexts = new Map(
    actionableMarkets.map((market) => [
      market.id,
      {
        topic: market.title,
        marketSentiment: Math.max(-1, Math.min(1, (market.impliedProbability - 0.5) * 2)),
      },
    ])
  );

  const allSignals = await generateSignalsForMarkets(
    actionableMarkets,
    feeds,
    undefined,
    sentimentContexts
  );
  const confidenceFilteredSignals = filterSignalsByConfidence(allSignals, minConfidence);
  const conditionFilteredSignals = filterSignalsByMarketConditions(
    confidenceFilteredSignals,
    feeds,
    0.35
  );
  const instructionFilteredSignals = activeInstructions.length > 0
    ? applyInstructionsToSignals(conditionFilteredSignals, activeInstructions)
    : conditionFilteredSignals;

  // OpenAI acts as the final autonomous reviewer: vetoes weak candidates and
  // tweaks confidence/EV within tight bounds before any execution decision.
  const savedSignals = await reviewSignalsWithOpenAi({
    markets: actionableMarkets,
    signals: instructionFilteredSignals,
    maxSignals: 12,
  });

  await saveSignals(savedSignals, userId);

  return {
    actionableMarkets,
    savedSignals,
    executionCandidates: getTopSignalsForExecution(
      savedSignals,
      5,
      Math.max(0.6, minConfidence)
    ),
  };
}

async function shouldSkipScheduledRun(
  user: User,
  preferences: Awaited<ReturnType<typeof tradingPreferencesDb.getTradingPreferences>>
) {
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

  if (preferences.executionCadence === "hourly_watch") {
    const latestRun = await db.getLatestAuditEventByType(
      SCHEDULED_SCAN_EVENT,
      user.openId
    );

    if (latestRun?.createdAt) {
      const lastRunTime = new Date(latestRun.createdAt).getTime();
      if (Date.now() - lastRunTime < HOURLY_SCAN_MIN_INTERVAL_MS) {
        return "hourly review policy already ran recently";
      }
    }
  }

  const latestManualOrder = await db.getLatestAuditEventByType(
    "kalshi_order_placed",
    user.openId
  );

  if (latestManualOrder?.createdAt) {
    const latestManualOrderTime = new Date(latestManualOrder.createdAt).getTime();
    if (Date.now() - latestManualOrderTime < RECENT_MANUAL_ORDER_COOLDOWN_MS) {
      return "recent manual order detected; autonomy will wait for the next cycle";
    }
  }

  return null;
}

export type ScheduledAutonomyBatchSummary = {
  success: boolean;
  mode: "eligible_users_batch";
  triggeredByOpenId: string;
  eligibleUsers: number;
  processedUsers: number;
  executedUsers: number;
  blockedUsers: number;
  generatedOnlyUsers: number;
  skippedUsers: number;
  errorUsers: number;
  results: Array<{
    userId: number;
    openId: string;
    status: AwayTradingRunResult["status"];
    reason: string;
    orderPlaced: boolean;
    executedMarketId?: string;
    candidateMarketId?: string;
  }>;
};

export async function runScheduledAutonomousTrading(
  user: User
): Promise<AwayTradingRunResult> {
  const userId = assertPositiveIntegerUserId(user.id, "scheduled autonomy userId");
  const preferences = await tradingPreferencesDb.getTradingPreferences(userId);
  const finalize = (
    input: Omit<AwayTradingRunResult, "success"> & { success?: boolean }
  ) => persistScheduledResult(user, buildResult(input));
  const skipReason = await shouldSkipScheduledRun(user, preferences);

  if (skipReason) {
    return finalize({
      status: "skipped",
      reason: skipReason,
      signalsGenerated: 0,
      executionCandidates: 0,
      orderPlaced: false,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
    });
  }

  const creds = await kalshiCredDb.getKalshiCredentials(userId);
  if (!creds || creds.accountStatus !== "connected") {
    return finalize({
      status: "blocked",
      reason: "no connected live Kalshi account is available",
      signalsGenerated: 0,
      executionCandidates: 0,
      orderPlaced: false,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
    });
  }

  const equityResult = await fetchKalshiAccountEquity(creds.apiKey, creds.privateKey);
  if (equityResult.error) {
    return finalize({
      status: "error",
      reason: `live equity refresh failed: ${equityResult.error}`,
      signalsGenerated: 0,
      executionCandidates: 0,
      orderPlaced: false,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
    });
  }

  await Promise.all([
    kalshiCredDb.updateKalshiAccountEquity(userId, equityResult.equity),
    db.syncKalshiCapitalWithLiveEquity(equityResult.equity, userId),
  ]);

  const allInstructions = await getUserTrainingInstructions(userId);
  const activeInstructions = allInstructions.filter(isInstructionActiveNow);

  const { savedSignals, executionCandidates } = await generateScheduledSignals(
    userId,
    preferences.minSignalConfidence,
    activeInstructions
  );

  const topCandidate = executionCandidates[0] ?? null;

  await db.logAuditEvent(
    SCHEDULED_SCAN_EVENT,
    JSON.stringify({
      signalsGenerated: savedSignals.length,
      executionCandidates: executionCandidates.length,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
      riskPosture: preferences.riskPosture,
      activeInstructions: activeInstructions.length,
      decision: buildDecisionDetails(topCandidate),
    }),
    user.openId
  );

  if (executionCandidates.length === 0) {
    return finalize({
      status: "generated_only",
      reason: "no non-heuristic execution-ready signals were found",
      signalsGenerated: savedSignals.length,
      executionCandidates: 0,
      orderPlaced: false,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
    });
  }

  if (preferences.autonomyMode === "approval_required") {
    return finalize({
      status: "generated_only",
      reason: "approval-required mode never auto-submits away-from-chat orders",
      signalsGenerated: savedSignals.length,
      executionCandidates: executionCandidates.length,
      orderPlaced: false,
      candidateMarketId: executionCandidates[0]?.marketId,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
      decision: buildDecisionDetails(executionCandidates[0], {
        blockedBy: "approval_required_mode",
      }),
    });
  }

  const [capital, openPositions, todayRealizedLoss, riskLimits, todayOrderCount] =
    await Promise.all([
      db.getKalshiCapital(userId),
      db.getOpenKalshiPositions(userId),
      db.getTodayRealizedLoss(userId),
      getDynamicRiskLimits(preferences.riskPosture, userId),
      db.getTodayKalshiOrderCount(userId),
    ]);

  if (todayOrderCount >= preferences.maxDailyOrders) {
    return finalize({
      status: "blocked",
      reason: "daily order cap reached",
      signalsGenerated: savedSignals.length,
      executionCandidates: executionCandidates.length,
      orderPlaced: false,
      candidateMarketId: executionCandidates[0]?.marketId,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
      decision: buildDecisionDetails(executionCandidates[0], {
        blockedBy: "daily_order_cap",
      }),
    });
  }

  if (openPositions.length >= riskLimits.maxOpenPositions) {
    return finalize({
      status: "blocked",
      reason: "open position limit reached",
      signalsGenerated: savedSignals.length,
      executionCandidates: executionCandidates.length,
      orderPlaced: false,
      candidateMarketId: executionCandidates[0]?.marketId,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
      decision: buildDecisionDetails(executionCandidates[0], {
        blockedBy: "open_position_limit",
      }),
    });
  }

  const effectiveMinConfidence = Math.min(
    0.99,
    Math.max(0, preferences.minSignalConfidence + riskLimits.effectiveMinConfidence)
  );

  const eligibleSignal = executionCandidates.find((signal) => {
    const marketAlreadyOpen = openPositions.some(
      (position: any) => String(position.marketId) === signal.marketId
    );
    if (marketAlreadyOpen) {
      return false;
    }

    const maxBudget = Math.min(
      preferences.maxOrderNotional,
      riskLimits.maxPositionSize,
      riskLimits.maxLossPerTrade,
      Number(capital?.currentBalance ?? 0)
    );

    const marketPrice = Number(signal.marketPrice);
    if (!Number.isFinite(marketPrice) || maxBudget < marketPrice) {
      return false;
    }

    if (
      preferences.autonomyMode === "semi_autonomous" &&
      maxBudget > preferences.requireApprovalAbove
    ) {
      return false;
    }

    return signal.confidence >= effectiveMinConfidence;
  });

  if (!eligibleSignal) {
    return finalize({
      status: "generated_only",
      reason: "execution candidates exist, but none satisfy autonomy and exposure guardrails",
      signalsGenerated: savedSignals.length,
      executionCandidates: executionCandidates.length,
      orderPlaced: false,
      candidateMarketId: executionCandidates[0]?.marketId,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
      decision: buildDecisionDetails(executionCandidates[0], {
        blockedBy: "autonomy_or_exposure_guardrail",
      }),
    });
  }

  const availableCapital = Number(capital?.currentBalance ?? equityResult.equity ?? 0);
  const maxBudget = Math.min(
    preferences.maxOrderNotional,
    riskLimits.maxPositionSize,
    riskLimits.maxLossPerTrade,
    availableCapital
  );
  const limitPrice = Number(eligibleSignal.marketPrice);
  const quantity = estimateContractsForRiskBudget(maxBudget, limitPrice);

  if (quantity < 1) {
    return finalize({
      status: "blocked",
      reason: "candidate price is above the allowed risk budget",
      signalsGenerated: savedSignals.length,
      executionCandidates: executionCandidates.length,
      orderPlaced: false,
      candidateMarketId: eligibleSignal.marketId,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
      decision: buildDecisionDetails(eligibleSignal, {
        quantity,
        availableCapital,
        maxBudget,
        orderExposure: 0,
        maxLossOnTrade: 0,
        blockedBy: "risk_budget_below_one_contract",
      }),
    });
  }

  const orderRisk = calculateKalshiBuyOrderRisk({ quantity, limitPrice });
  const orderExposure = orderRisk.orderExposure;
  const maxLossOnTrade = orderRisk.maxLossOnTrade;

  if (maxLossOnTrade > riskLimits.maxLossPerTrade) {
    return finalize({
      status: "blocked",
      reason: "candidate exceeds per-trade risk limit",
      signalsGenerated: savedSignals.length,
      executionCandidates: executionCandidates.length,
      orderPlaced: false,
      candidateMarketId: eligibleSignal.marketId,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
      decision: buildDecisionDetails(eligibleSignal, {
        quantity,
        availableCapital,
        maxBudget,
        orderExposure,
        maxLossOnTrade,
        blockedBy: "per_trade_risk_limit",
      }),
    });
  }

  if (todayRealizedLoss >= riskLimits.maxLossPerDay) {
    return finalize({
      status: "blocked",
      reason: "daily loss limit reached",
      signalsGenerated: savedSignals.length,
      executionCandidates: executionCandidates.length,
      orderPlaced: false,
      candidateMarketId: eligibleSignal.marketId,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
      decision: buildDecisionDetails(eligibleSignal, {
        quantity,
        availableCapital,
        maxBudget,
        orderExposure,
        maxLossOnTrade,
        blockedBy: "daily_loss_limit",
      }),
    });
  }

  if (availableCapital < orderExposure) {
    return finalize({
      status: "blocked",
      reason: "available capital is below the required order exposure",
      signalsGenerated: savedSignals.length,
      executionCandidates: executionCandidates.length,
      orderPlaced: false,
      candidateMarketId: eligibleSignal.marketId,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
      decision: buildDecisionDetails(eligibleSignal, {
        quantity,
        availableCapital,
        maxBudget,
        orderExposure,
        maxLossOnTrade,
        blockedBy: "available_capital",
      }),
    });
  }

  const result = await placeKalshiOrder(
    userId,
    eligibleSignal.marketId,
    eligibleSignal.side,
    orderRisk.quantity,
    orderRisk.limitPrice
  );

  if (!result.success) {
    await db.logAuditEvent(
      "scheduled_autonomy_order_blocked_or_failed",
      JSON.stringify({
        marketId: eligibleSignal.marketId,
        side: eligibleSignal.side,
        quantity,
        limitPrice,
        confidence: eligibleSignal.confidence,
        executionScore: eligibleSignal.executionScore,
        expectedValue: eligibleSignal.expectedValue,
        reasoning: eligibleSignal.reasoning,
        availableCapital,
        maxBudget,
        orderExposure,
        maxLossOnTrade,
        reason: result.error ?? "unknown",
      }),
      user.openId
    );

    return finalize({
      status: "blocked",
      reason: result.error ?? "order placement failed",
      signalsGenerated: savedSignals.length,
      executionCandidates: executionCandidates.length,
      orderPlaced: false,
      candidateMarketId: eligibleSignal.marketId,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
      decision: buildDecisionDetails(eligibleSignal, {
        quantity,
        availableCapital,
        maxBudget,
        orderExposure,
        maxLossOnTrade,
        blockedBy: "exchange_rejected_or_failed",
      }),
    });
  }

  await db.logAuditEvent(
    "scheduled_autonomy_order_placed",
    JSON.stringify({
      marketId: eligibleSignal.marketId,
      side: eligibleSignal.side,
      quantity,
      limitPrice,
      confidence: eligibleSignal.confidence,
      executionScore: eligibleSignal.executionScore,
      expectedValue: eligibleSignal.expectedValue,
      reasoning: eligibleSignal.reasoning,
      availableCapital,
      maxBudget,
      orderExposure,
      maxLossOnTrade,
    }),
    user.openId
  );

  return finalize({
    status: "executed",
    reason: "scheduled autonomy found an eligible non-heuristic signal and placed a live order",
    signalsGenerated: savedSignals.length,
    executionCandidates: executionCandidates.length,
    orderPlaced: true,
    orderId: result.orderId,
    executedMarketId: eligibleSignal.marketId,
    candidateMarketId: eligibleSignal.marketId,
    autonomyMode: preferences.autonomyMode,
    executionCadence: preferences.executionCadence,
    decision: buildDecisionDetails(eligibleSignal, {
      quantity,
      availableCapital,
      maxBudget,
      orderExposure,
      maxLossOnTrade,
    }),
  });
}

export async function runScheduledAutonomousTradingBatch(
  users: User[],
  triggeredByOpenId: string,
  runOne: (user: User) => Promise<AwayTradingRunResult> = runScheduledAutonomousTrading
): Promise<ScheduledAutonomyBatchSummary> {
  const results: ScheduledAutonomyBatchSummary["results"] = [];

  for (const user of users) {
    const result = await runOne(user);
    results.push({
      userId: user.id,
      openId: user.openId,
      status: result.status,
      reason: result.reason,
      orderPlaced: result.orderPlaced,
      executedMarketId: result.executedMarketId,
      candidateMarketId: result.candidateMarketId,
    });
  }

  return {
    success: true,
    mode: "eligible_users_batch",
    triggeredByOpenId,
    eligibleUsers: users.length,
    processedUsers: results.length,
    executedUsers: results.filter((result) => result.status === "executed").length,
    blockedUsers: results.filter((result) => result.status === "blocked").length,
    generatedOnlyUsers: results.filter((result) => result.status === "generated_only").length,
    skippedUsers: results.filter((result) => result.status === "skipped").length,
    errorUsers: results.filter((result) => result.status === "error").length,
    results,
  };
}
