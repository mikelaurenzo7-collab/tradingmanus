import type { User } from "../../drizzle/schema";
import * as db from "../db";
import * as kalshiCredDb from "../db.kalshi-credentials";
import * as tradingPreferencesDb from "../db.trading-preferences";
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

const BASE_RISK_LIMITS = {
  maxLossPerTrade: 5,
  maxLossPerDay: 10,
  maxPositionSize: 20,
  maxOpenPositions: 5,
} as const;

const SCHEDULED_SCAN_EVENT = "scheduled_autonomy_scan_completed";
const HOURLY_SCAN_MIN_INTERVAL_MS = 55 * 60 * 1000;
const MAX_SCHEDULED_MARKETS = 24;

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
};

function clampRiskLimit(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

async function getDynamicRiskLimits() {
  const capital = await db.getKalshiCapital();
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
    };
  }

  return {
    maxCapital,
    maxLossPerTrade: clampRiskLimit(maxCapital * 0.05, 1, BASE_RISK_LIMITS.maxLossPerTrade),
    maxLossPerDay: clampRiskLimit(maxCapital * 0.1, 2, BASE_RISK_LIMITS.maxLossPerDay),
    maxPositionSize: clampRiskLimit(maxCapital * 0.2, 2, BASE_RISK_LIMITS.maxPositionSize),
    maxOpenPositions: BASE_RISK_LIMITS.maxOpenPositions,
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
    }),
    user.openId
  );

  return result;
}

function estimateOrderQuantity(maxBudget: number) {
  return Math.max(1, Math.floor(maxBudget));
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

async function generateScheduledSignals(minConfidence: number) {
  const markets = await fetchKalshiMarkets({ status: "open" });
  const actionableMarkets = extractActionableMarkets(markets).slice(0, MAX_SCHEDULED_MARKETS);

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
  const savedSignals = filterSignalsByMarketConditions(
    confidenceFilteredSignals,
    feeds,
    0.35
  );

  await saveSignals(savedSignals);

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

  return null;
}

export async function runScheduledAutonomousTrading(
  user: User
): Promise<AwayTradingRunResult> {
  const userId = user.id || 1;
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
    db.syncKalshiCapitalWithLiveEquity(equityResult.equity),
  ]);

  const { savedSignals, executionCandidates } = await generateScheduledSignals(
    preferences.minSignalConfidence
  );

  await db.logAuditEvent(
    SCHEDULED_SCAN_EVENT,
    JSON.stringify({
      signalsGenerated: savedSignals.length,
      executionCandidates: executionCandidates.length,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
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
    });
  }

  const [capital, openPositions, todayRealizedLoss, riskLimits, todayOrderCount] =
    await Promise.all([
      db.getKalshiCapital(),
      db.getOpenKalshiPositions(),
      db.getTodayRealizedLoss(),
      getDynamicRiskLimits(),
      db.getTodayKalshiOrderCount(),
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
    });
  }

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

    if (maxBudget < 1) {
      return false;
    }

    if (
      preferences.autonomyMode === "semi_autonomous" &&
      maxBudget > preferences.requireApprovalAbove
    ) {
      return false;
    }

    return signal.confidence >= preferences.minSignalConfidence;
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
    });
  }

  const availableCapital = Number(capital?.currentBalance ?? equityResult.equity ?? 0);
  const maxBudget = Math.min(
    preferences.maxOrderNotional,
    riskLimits.maxPositionSize,
    riskLimits.maxLossPerTrade,
    availableCapital
  );
  const quantity = estimateOrderQuantity(maxBudget);
  const limitPrice = Number(eligibleSignal.marketPrice);
  const orderExposure = Math.max(quantity * limitPrice, quantity * (1 - limitPrice));
  const maxLossOnTrade = Math.min(orderExposure, quantity * (1 - limitPrice));

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
    });
  }

  const result = await placeKalshiOrder(
    userId,
    eligibleSignal.marketId,
    eligibleSignal.side,
    quantity,
    limitPrice
  );

  if (!result.success) {
    await db.logAuditEvent(
      "scheduled_autonomy_order_blocked_or_failed",
      JSON.stringify({
        marketId: eligibleSignal.marketId,
        side: eligibleSignal.side,
        quantity,
        limitPrice,
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
  });
}
