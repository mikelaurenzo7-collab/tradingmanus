import type { User } from "../../drizzle/schema";
import { nanoid } from "nanoid";
import * as db from "../db";
import * as kalshiCredDb from "../db.kalshi-credentials";
import * as tradingPreferencesDb from "../db.trading-preferences";
import type { RiskPosture } from "../db.trading-preferences";
import { getUserTrainingInstructions, isInstructionActiveNow, applyInstructionsToSignals } from "../db.training";
import { fetchKalshiMarkets } from "./kalshiMarketData";
import { fetchKalshiAccountEquity } from "./kalshiAuth";
import { getMarketFeed, isMarketDataStale } from "./kalshiMarketFeed";
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
import { reviewSignalsWithTrader } from "./tradingReviewer";
import { getCacheHitRatio, newReviewerTelemetry } from "./aiToolbelt";
import {
  alertIfConsecutiveFailures,
  alertEquityDrop,
  alertExchangeRejection,
} from "./alerting";

const BASE_RISK_LIMITS = {
  maxLossPerTrade: 5,
  maxLossPerDay: 10,
  maxPositionSize: 20,
  maxOpenPositions: 5,
} as const;

const SCHEDULED_SCAN_EVENT = "scheduled_autonomy_scan_completed";
const HOURLY_SCAN_MIN_INTERVAL_MS = 55 * 60 * 1000;
const RECENT_MANUAL_ORDER_COOLDOWN_MS = 5 * 60 * 1000;
const AUTONOMY_RUN_DEDUPLICATION_WINDOW_MS = 15 * 60 * 1000;
const MARKET_DATA_STALE_AFTER_MS = 30 * 1000;
// Total market pool scanned per scheduled run — larger pool improves diversity
// and gives the AI reviewer more high-quality candidates to choose from.
const MAX_SCHEDULED_MARKETS = 48;
// Maximum markets sampled from any single category to prevent category
// concentration bias (e.g., not all 48 slots going to sports).
const MAX_MARKETS_PER_CATEGORY = 8;
// Markets with combined yes+no volume below this threshold are excluded from
// scheduled scans.  Thin markets have wide spreads and high adverse selection.
const MIN_SCHEDULED_MARKET_VOLUME = 500;
// Markets resolving within this many hours are excluded from scheduled scans.
// Imminent-resolution markets carry high adverse-selection risk and waste the
// AI reviewer's budget on signals that can rarely be executed cleanly.
const MIN_RESOLUTION_HOURS_AHEAD = 2;

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

export type AwayTradingCandidateSummary = {
  marketId: string;
  side: "yes" | "no";
  confidence: number;
  executionScore: number | null;
  expectedValue: number;
  limitPrice: number;
};

export type AwayTradingRejectedCandidate = AwayTradingCandidateSummary & {
  blockedBy: string;
  reason: string;
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
  runId?: string;
  triggerSource?: string;
  reconciliationStatus?: "not_required" | "pending" | "reconciled" | null;
  reconciliationReason?: string | null;
  decision?: AwayTradingDecisionDetails | null;
  candidateSet?: AwayTradingCandidateSummary[];
  rejectedCandidates?: AwayTradingRejectedCandidate[];
};

type ScheduledRunOptions = {
  triggeredByOpenId?: string;
  now?: Date;
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
    runId: input.runId,
    triggerSource: input.triggerSource,
    reconciliationStatus: input.reconciliationStatus ?? "not_required",
    reconciliationReason: input.reconciliationReason ?? null,
    decision: input.decision ?? null,
    candidateSet: input.candidateSet ?? [],
    rejectedCandidates: input.rejectedCandidates ?? [],
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

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(null);
  }
}

function buildTriggerSource(triggeredByOpenId: string) {
  if (triggeredByOpenId === "vercel_cron") return "vercel_cron";
  if (triggeredByOpenId === "local_scheduler") return "local_scheduler";
  return "authenticated_user";
}

function getRunBucketStart(now: Date) {
  const nowMs = now.getTime();
  const bucketMs = Math.floor(nowMs / AUTONOMY_RUN_DEDUPLICATION_WINDOW_MS) * AUTONOMY_RUN_DEDUPLICATION_WINDOW_MS;
  return new Date(bucketMs);
}

function buildRunKey(
  userId: number,
  triggeredByOpenId: string,
  executionCadence: string,
  now: Date
) {
  const bucket = getRunBucketStart(now).toISOString();
  // Format: scheduled:<userId>:<triggerSource>:<executionCadence>:<bucketStartIso>
  return `scheduled:${userId}:${buildTriggerSource(triggeredByOpenId)}:${executionCadence}:${bucket}`;
}

function summarizeCandidate(signal: KalshiSignal & { executionScore?: number }): AwayTradingCandidateSummary {
  return {
    marketId: signal.marketId,
    side: signal.side,
    confidence: signal.confidence,
    executionScore: signal.executionScore ?? null,
    expectedValue: signal.expectedValue,
    limitPrice: signal.marketPrice,
  };
}

function buildAppliedGuardrails(
  preferences: Awaited<ReturnType<typeof tradingPreferencesDb.getTradingPreferences>>,
  riskLimits?: Awaited<ReturnType<typeof getDynamicRiskLimits>>
) {
  return [
    { name: "live_trading_enabled", value: Boolean(preferences.liveTradingEnabled) },
    { name: "autonomy_mode", value: preferences.autonomyMode },
    { name: "execution_cadence", value: preferences.executionCadence },
    { name: "min_signal_confidence", value: preferences.minSignalConfidence },
    { name: "max_order_notional", value: preferences.maxOrderNotional },
    { name: "max_daily_orders", value: preferences.maxDailyOrders },
    { name: "require_approval_above", value: preferences.requireApprovalAbove },
    ...(riskLimits
      ? [
          { name: "dynamic_max_loss_per_trade", value: riskLimits.maxLossPerTrade },
          { name: "dynamic_max_loss_per_day", value: riskLimits.maxLossPerDay },
          { name: "dynamic_max_position_size", value: riskLimits.maxPositionSize },
          { name: "dynamic_max_open_positions", value: riskLimits.maxOpenPositions },
          { name: "effective_min_confidence_delta", value: riskLimits.effectiveMinConfidence },
        ]
      : []),
  ];
}

async function persistScheduledResult(
  user: User,
  result: AwayTradingRunResult,
  options: {
    runId?: string;
    userId: number;
    triggeredByOpenId: string;
    ledgerUpdates?: Record<string, unknown>;
  }
) {
  if (result.runId) {
    await db.updateAutonomyRun(result.runId, options.userId, {
      status: result.status,
      reason: result.reason,
      signalsGenerated: result.signalsGenerated,
      executionCandidates: result.executionCandidates,
      orderPlaced: result.orderPlaced ? 1 : 0,
      orderId: result.orderId ?? null,
      candidateMarketId: result.candidateMarketId ?? null,
      executedMarketId: result.executedMarketId ?? null,
      decision: safeJsonStringify(result.decision ?? null),
      candidateSet: safeJsonStringify(result.candidateSet ?? []),
      rejectedCandidates: safeJsonStringify(result.rejectedCandidates ?? []),
      reconciliationStatus: result.reconciliationStatus ?? "not_required",
      reconciliationReason: result.reconciliationReason ?? null,
      completedAt: new Date(),
      ...options.ledgerUpdates,
    });
  }

  await db.logAuditEvent(
    `scheduled_autonomy_run_${result.status}`,
    JSON.stringify({
      runId: result.runId ?? null,
      triggerSource: result.triggerSource ?? null,
      reason: result.reason,
      signalsGenerated: result.signalsGenerated,
      executionCandidates: result.executionCandidates,
      orderPlaced: result.orderPlaced,
      orderId: result.orderId ?? null,
      executedMarketId: result.executedMarketId ?? null,
      candidateMarketId: result.candidateMarketId ?? null,
      autonomyMode: result.autonomyMode ?? null,
      executionCadence: result.executionCadence ?? null,
      reconciliationStatus: result.reconciliationStatus ?? "not_required",
      reconciliationReason: result.reconciliationReason ?? null,
      candidateSet: result.candidateSet ?? [],
      rejectedCandidates: result.rejectedCandidates ?? [],
      decision: result.decision ?? null,
    }),
    options.triggeredByOpenId || user.openId
  );

  return result;
}

/** Sum of yes and no volume for a market-like object. */
function getMarketTotalVolume(market: { yesVolume?: unknown; noVolume?: unknown }): number {
  return Number(market.yesVolume ?? 0) + Number(market.noVolume ?? 0);
}

export function extractActionableMarkets(markets: Awaited<ReturnType<typeof fetchKalshiMarkets>>) {
  const minResolutionTime = Date.now() + MIN_RESOLUTION_HOURS_AHEAD * 60 * 60 * 1000;

  return markets.filter((market) => {
    const yesPrice = Number(market.yesPrice);
    const noPrice = Number(market.noPrice);
    const impliedProbability = Number(market.impliedProbability);

    if (
      !Number.isFinite(yesPrice) ||
      !Number.isFinite(noPrice) ||
      !Number.isFinite(impliedProbability) ||
      yesPrice <= 0.01 ||
      yesPrice >= 0.99 ||
      noPrice <= 0.01 ||
      noPrice >= 0.99 ||
      impliedProbability <= 0.01 ||
      impliedProbability >= 0.99
    ) {
      return false;
    }

    // Exclude thin markets that cannot be executed without heavy adverse selection.
    if (getMarketTotalVolume(market) < MIN_SCHEDULED_MARKET_VOLUME) {
      return false;
    }

    // Exclude markets resolving very soon or already past their resolution date.
    // These carry high adverse-selection risk and rarely convert to clean fills.
    if (market.resolutionDate) {
      const resolutionTime = new Date(market.resolutionDate).getTime();
      if (Number.isFinite(resolutionTime) && resolutionTime < minResolutionTime) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Select up to `maxTotal` markets with category diversity.
 * Markets are grouped by category; at most `perCategory` are kept from each
 * bucket so no single category monopolises the candidate pool.  Within each
 * bucket markets are sorted by total volume descending so the cap always
 * selects the most liquid options first.  Remaining slots are filled
 * round-robin across categories until `maxTotal` is reached.
 */
export function selectDiverseMarkets<T extends { category?: string | null }>(
  markets: T[],
  maxTotal: number,
  perCategory: number
): T[] {
  const buckets = new Map<string, T[]>();

  for (const market of markets) {
    const key = String(market.category ?? "other").toLowerCase();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(market);
  }

  // Sort within each bucket by total volume descending so the per-category cap
  // always picks the most actively-traded markets first.
  for (const [, bucket] of Array.from(buckets)) {
    bucket.sort((a: T, b: T) =>
      getMarketTotalVolume(b as { yesVolume?: unknown; noVolume?: unknown }) -
      getMarketTotalVolume(a as { yesVolume?: unknown; noVolume?: unknown })
    );
  }

  const selected: T[] = [];

  // First pass: take up to perCategory from each bucket.
  const queues: T[][] = [];
  for (const [, bucket] of Array.from(buckets)) {
    selected.push(...bucket.slice(0, perCategory));
    if (bucket.length > perCategory) {
      queues.push(bucket.slice(perCategory));
    }
  }

  // Second pass: fill remaining slots round-robin from overflow queues.
  let qi = 0;
  while (selected.length < maxTotal && queues.length > 0) {
    const idx = qi % queues.length;
    const queue = queues[idx];
    if (queue && queue.length > 0) {
      selected.push(queue.shift()!);
    } else {
      queues.splice(idx, 1);
    }
    qi++;
  }

  return selected.slice(0, maxTotal);
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
  const actionableMarkets = selectDiverseMarkets(
    extractActionableMarkets(filteredMarkets),
    MAX_SCHEDULED_MARKETS,
    MAX_MARKETS_PER_CATEGORY
  );

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

  // Claude is the primary reviewer (with optional OpenAI fallback /
  // high-stakes second opinion).  Passing userId enables per-desk memory
  // injection — each desk loads its prior win/loss tape from the deskMemory
  // table before this call.  Telemetry captures cache hit rate, web_search
  // invocations, and triage stats for the audit log.
  const telemetry = newReviewerTelemetry();
  const savedSignals = await reviewSignalsWithTrader(
    {
      markets: actionableMarkets,
      signals: instructionFilteredSignals,
      maxSignals: 12,
    },
    { userId, telemetry },
  );

  await db.logAuditEvent(
    "kalshi_reviewer_telemetry",
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
      openaiCalls: telemetry.openaiCalls,
      openaiFailures: telemetry.openaiFailures,
    }),
    `user:${userId}`,
  );

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

function evaluateExecutionCandidate(
  signal: KalshiSignal & { executionScore?: number },
  input: {
    openPositions: any[];
    preferences: Awaited<ReturnType<typeof tradingPreferencesDb.getTradingPreferences>>;
    effectiveMinConfidence: number;
    maxBudget: number;
  }
) {
  const marketAlreadyOpen = input.openPositions.some(
    (position: any) => String(position.marketId) === signal.marketId
  );
  if (marketAlreadyOpen) {
    return {
      eligible: false as const,
      blockedBy: "market_already_open",
      reason: "an open position already exists for this market",
    };
  }

  const feed = getMarketFeed(signal.marketId);
  if (feed && isMarketDataStale(feed, MARKET_DATA_STALE_AFTER_MS)) {
    return {
      eligible: false as const,
      blockedBy: "stale_market_data",
      reason: "market data is stale and must refresh before execution",
    };
  }

  const marketPrice = Number(signal.marketPrice);
  if (!Number.isFinite(marketPrice) || input.maxBudget < marketPrice) {
    return {
      eligible: false as const,
      blockedBy: "risk_budget_below_one_contract",
      reason: "the current budget cannot fund even one contract at this price",
    };
  }

  if (
    input.preferences.autonomyMode === "semi_autonomous" &&
    input.maxBudget > input.preferences.requireApprovalAbove
  ) {
    return {
      eligible: false as const,
      blockedBy: "approval_threshold_exceeded",
      reason: "semi-autonomous mode requires manual approval above the saved threshold",
    };
  }

  if (signal.confidence < input.effectiveMinConfidence) {
    return {
      eligible: false as const,
      blockedBy: "below_effective_min_confidence",
      reason: "confidence fell below the effective minimum after posture/risk adjustments",
    };
  }

  return {
    eligible: true as const,
    blockedBy: null,
    reason: null,
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
    const latestRun = await db.getLatestAutonomyRun(user.id);

    if (latestRun?.startedAt) {
      const lastRunTime = new Date(latestRun.startedAt).getTime();
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
  user: User,
  options: ScheduledRunOptions = {}
): Promise<AwayTradingRunResult> {
  const userId = assertPositiveIntegerUserId(user.id, "scheduled autonomy userId");
  const triggeredByOpenId = options.triggeredByOpenId ?? user.openId;
  const triggerSource = buildTriggerSource(triggeredByOpenId);
  const runId = nanoid(16);
  const preferences = await tradingPreferencesDb.getTradingPreferences(userId);
  const runRecord = await db.createAutonomyRun({
    runId,
    runKey: buildRunKey(userId, triggeredByOpenId, preferences.executionCadence, options.now ?? new Date()),
    userId,
    triggeredByOpenId,
    triggerSource,
    autonomyMode: preferences.autonomyMode,
    executionCadence: preferences.executionCadence,
    appliedGuardrails: safeJsonStringify(buildAppliedGuardrails(preferences)),
  });

  if (!runRecord) {
    return buildResult({
      status: "skipped",
      reason: "an autonomy run for this cycle is already in progress or completed",
      signalsGenerated: 0,
      executionCandidates: 0,
      orderPlaced: false,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
      triggerSource,
    });
  }

  const finalize = (
    input: Omit<AwayTradingRunResult, "success"> & { success?: boolean },
    ledgerUpdates: Record<string, unknown> = {}
  ) =>
    persistScheduledResult(
      user,
      buildResult({
        ...input,
        runId,
        triggerSource,
      }),
      {
        runId,
        userId,
        triggeredByOpenId,
        ledgerUpdates,
      }
    );
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

  // Alert if equity has dropped significantly since the last sync.
  const previousEquity = Number(creds.accountEquity ?? 0);
  if (previousEquity > 0) {
    void alertEquityDrop(userId, previousEquity, equityResult.equity);
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
  const candidateSet = executionCandidates.map(summarizeCandidate);

  const topCandidate = executionCandidates[0] ?? null;

  await db.logAuditEvent(
    SCHEDULED_SCAN_EVENT,
    JSON.stringify({
      runId,
      triggerSource,
      signalsGenerated: savedSignals.length,
      executionCandidates: executionCandidates.length,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
      riskPosture: preferences.riskPosture,
      activeInstructions: activeInstructions.length,
      candidateSet,
      decision: buildDecisionDetails(topCandidate),
    }),
    triggeredByOpenId
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
      candidateSet,
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
      candidateSet,
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
      candidateSet,
      decision: buildDecisionDetails(executionCandidates[0], {
        blockedBy: "daily_order_cap",
      }),
    }, {
      appliedGuardrails: safeJsonStringify(buildAppliedGuardrails(preferences, riskLimits)),
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
      candidateSet,
      decision: buildDecisionDetails(executionCandidates[0], {
        blockedBy: "open_position_limit",
      }),
    }, {
      appliedGuardrails: safeJsonStringify(buildAppliedGuardrails(preferences, riskLimits)),
    });
  }

  const effectiveMinConfidence = Math.min(
    0.99,
    Math.max(0, preferences.minSignalConfidence + riskLimits.effectiveMinConfidence)
  );

  const rejectedCandidates: AwayTradingRejectedCandidate[] = [];
  let eligibleSignal: (KalshiSignal & { executionScore?: number }) | null = null;
  let eligibleMaxBudget: number | null = null;

  for (const signal of executionCandidates) {
    const maxBudget = Math.min(
      preferences.maxOrderNotional,
      riskLimits.maxPositionSize,
      riskLimits.maxLossPerTrade,
      Number(capital?.currentBalance ?? 0)
    );
    const evaluation = evaluateExecutionCandidate(signal, {
      openPositions,
      preferences,
      effectiveMinConfidence,
      maxBudget,
    });

    if (evaluation.eligible && !eligibleSignal) {
      eligibleSignal = signal;
      eligibleMaxBudget = maxBudget;
      continue;
    }

    rejectedCandidates.push({
      ...summarizeCandidate(signal),
      blockedBy: evaluation.eligible ? "lower_ranked_candidate" : evaluation.blockedBy,
      reason: evaluation.eligible
        ? "a higher-ranked eligible candidate was selected first"
        : evaluation.reason,
    });
  }

  if (!eligibleSignal) {
    const primaryRejectedCandidate = rejectedCandidates[0] ?? null;
    return finalize({
      status: "generated_only",
      reason:
        primaryRejectedCandidate?.reason ??
        "execution candidates exist, but none satisfy autonomy and exposure guardrails",
      signalsGenerated: savedSignals.length,
      executionCandidates: executionCandidates.length,
      orderPlaced: false,
      candidateMarketId: executionCandidates[0]?.marketId,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
      candidateSet,
      rejectedCandidates,
      decision: buildDecisionDetails(executionCandidates[0], {
        blockedBy:
          primaryRejectedCandidate?.blockedBy ?? "autonomy_or_exposure_guardrail",
      }),
    }, {
      appliedGuardrails: safeJsonStringify(buildAppliedGuardrails(preferences, riskLimits)),
    });
  }

  const availableCapital = Number(capital?.currentBalance ?? equityResult.equity ?? 0);
  const maxBudget = Math.min(eligibleMaxBudget ?? Number.POSITIVE_INFINITY, availableCapital);
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
      candidateSet,
      rejectedCandidates,
      decision: buildDecisionDetails(eligibleSignal, {
        quantity,
        availableCapital,
        maxBudget,
        orderExposure: 0,
        maxLossOnTrade: 0,
        blockedBy: "risk_budget_below_one_contract",
      }),
    }, {
      appliedGuardrails: safeJsonStringify(buildAppliedGuardrails(preferences, riskLimits)),
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
      candidateSet,
      rejectedCandidates,
      decision: buildDecisionDetails(eligibleSignal, {
        quantity,
        availableCapital,
        maxBudget,
        orderExposure,
        maxLossOnTrade,
        blockedBy: "per_trade_risk_limit",
      }),
    }, {
      appliedGuardrails: safeJsonStringify(buildAppliedGuardrails(preferences, riskLimits)),
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
      candidateSet,
      rejectedCandidates,
      decision: buildDecisionDetails(eligibleSignal, {
        quantity,
        availableCapital,
        maxBudget,
        orderExposure,
        maxLossOnTrade,
        blockedBy: "daily_loss_limit",
      }),
    }, {
      appliedGuardrails: safeJsonStringify(buildAppliedGuardrails(preferences, riskLimits)),
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
      candidateSet,
      rejectedCandidates,
      decision: buildDecisionDetails(eligibleSignal, {
        quantity,
        availableCapital,
        maxBudget,
        orderExposure,
        maxLossOnTrade,
        blockedBy: "available_capital",
      }),
    }, {
      appliedGuardrails: safeJsonStringify(buildAppliedGuardrails(preferences, riskLimits)),
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
        runId,
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
        exchangeRequest: result.exchangeRequest ?? null,
        exchangeResponse: result.exchangeResponse ?? null,
      }),
      triggeredByOpenId
    );

    // Fire-and-forget alert for exchange rejections.
    void alertExchangeRejection(userId, runId, {
      marketId: eligibleSignal.marketId,
      side: eligibleSignal.side,
      quantity,
      limitPrice,
      error: result.error ?? "unknown",
    });

    return finalize({
      status: "blocked",
      reason: result.error ?? "order placement failed",
      signalsGenerated: savedSignals.length,
      executionCandidates: executionCandidates.length,
      orderPlaced: false,
      candidateMarketId: eligibleSignal.marketId,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
      candidateSet,
      rejectedCandidates,
      decision: buildDecisionDetails(eligibleSignal, {
        quantity,
        availableCapital,
        maxBudget,
        orderExposure,
        maxLossOnTrade,
        blockedBy: "exchange_rejected_or_failed",
      }),
    }, {
      appliedGuardrails: safeJsonStringify(buildAppliedGuardrails(preferences, riskLimits)),
      exchangeRequest: safeJsonStringify(result.exchangeRequest ?? null),
      exchangeResponse: safeJsonStringify(result.exchangeResponse ?? { error: result.error ?? "unknown" }),
    });
  }

  await db.logAuditEvent(
    "scheduled_autonomy_order_placed",
    JSON.stringify({
      runId,
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
      reconciliationStatus: result.needsReconciliation ? "pending" : "not_required",
      reconciliationReason: result.reconciliationReason ?? null,
    }),
    triggeredByOpenId
  );

  return finalize({
    status: "executed",
    reason: result.needsReconciliation
      ? "scheduled autonomy placed a live order, but the local order ledger still needs reconciliation"
      : "scheduled autonomy found an eligible non-heuristic signal and placed a live order",
    signalsGenerated: savedSignals.length,
    executionCandidates: executionCandidates.length,
    orderPlaced: true,
    orderId: result.orderId,
    executedMarketId: eligibleSignal.marketId,
    candidateMarketId: eligibleSignal.marketId,
    autonomyMode: preferences.autonomyMode,
    executionCadence: preferences.executionCadence,
    reconciliationStatus: result.needsReconciliation ? "pending" : "not_required",
    reconciliationReason: result.reconciliationReason ?? null,
    candidateSet,
    rejectedCandidates,
    decision: buildDecisionDetails(eligibleSignal, {
      quantity,
      availableCapital,
      maxBudget,
      orderExposure,
      maxLossOnTrade,
    }),
  }, {
    appliedGuardrails: safeJsonStringify(buildAppliedGuardrails(preferences, riskLimits)),
    exchangeRequest: safeJsonStringify(result.exchangeRequest ?? null),
    exchangeResponse: safeJsonStringify(result.exchangeResponse ?? null),
  });
}

export async function runScheduledAutonomousTradingBatch(
  users: User[],
  triggeredByOpenId: string,
  runOne: (user: User) => Promise<AwayTradingRunResult> = (user) =>
    runScheduledAutonomousTrading(user, { triggeredByOpenId })
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

    // Alert if consecutive errors have accumulated for this user.
    if (result.status === "error") {
      try {
        const recentRuns = await db.getRecentAutonomyRuns(user.id, 6);
        void alertIfConsecutiveFailures(
          user.id,
          recentRuns.map((r: any) => ({ status: String(r.status), runId: r.runId ?? undefined }))
        );
      } catch {
        // Never block the batch for alerting failures.
      }
    }
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
