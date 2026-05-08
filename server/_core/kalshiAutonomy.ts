import type { User } from "../../drizzle/schema";
import { nanoid } from "nanoid";
import * as db from "../db";
import * as kalshiCredDb from "../db.kalshi-credentials";
import * as tradingPreferencesDb from "../db.trading-preferences";
import type { RiskPosture } from "../db.trading-preferences";
import { getUserTrainingInstructions, isInstructionActiveNow, applyInstructionsToSignals } from "../db.training";
import { fetchKalshiMarkets, fetchKalshiMarketDetails } from "./kalshiMarketData";
import { fetchKalshiAccountEquity } from "./kalshiAuth";
import { getMarketFeed, isMarketDataStale } from "./kalshiMarketFeed";
import {
  filterSignalsByConfidence,
  filterSignalsByMarketConditions,
  generateSignalsForMarkets,
  getTopSignalsForExecution,
  saveSignals,
  computeKellyFraction,
  type KalshiSignal,
} from "./kalshiSignals";
import {
  buildKalshiPlatformBehaviorSnapshot,
  getPerformanceOverview,
} from "./kalshiLearning";
import { placeKalshiOrder } from "./kalshiExecution";
import { syncPendingOrders } from "./kalshiOrderSync";
import {
  applyMarketImpactGuardrails,
  calculateKalshiBuyOrderRisk,
  estimateContractsForRiskBudget,
} from "./kalshiRisk";
import { calculateKelly, applyKellyToPositionSize } from "./kellyCriterion";
import { assertPositiveIntegerUserId } from "./userScope";
import { withUserLock } from "./userMutex";
import { reviewSignalsWithTrader } from "./tradingReviewer";
import { getCacheHitRatio, newReviewerTelemetry } from "./aiToolbelt";
import { createOrderSyncLock } from "./distributedLock";
import { getEffectivePaperTradeMode } from "./effectivePaperMode";
import {
  shouldReviewMarketAt,
  recordMarketReview,
  getAdaptiveCadenceTelemetry,
} from "./adaptiveCadence";
import { classifyMarketCategory } from "./marketCategoryRouter";
import { getDeskWeights, getCategoryWeight } from "./deskAttention";
import { getCategoryPersona } from "./categoryPersonas";
import {
  alertIfConsecutiveFailures,
  alertEquityDrop,
  alertExchangeRejection,
  alertAiReviewerFailure,
  alertDrawdownApproaching,
} from "./alerting";
import { logger } from "./logger";
import { ENV } from "./env";

const BASE_RISK_LIMITS = {
  maxLossPerTrade: 5,
  maxLossPerDay: 10,
  maxPositionSize: 20,
  maxOpenPositions: 5,
} as const;

const SCHEDULED_SCAN_EVENT = "scheduled_autonomy_scan_completed";
const HOURLY_SCAN_MIN_INTERVAL_MS = 55 * 60 * 1000;
const RECENT_MANUAL_ORDER_COOLDOWN_MS = 5 * 60 * 1000;
// Dedup window — was 15 min, which meant a single failed run would freeze
// the dashboard's "last run" status for up to 15 min before a new tick
// could fire and overwrite it.  At a 60s cadence that was 14 silent
// "skipped" ticks per failed run.  1 min matches the cadence so every
// scheduler tick produces a fresh autonomy_runs row.
const AUTONOMY_RUN_DEDUPLICATION_WINDOW_MS = 60 * 1000;
const MARKET_DATA_STALE_AFTER_MS = 30 * 1000;
// Maximum allowed price drift between signal generation and order
// submission.  Markets quoted on Kalshi are in cents, so 2¢ is a
// reasonable tolerance — anything beyond that means the signal's
// pricing thesis no longer holds.
const MAX_EXECUTION_PRICE_DRIFT = 0.02;
// Maximum open positions allowed in the same market category at once.
// Prevents the portfolio from stacking correlated directional bets
// (e.g., five consecutive crypto positions) which amplify category risk.
const MAX_OPEN_POSITIONS_PER_CATEGORY = 2;
// Total market pool scanned per scheduled run — larger pool improves diversity
// and gives the AI reviewer more high-quality candidates to choose from.
const MAX_SCHEDULED_MARKETS = 48;
// Maximum markets sampled from any single category to prevent category
// concentration bias (e.g., not all 48 slots going to sports).
const MAX_MARKETS_PER_CATEGORY = 8;
// Markets with combined yes+no volume below this threshold are excluded from
// scheduled scans.  Thin markets have wide spreads and high adverse selection.
const MIN_SCHEDULED_MARKET_VOLUME = 500;
// Moonshot Mode tier — a separate, smaller-bankroll sleeve for low-probability
// asymmetric plays.  When a signal targets a market whose price sits in the
// moonshot band, the autonomy run replaces Kelly-sized notional with a fixed
// per-trade cap and refuses new moonshots if the open moonshot exposure
// already meets MOONSHOT_MAX_TOTAL_USD.
const MOONSHOT_PRICE_MIN = 0.02; // 2¢
const MOONSHOT_PRICE_MAX = 0.20; // 20¢ (or symmetrically 80¢..98¢ on the no side)
const MOONSHOT_MIN_VOLUME = 100;
const MOONSHOT_MAX_NOTIONAL = 5;       // $ per moonshot trade
const MOONSHOT_MAX_TOTAL_USD = 25;     // total open moonshot exposure cap
const MOONSHOT_MAX_OPEN_COUNT = 5;     // hard cap on open moonshot positions

/** Returns true if the side's price sits in the moonshot band on either side. */
export function isMoonshotPrice(price: number): boolean {
  if (!Number.isFinite(price)) return false;
  return (
    (price >= MOONSHOT_PRICE_MIN && price <= MOONSHOT_PRICE_MAX) ||
    (price >= 1 - MOONSHOT_PRICE_MAX && price <= 1 - MOONSHOT_PRICE_MIN)
  );
}
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

export function extractActionableMarkets(
  markets: Awaited<ReturnType<typeof fetchKalshiMarkets>>,
  options: { moonshotMode?: boolean } = {},
) {
  const minResolutionTime = Date.now() + MIN_RESOLUTION_HOURS_AHEAD * 60 * 60 * 1000;
  // Moonshot Mode loosens the actionable filter so the bot can also see
  // 2-20¢ longshots and 80-98¢ shortshots; the position-sizing path uses
  // the fixed MOONSHOT_MAX_NOTIONAL so the loosened filter cannot blow up
  // notional risk.  Without moonshot mode the prior tight bounds apply.
  const minPrice = options.moonshotMode ? MOONSHOT_PRICE_MIN : 0.01;
  const maxPrice = options.moonshotMode ? 1 - MOONSHOT_PRICE_MIN : 0.99;
  const minVol = options.moonshotMode ? MOONSHOT_MIN_VOLUME : MIN_SCHEDULED_MARKET_VOLUME;

  return markets.filter((market) => {
    const yesPrice = Number(market.yesPrice);
    const noPrice = Number(market.noPrice);
    const impliedProbability = Number(market.impliedProbability);

    if (
      !Number.isFinite(yesPrice) ||
      !Number.isFinite(noPrice) ||
      !Number.isFinite(impliedProbability) ||
      yesPrice <= minPrice ||
      yesPrice >= maxPrice ||
      noPrice <= minPrice ||
      noPrice >= maxPrice ||
      impliedProbability <= minPrice ||
      impliedProbability >= maxPrice
    ) {
      return false;
    }

    // Exclude thin markets that cannot be executed without heavy adverse selection.
    if (getMarketTotalVolume(market) < minVol) {
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

async function generateScheduledSignals(
  userId: number,
  minConfidence: number,
  activeInstructions: any[] = [],
  options: { ownerMode?: boolean; moonshotMode?: boolean } = {},
) {
  const markets = await fetchKalshiMarkets({ status: "open" });
  const filteredMarkets = applyInstructionsToMarkets(markets, activeInstructions);
  const actionableMarkets = selectDiverseMarkets(
    extractActionableMarkets(filteredMarkets, { moonshotMode: options.moonshotMode }),
    MAX_SCHEDULED_MARKETS,
    MAX_MARKETS_PER_CATEGORY
  );

  if (actionableMarkets.length === 0) {
    return {
      actionableMarkets,
      savedSignals: [] as KalshiSignal[],
      executionCandidates: [] as Array<KalshiSignal & { executionScore: number }>,
      reviewerTelemetry: null as ReturnType<typeof newReviewerTelemetry> | null,
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

  let platformPerformance:
    | ReturnType<typeof buildKalshiPlatformBehaviorSnapshot>
    | undefined;
  const canLoadPerformanceSnapshot =
    Object.prototype.hasOwnProperty.call(db, "getKalshiTradeHistory") &&
    Object.prototype.hasOwnProperty.call(db, "getRecentSignals") &&
    Object.prototype.hasOwnProperty.call(db, "getOpenKalshiPositions") &&
    Object.prototype.hasOwnProperty.call(db, "getKalshiCapital");

  if (canLoadPerformanceSnapshot) {
    try {
      const [performanceOverview, recentSignals] = await Promise.all([
        getPerformanceOverview(userId),
        db.getRecentSignals(600, userId),
      ]);
      platformPerformance = buildKalshiPlatformBehaviorSnapshot(
        performanceOverview.metrics,
        performanceOverview.signalPerformance,
        recentSignals as Array<{ metadata?: { marketCategory?: string | null } | null; expectedValue?: number | null }>
      );
    } catch (err) {
      logger.debug({ err, userId }, "Platform performance snapshot unavailable; continuing with baseline signal profile");
    }
  }

  const allSignals = await generateSignalsForMarkets(
    actionableMarkets,
    feeds,
    undefined,
    sentimentContexts,
    userId,
    undefined,
    platformPerformance
  );
  const confidenceFilteredSignals = filterSignalsByConfidence(allSignals, minConfidence);
  const conditionFilteredSignals = filterSignalsByMarketConditions(
    confidenceFilteredSignals,
    feeds,
    0.35
  );
  
  // Apply instruction filters and track match results for audit logging
  let instructionFilteredSignals = conditionFilteredSignals;
  if (activeInstructions.length > 0) {
    // Store original signal count before filtering
    const signalsBeforeInstructionFilter = [...conditionFilteredSignals];
    
    instructionFilteredSignals = applyInstructionsToSignals(
      conditionFilteredSignals,
      activeInstructions,
      {
        markets: actionableMarkets,
        bypassInstructions: false,
      }
    );

    // Build audit payload for instruction matches evaluation
    const instructionMatchesPayload = signalsBeforeInstructionFilter.map((signal) => {
      // Check if this signal passed filtering (match on marketId + signalType + side)
      const passed = instructionFilteredSignals.some(
        (s) => s.marketId === signal.marketId && s.signalType === signal.signalType && s.side === signal.side
      );
      
      return {
        marketId: signal.marketId,
        signalType: signal.signalType,
        side: signal.side,
        instructionMatches: signal.metadata?.instructionMatches,
        filterOutcome: passed ? "passed" : "rejected",
      };
    });

    // Log instruction match results for debugging and performance tracking
    await db.logAuditEvent(
      "instruction_matches_evaluated",
      JSON.stringify({
        totalSignalsEvaluated: signalsBeforeInstructionFilter.length,
        signalsPassed: instructionFilteredSignals.length,
        signalsRejected: signalsBeforeInstructionFilter.length - instructionFilteredSignals.length,
        activeInstructionCount: activeInstructions.length,
        signals: instructionMatchesPayload,
      }),
      `user:${userId}`,
    );
  }

  // Adaptive cadence: skip the AI reviewer for markets whose price hasn't
  // moved materially since their last review.  Caps AI cost so the operator
  // can run AUTONOMY_INTERVAL_MS at 60 s on a paid model without burning
  // through quota.  Markets that pass the gate are recorded *before* the
  // call so a thrown reviewer error doesn't leave them re-reviewable on
  // the next tick (the staleness TTL still guarantees a heartbeat).
  // Load per-desk attention weights from rolling win-rate (cached 5 min
  // per user).  Winning desks get tighter TTL → reviewed more often;
  // losing desks get looser TTL → reviewed less often.  Cold desks
  // (<10 trades) stay neutral.
  const deskWeights = await getDeskWeights(userId, "kalshi");

  const cadencePassed: typeof instructionFilteredSignals = [];
  const cadenceSkippedMarketIds: string[] = [];
  for (const signal of instructionFilteredSignals) {
    const market = actionableMarkets.find((m) => m.id === signal.marketId);
    const sidePrice = market
      ? Number(signal.side === "yes" ? market.yesPrice : market.noPrice)
      : NaN;
    // Per-category cadence + near-resolution acceleration + win-rate
    // attention weight.  See server/_core/adaptiveCadence.ts and
    // server/_core/deskAttention.ts.
    const category = market
      ? classifyMarketCategory({ category: market.category, title: market.title })
      : undefined;
    const hoursToResolution =
      market?.resolutionDate
        ? Math.max(0, (new Date(market.resolutionDate).getTime() - Date.now()) / (60 * 60 * 1000))
        : null;
    const deskId = category ? getCategoryPersona("kalshi", category).id : undefined;
    const deskWeight = deskId ? getCategoryWeight(deskWeights, deskId) : 1.0;
    if (
      shouldReviewMarketAt(signal.marketId, sidePrice, {
        category,
        hoursToResolution,
        deskWeight,
        ownerMode: options.ownerMode,
      })
    ) {
      cadencePassed.push(signal);
      if (Number.isFinite(sidePrice)) recordMarketReview(signal.marketId, sidePrice);
    } else {
      cadenceSkippedMarketIds.push(signal.marketId);
    }
  }
  if (cadenceSkippedMarketIds.length > 0) {
    await db.logAuditEvent(
      "kalshi_adaptive_cadence_skipped",
      JSON.stringify({
        skippedCount: cadenceSkippedMarketIds.length,
        passedCount: cadencePassed.length,
        markets: cadenceSkippedMarketIds.slice(0, 50),
        telemetry: getAdaptiveCadenceTelemetry(),
      }),
      `user:${userId}`,
    );
  }

  // Claude is the sole reviewer. Passing userId enables per-desk memory
  // injection — each desk loads its prior win/loss tape from the deskMemory
  // table before this call.  Telemetry captures cache hit rate, web_search
  // invocations, and triage stats for the audit log.
  const telemetry = newReviewerTelemetry();
  const savedSignals = await reviewSignalsWithTrader(
    {
      markets: actionableMarkets,
      signals: cadencePassed,
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
    }),
    `user:${userId}`,
  );

  await saveSignals(savedSignals, userId);

  // Emit a single structured audit event capturing every filter stage count.
  // This answers "why did we end up with N signals?" without requiring log
  // scraping — the full cascade is visible in the audit table.
  await db.logAuditEvent(
    "kalshi_signal_pipeline",
    JSON.stringify({
      marketsDiscovered: markets.length,
      marketsAfterInstructionFilter: filteredMarkets.length,
      actionableMarkets: actionableMarkets.length,
      signalsGenerated: allSignals.length,
      afterConfidenceFilter: confidenceFilteredSignals.length,
      afterConditionFilter: conditionFilteredSignals.length,
      afterInstructionFilter: instructionFilteredSignals.length,
      afterReviewerFilter: savedSignals.length,
      activeInstructionCount: activeInstructions.length,
      minConfidence,
    }),
    `user:${userId}`,
  );

  return {
    actionableMarkets,
    savedSignals,
    executionCandidates: getTopSignalsForExecution(
      savedSignals,
      5,
      Math.max(0.6, minConfidence)
    ),
    reviewerTelemetry: telemetry,
  };
}

function evaluateExecutionCandidate(
  signal: KalshiSignal & { executionScore?: number },
  input: {
    openPositions: any[];
    pendingOrderMarketIds: Set<string>;
    preferences: Awaited<ReturnType<typeof tradingPreferencesDb.getTradingPreferences>>;
    effectiveMinConfidence: number;
    maxBudget: number;
    /** Total available capital for Kelly sizing calculations */
    totalCapital: number;
    /** Map of open position marketId → category string for concentration checks */
    openPositionCategories?: Map<string, string>;
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

  // Reject if a pending order is already in flight for this market.
  // Without this check the autonomy scheduler can stack a second order
  // on top of an unfilled one between order-sync polls — the prior
  // double-fill race the operator flagged.
  if (input.pendingOrderMarketIds.has(signal.marketId)) {
    return {
      eligible: false as const,
      blockedBy: "pending_order_in_flight",
      reason: "an unfilled pending order already exists for this market",
    };
  }

  // Category concentration guard: prevent stacking too many correlated
  // positions from the same market category (e.g., multiple crypto markets).
  // Owner Mode bypasses this — the owner has explicitly opted out of the
  // correlation-protection hand-holding.
  const signalCategory = (signal.metadata?.marketCategory ?? "").toLowerCase();
  if (
    !input.preferences.ownerMode &&
    signalCategory &&
    signalCategory !== "unknown" &&
    input.openPositionCategories
  ) {
    let sameCategory = 0;
    for (const cat of Array.from(input.openPositionCategories.values())) {
      if (cat.toLowerCase() === signalCategory) sameCategory++;
    }
    if (sameCategory >= MAX_OPEN_POSITIONS_PER_CATEGORY) {
      return {
        eligible: false as const,
        blockedBy: "category_concentration_limit",
        reason: `already have ${sameCategory} open positions in category "${signalCategory}" (limit ${MAX_OPEN_POSITIONS_PER_CATEGORY})`,
      };
    }
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

  // Kelly criterion sizing — applied AFTER all risk guardrails pass.
  // Kelly can only reduce position size relative to the risk-checked budget.
  // marketPrice is already validated+declared above (the budget check used it).
  const netOdds = marketPrice > 0 && marketPrice < 1
    ? (1 - marketPrice) / marketPrice
    : 0;
  const kellyResult = calculateKelly({
    winProbability: signal.confidence,
    netOdds,
    totalCapital: input.totalCapital,
  });
  const kellyConstrainedBudget = applyKellyToPositionSize(input.maxBudget, kellyResult);
  const kellySuggestedSize = kellyResult.kellySuggestedSize;

  logger.debug(
    {
      marketId: signal.marketId,
      fullKelly: kellyResult.fullKellyFraction,
      fractionalKelly: kellyResult.fractionalKellyFraction,
      kellySize: kellySuggestedSize,
      maxBudget: input.maxBudget,
    },
    "Kelly position sizing",
  );

  return {
    eligible: true as const,
    blockedBy: null,
    reason: null,
    kellySuggestedSize,
    kellyConstrainedBudget,
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

  // Owner Mode bypasses the 5-min recent-manual-order cooldown.  The cooldown
  // exists to avoid stepping on a user who's actively clicking buy/sell in
  // the dashboard; an owner who flipped the master Owner Mode switch has
  // explicitly opted out of that hand-holding.
  if (!preferences.ownerMode) {
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
  if (!creds) {
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
  if ("needsReauth" in creds && creds.needsReauth) {
    logger.warn({ userId }, "[Autonomy] Skipping user %d: Kalshi credentials require re-authentication", userId);
    return finalize({
      status: "blocked",
      reason: "Kalshi credentials are invalid — re-authentication required. Please reconnect your Kalshi account.",
      signalsGenerated: 0,
      executionCandidates: 0,
      orderPlaced: false,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
    });
  }
  if (creds.accountStatus !== "connected") {
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

  // Alert when cumulative drawdown from the starting capital approaches or
  // exceeds the daily-loss limit.  We read the persisted capital record
  // immediately after syncing so we have the latest startingBalance.
  const capitalRecord = await db.getKalshiCapital(userId);
  if (capitalRecord) {
    const startingBalance = Number(capitalRecord.startingBalance ?? 0);
    void alertDrawdownApproaching(
      userId,
      startingBalance,
      equityResult.equity,
      BASE_RISK_LIMITS.maxLossPerDay
    );
  }

  const allInstructions = await getUserTrainingInstructions(userId);
  const activeInstructions = allInstructions.filter(isInstructionActiveNow);

  const { savedSignals, executionCandidates, reviewerTelemetry } = await generateScheduledSignals(
    userId,
    preferences.minSignalConfidence,
    activeInstructions,
    {
      ownerMode: preferences.ownerMode,
      // Moonshot only takes effect when ownerMode is also on — it's an
      // advanced sleeve, not a beginner toggle.
      moonshotMode: preferences.ownerMode && preferences.moonshotMode,
    },
  );
  const candidateSet = executionCandidates.map(summarizeCandidate);

  const topCandidate = executionCandidates[0] ?? null;

  // If the AI reviewer reported failures (timeouts, rate limits, parse
  // errors), surface that explicitly via audit log + alert so the operator
  // does not see a silent "0 orders" success.  Previously these failures
  // were swallowed inside reviewSignalsWithTrader which returned [] and
  // the run reported `generated_only` with no indication that Claude was
  // broken.
  const aiReviewerFailures = reviewerTelemetry?.anthropicFailures ?? 0;
  if (aiReviewerFailures > 0) {
    await db.logAuditEvent(
      "scheduled_autonomy_ai_reviewer_failure",
      JSON.stringify({
        runId,
        triggerSource,
        anthropicCalls: reviewerTelemetry?.anthropicCalls ?? 0,
        anthropicFailures: aiReviewerFailures,
        signalsApproved: savedSignals.length,
        signalsCandidate: executionCandidates.length,
      }),
      triggeredByOpenId
    );
    void alertAiReviewerFailure(userId, runId, {
      anthropicCalls: reviewerTelemetry?.anthropicCalls ?? 0,
      anthropicFailures: aiReviewerFailures,
      signalsApproved: savedSignals.length,
      signalsCandidate: executionCandidates.length,
    });
  }

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
      aiReviewerFailures,
      candidateSet,
      decision: buildDecisionDetails(topCandidate),
    }),
    triggeredByOpenId
  );

  if (executionCandidates.length === 0) {
    const reason = aiReviewerFailures > 0
      ? `AI reviewer encountered ${aiReviewerFailures} failure(s); no candidates approved`
      : "no non-heuristic execution-ready signals were found";
    return finalize({
      status: aiReviewerFailures > 0 ? "error" : "generated_only",
      reason,
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

  // Serialise the risk-check-and-execute block per user to prevent TOCTOU
  // races where two concurrent autonomy runs both pass risk checks against
  // stale capital/position state then both submit orders (silent overrun).
  return await withUserLock(userId, async () => {

  // Race protection: before we read open positions and pending orders,
  // run a best-effort sync of any in-flight fills the 30-second order-sync
  // may not yet have processed.  Without this an order placed on cycle N
  // may not appear in `openPositions` on cycle N+1 if the order-sync
  // hasn't run between the two — letting the autonomy scheduler stack a
  // second order on the same market.  syncPendingOrders is idempotent and
  // self-locking so concurrent invocation is safe.
  try {
    await syncPendingOrders(userId);
  } catch (syncErr) {
    logger.warn(
      { err: syncErr, userId },
      "[Autonomy] pre-execution order sync failed for user %d; proceeding with potentially stale ledger",
      userId,
    );
  }

  const [capital, openPositions, todayRealizedLoss, riskLimits, todayOrderCount, pendingOrders] =
    await Promise.all([
      db.getKalshiCapital(userId),
      db.getOpenKalshiPositions(userId),
      db.getTodayRealizedLoss(userId),
      getDynamicRiskLimits(preferences.riskPosture, userId),
      db.getTodayKalshiOrderCount(userId),
      db.getPendingKalshiOrders(userId),
    ]);

  const pendingOrderMarketIds = new Set<string>(
    (pendingOrders ?? []).map((order: any) => String(order.marketId)),
  );

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

  // Owner Mode skips the posture-driven confidence boost — under Owner Mode
  // the user's raw minSignalConfidence is the floor, period.  The posture
  // multipliers (conservative +0.08, aggressive -0.05) are paternal nudges
  // an owner who toggled the master switch has explicitly opted out of.
  const postureBoost = preferences.ownerMode ? 0 : riskLimits.effectiveMinConfidence;
  const effectiveMinConfidence = Math.min(
    0.99,
    Math.max(0, preferences.minSignalConfidence + postureBoost)
  );

  const rejectedCandidates: AwayTradingRejectedCandidate[] = [];
  let eligibleSignal: (KalshiSignal & { executionScore?: number }) | null = null;
  let eligibleMaxBudget: number | null = null;
  let eligibleKellySuggestedSize: number | null = null;

  // Build a category → count map from currently open positions so the
  // concentration guard can see how many same-category slots are taken.
  const openPositionCategories = new Map<string, string>();
  for (const pos of openPositions as any[]) {
    const mid = String(pos.marketId ?? "");
    const cat = String(pos.category ?? pos.marketCategory ?? "unknown").toLowerCase();
    if (mid) openPositionCategories.set(mid, cat);
  }

  for (const signal of executionCandidates) {
    // Kelly-adjusted budget: scale the raw max budget by the signal's
    // Kelly fraction so high-edge signals get proportionally more capital
    // and marginal signals are automatically sized smaller.
    const rawBudget = Math.min(
      preferences.maxOrderNotional,
      riskLimits.maxPositionSize,
      riskLimits.maxLossPerTrade,
      Number(capital?.currentBalance ?? 0)
    );
    const kellyFraction = signal.metadata?.kellyFraction
      ?? computeKellyFraction(signal.confidence, signal.marketPrice);
    const availableNow = Number(capital?.currentBalance ?? 0);
    // Kelly-sized budget: Kelly fraction × available capital, bounded by the raw cap.
    // A Kelly fraction of 0 means no edge; use at least 1¢ so budget checks
    // still fire the risk_budget_below_one_contract guard rather than silently
    // blocking with a misleading error.
    const kellyBudget = kellyFraction > 0
      ? Math.min(rawBudget, Math.max(0.01, availableNow * kellyFraction))
      : rawBudget;
    const maxBudget = kellyBudget;
    const evaluation = evaluateExecutionCandidate(signal, {
      openPositions,
      pendingOrderMarketIds,
      preferences,
      effectiveMinConfidence,
      maxBudget,
      totalCapital: availableNow,
      openPositionCategories,
    });

    if (evaluation.eligible && !eligibleSignal) {
      eligibleSignal = signal;
      eligibleMaxBudget = evaluation.kellyConstrainedBudget;
      eligibleKellySuggestedSize = evaluation.kellySuggestedSize;
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
  const limitPrice = Number(eligibleSignal.marketPrice);

  // Moonshot path: the candidate's price sits in the moonshot band AND the
  // user has both ownerMode + moonshotMode on.  Replace Kelly-sized notional
  // with the fixed MOONSHOT_MAX_NOTIONAL and refuse if the open moonshot
  // exposure has already hit the bucket cap.  Hard-bounds the downside on
  // the riskier sleeve.
  const moonshotEnabled = preferences.ownerMode && preferences.moonshotMode;
  const isMoonshotCandidate = moonshotEnabled && isMoonshotPrice(limitPrice);

  if (isMoonshotCandidate) {
    const moonshotPositions = (openPositions as Array<{ entryPrice?: number; quantity?: number }>).filter(
      (p) => isMoonshotPrice(Number(p.entryPrice ?? 0)),
    );
    const openMoonshotExposure = moonshotPositions.reduce(
      (sum, p) => sum + Number(p.entryPrice ?? 0) * Number(p.quantity ?? 0),
      0,
    );
    if (
      moonshotPositions.length >= MOONSHOT_MAX_OPEN_COUNT ||
      openMoonshotExposure >= MOONSHOT_MAX_TOTAL_USD
    ) {
      return finalize({
        status: "blocked",
        reason: `moonshot bucket full (${moonshotPositions.length} open, $${openMoonshotExposure.toFixed(2)} of $${MOONSHOT_MAX_TOTAL_USD})`,
        signalsGenerated: savedSignals.length,
        executionCandidates: executionCandidates.length,
        orderPlaced: false,
        candidateMarketId: eligibleSignal.marketId,
        autonomyMode: preferences.autonomyMode,
        executionCadence: preferences.executionCadence,
        candidateSet,
        rejectedCandidates,
        decision: buildDecisionDetails(eligibleSignal, {
          quantity: 0,
          availableCapital,
          maxBudget: 0,
          orderExposure: 0,
          maxLossOnTrade: 0,
          blockedBy: "moonshot_bucket_full",
        }),
      }, {
        appliedGuardrails: safeJsonStringify(buildAppliedGuardrails(preferences, riskLimits)),
      });
    }
    // Per-trade moonshot cap, also bounded by the remaining bucket headroom.
    const remainingBucket = Math.max(0, MOONSHOT_MAX_TOTAL_USD - openMoonshotExposure);
    eligibleMaxBudget = Math.min(MOONSHOT_MAX_NOTIONAL, remainingBucket);
  }

  const maxBudget = Math.min(eligibleMaxBudget ?? Number.POSITIVE_INFINITY, availableCapital);
  const requestedQuantity = estimateContractsForRiskBudget(maxBudget, limitPrice);

  if (requestedQuantity < 1) {
    return finalize({
      status: "blocked",
      reason: "the current budget cannot fund even one contract at this price",
      signalsGenerated: savedSignals.length,
      executionCandidates: executionCandidates.length,
      orderPlaced: false,
      candidateMarketId: eligibleSignal.marketId,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
      candidateSet,
      rejectedCandidates,
      decision: buildDecisionDetails(eligibleSignal, {
        quantity: 0,
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

  // Market-impact guardrail: downsize or block if expected slippage is excessive.
  // This runs before core risk checks so all downstream exposure checks use the
  // impact-adjusted quantity.
  const estimatedDailyVolumeUsd = Math.max(
    0,
    Number(eligibleSignal.metadata?.totalVolume ?? 0) * Math.max(limitPrice, 0.01),
  );
  const effectiveDailyVolumeUsd = estimatedDailyVolumeUsd > 0
    ? estimatedDailyVolumeUsd
    : Math.max(limitPrice * 500, 1);
  const impactGuardrail = applyMarketImpactGuardrails({
    quantity: requestedQuantity,
    limitPrice,
    side: eligibleSignal.side,
    dailyVolumeUsd: effectiveDailyVolumeUsd,
    dailyVolatility: Number(eligibleSignal.metadata?.volatility ?? Number.NaN),
    expectedValue: Number(eligibleSignal.expectedValue ?? 0),
  });
  const quantity = impactGuardrail.shouldBlockOrder
    ? 0
    : impactGuardrail.recommendedQuantity;

  if (quantity < 1) {
    await db.logAuditEvent(
      "scheduled_autonomy_order_blocked_market_impact",
      JSON.stringify({
        runId,
        marketId: eligibleSignal.marketId,
        side: eligibleSignal.side,
        requestedQuantity,
        impactAdjustedQuantity: quantity,
        estimatedMarketImpact: impactGuardrail.estimatedMarketImpact,
        impactBps: impactGuardrail.impactBps,
        expectedSlippageUsd: impactGuardrail.expectedSlippageUsd,
        reason: "market impact model blocked or reduced order below one contract",
      }),
      triggeredByOpenId,
    );

    return finalize({
      status: "blocked",
      reason: "candidate blocked by market impact guardrail",
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
        blockedBy: "market_impact_guardrail",
      }),
    }, {
      appliedGuardrails: safeJsonStringify(buildAppliedGuardrails(preferences, riskLimits)),
    });
  }

  if (quantity < requestedQuantity) {
    await db.logAuditEvent(
      "scheduled_autonomy_order_sized_by_market_impact",
      JSON.stringify({
        runId,
        marketId: eligibleSignal.marketId,
        side: eligibleSignal.side,
        requestedQuantity,
        impactAdjustedQuantity: quantity,
        estimatedMarketImpact: impactGuardrail.estimatedMarketImpact,
        impactBps: impactGuardrail.impactBps,
        expectedSlippageUsd: impactGuardrail.expectedSlippageUsd,
      }),
      triggeredByOpenId,
    );
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

  // Stale-data re-check: market data feeding `eligibleSignal` can be up
  // to 30 seconds old when signals are generated, plus reviewer latency.
  // Refetch the live market right before submitting and abort if the
  // price has drifted beyond the tolerance — submitting against stale
  // pricing leads to fills at materially worse levels than the signal's
  // thesis.
  try {
    const liveMarket = await fetchKalshiMarketDetails(eligibleSignal.marketId);
    if (liveMarket) {
      const livePrice = Number(
        eligibleSignal.side === "yes" ? liveMarket.yesPrice : liveMarket.noPrice,
      );
      if (
        Number.isFinite(livePrice) &&
        Math.abs(livePrice - orderRisk.limitPrice) > MAX_EXECUTION_PRICE_DRIFT
      ) {
        await db.logAuditEvent(
          "scheduled_autonomy_order_blocked_price_drift",
          JSON.stringify({
            runId,
            marketId: eligibleSignal.marketId,
            side: eligibleSignal.side,
            signalPrice: orderRisk.limitPrice,
            livePrice,
            drift: Number(Math.abs(livePrice - orderRisk.limitPrice).toFixed(4)),
            tolerance: MAX_EXECUTION_PRICE_DRIFT,
          }),
          triggeredByOpenId,
        );
        return finalize({
          status: "blocked",
          reason: `market price drifted from ${orderRisk.limitPrice.toFixed(2)} to ${livePrice.toFixed(2)} (>${MAX_EXECUTION_PRICE_DRIFT.toFixed(2)}) between signal and execution`,
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
            blockedBy: "stale_market_price_drift",
          }),
        }, {
          appliedGuardrails: safeJsonStringify(buildAppliedGuardrails(preferences, riskLimits)),
        });
      }
    }
  } catch (refreshErr) {
    // Best-effort refresh; if it fails, fall through to placement.
    // The lower-level execution path still has its own validation.
    logger.warn(
      { err: refreshErr, marketId: eligibleSignal.marketId },
      "[Autonomy] live price refresh failed for %s; proceeding with signal price",
      eligibleSignal.marketId,
    );
  }

  // Resolve once for both audit-event sites below — keeps userId out of
  // the audit-payload object literal and avoids a second DB read.
  const effectivePaperMode = await getEffectivePaperTradeMode(userId);

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
        requestedQuantity,
        limitPrice,
        confidence: eligibleSignal.confidence,
        executionScore: eligibleSignal.executionScore,
        expectedValue: eligibleSignal.expectedValue,
        estimatedMarketImpact: impactGuardrail.estimatedMarketImpact,
        impactBps: impactGuardrail.impactBps,
        expectedSlippageUsd: impactGuardrail.expectedSlippageUsd,
        reasoning: eligibleSignal.reasoning,
        availableCapital,
        maxBudget,
        orderExposure,
        maxLossOnTrade,
        reason: result.error ?? "unknown",
        exchangeRequest: result.exchangeRequest ?? null,
        exchangeResponse: result.exchangeResponse ?? null,
        simulated: effectivePaperMode,
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
      requestedQuantity,
      limitPrice,
      confidence: eligibleSignal.confidence,
      executionScore: eligibleSignal.executionScore,
      expectedValue: eligibleSignal.expectedValue,
      estimatedMarketImpact: impactGuardrail.estimatedMarketImpact,
      impactBps: impactGuardrail.impactBps,
      expectedSlippageUsd: impactGuardrail.expectedSlippageUsd,
      reasoning: eligibleSignal.reasoning,
      availableCapital,
      maxBudget,
      orderExposure,
      maxLossOnTrade,
      kellySuggestedSize: eligibleKellySuggestedSize ?? null,
      reconciliationStatus: result.needsReconciliation ? "pending" : "not_required",
      reconciliationReason: result.reconciliationReason ?? null,
      simulated: effectivePaperMode,
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

  }); // end withUserLock
}

export async function runScheduledAutonomousTradingBatch(
  users: User[],
  triggeredByOpenId: string,
  runOne: (user: User) => Promise<AwayTradingRunResult> = (user) =>
    runScheduledAutonomousTrading(user, { triggeredByOpenId })
): Promise<ScheduledAutonomyBatchSummary> {
  // Hard-fail in production when the AI reviewer key is missing.  The reviewer
  // is the gate that screens every heuristic signal before any live order is
  // placed; running the batch without it would silently downgrade safety to
  // raw heuristics.  We log a critical audit event so the operator sees this
  // in the audit feed even after the throw is caught upstream.
  if (ENV.isProduction && !ENV.anthropicApiKey) {
    try {
      await db.logAuditEvent(
        "scheduled_autonomy_run_aborted",
        JSON.stringify({
          reason: "ANTHROPIC_API_KEY_MISSING",
          triggeredByOpenId,
          eligibleUsers: users.length,
        }),
        triggeredByOpenId
      );
    } catch {
      // Audit-log failure must not mask the underlying configuration error.
    }
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. Refusing to run scheduled autonomous trading without the AI reviewer gate. " +
        "Set ANTHROPIC_API_KEY in the deployment environment and redeploy."
    );
  }

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
