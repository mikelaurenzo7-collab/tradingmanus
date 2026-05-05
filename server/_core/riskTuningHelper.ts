import { eq, desc } from "drizzle-orm";
import { getDb, logAuditEvent } from "../db";
import {
  autonomyRuns,
  kalshiCapital,
  auditLog,
} from "../../drizzle/schema";
import { logger } from "./logger";

/**
 * Risk parameters that users can tune to control position sizing,
 * daily loss limits, and capital allocation.
 */
export interface RiskParameters {
  /** Percentage of account balance per position (0.5-5%) */
  maxPositionSizePercent: number;
  /** Maximum daily loss as % of account (2-10%) */
  maxDailyLossPercent: number;
  /** Maximum number of concurrent open positions (1-20) */
  maxOpenPositions: number;
  /** Minimum capital held in reserve (5-20%) */
  minCapitalReservePercent: number;
}

export interface ParameterValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export interface ImpactEstimate {
  wouldHaveBlocked: number;
  wouldHaveExecuted: number;
  accountAtRisk: number;
  recommendation: string;
}

/**
 * Default risk parameters (conservative baseline)
 */
export const DEFAULT_RISK_PARAMETERS: RiskParameters = {
  maxPositionSizePercent: 1.0,
  maxDailyLossPercent: 5.0,
  maxOpenPositions: 5,
  minCapitalReservePercent: 10.0,
};

/**
 * Validate risk parameters against business rules.
 * Does not block invalid params — only returns warnings/errors for user consideration.
 */
export async function validateRiskParameters(
  params: Partial<RiskParameters>,
): Promise<ParameterValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const {
    maxPositionSizePercent = DEFAULT_RISK_PARAMETERS.maxPositionSizePercent,
    maxDailyLossPercent = DEFAULT_RISK_PARAMETERS.maxDailyLossPercent,
    maxOpenPositions = DEFAULT_RISK_PARAMETERS.maxOpenPositions,
    minCapitalReservePercent = DEFAULT_RISK_PARAMETERS.minCapitalReservePercent,
  } = params;

  // Validate maxPositionSizePercent
  if (maxPositionSizePercent < 0.5 || maxPositionSizePercent > 5.0) {
    errors.push("maxPositionSizePercent must be between 0.5% and 5%");
  }
  if (maxPositionSizePercent >= 2.0) {
    warnings.push(
      `Very aggressive position sizing: ${maxPositionSizePercent}% per position`,
    );
  }

  // Validate maxDailyLossPercent
  if (maxDailyLossPercent < 2.0 || maxDailyLossPercent > 10.0) {
    errors.push("maxDailyLossPercent must be between 2% and 10%");
  }
  if (maxDailyLossPercent <= 3.0) {
    warnings.push(
      `Conservative daily loss limit: ${maxDailyLossPercent}% may trigger stops quickly`,
    );
  }

  // Validate maxOpenPositions
  if (!Number.isInteger(maxOpenPositions) || maxOpenPositions < 1 || maxOpenPositions > 20) {
    errors.push("maxOpenPositions must be an integer between 1 and 20");
  }
  if (maxOpenPositions >= 15) {
    warnings.push(`High max open positions: ${maxOpenPositions} may fragment risk`);
  }

  // Validate minCapitalReservePercent
  if (minCapitalReservePercent < 5.0 || minCapitalReservePercent > 20.0) {
    errors.push("minCapitalReservePercent must be between 5% and 20%");
  }
  if (minCapitalReservePercent <= 5.0) {
    warnings.push(`Low capital reserve: ${minCapitalReservePercent}% offers little margin`);
  }

  // Cross-parameter checks
  const totalAllocation = 100 - minCapitalReservePercent;
  const maxMultiPositionAllocation = maxPositionSizePercent * maxOpenPositions;
  if (maxMultiPositionAllocation > totalAllocation) {
    warnings.push(
      `Position sizing could exceed available capital: ` +
        `${maxOpenPositions} × ${maxPositionSizePercent}% = ${maxMultiPositionAllocation}% ` +
        `vs ${totalAllocation}% available`,
    );
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Estimate impact of new risk parameters on recent autonomy runs.
 * Re-checks each run against the new parameters to estimate blocking.
 */
export async function estimateImpactOnRecentRuns(
  userId: number,
  newParams: RiskParameters,
): Promise<ImpactEstimate> {
  const database = await getDb();
  if (!database) {
    return {
      wouldHaveBlocked: 0,
      wouldHaveExecuted: 0,
      accountAtRisk: 0,
      recommendation: "Database unavailable for impact estimation",
    };
  }

  try {
    // Fetch current capital balance
    const kapitalResult = await database
      .select()
      .from(kalshiCapital)
      .where(eq(kalshiCapital.userId, userId))
      .limit(1);

    const currentBalance = kapitalResult?.[0]?.currentBalance ?? 10000;

    // Fetch recent autonomy runs (last 20)
    const recentRuns = await database
      .select()
      .from(autonomyRuns)
      .where(eq(autonomyRuns.userId, userId))
      .orderBy(desc(autonomyRuns.startedAt))
      .limit(20);

    let wouldHaveBlocked = 0;
    let wouldHaveExecuted = 0;

    for (const run of recentRuns) {
      // Only check runs that reached execution stage
      if (run.orderPlaced === 0 && run.executionCandidates === 0) {
        continue;
      }

      // Simulate risk checks under new parameters
      const maxPositionSize = (currentBalance * newParams.maxPositionSizePercent) / 100;
      const maxDailyLoss = (currentBalance * newParams.maxDailyLossPercent) / 100;
      const minReserve = (currentBalance * newParams.minCapitalReservePercent) / 100;

      // Parse execution metadata if available
      let candidateSet: any[] = [];
      if (run.candidateSet) {
        try {
          candidateSet = JSON.parse(run.candidateSet);
        } catch {
          // Unparseable; treat as empty
        }
      }

      // Estimate if this run would have been blocked
      // Block reasons: insufficient reserve, position too large, exceeds daily loss limit
      const insufficientReserve = currentBalance - maxPositionSize < minReserve;
      const positionTooLarge =
        candidateSet.length > 0 &&
        (candidateSet[0]?.maxLoss || 0) > maxPositionSize;
      const exceedsDailyLoss = (run.appliedGuardrails || "").includes("daily_loss");

      if (insufficientReserve || positionTooLarge || exceedsDailyLoss) {
        wouldHaveBlocked++;
      } else {
        wouldHaveExecuted++;
      }
    }

    const accountAtRisk =
      (currentBalance * newParams.maxPositionSizePercent) / 100;

    // Generate recommendation based on ratio
    let recommendation = "Parameters look reasonable";
    if (wouldHaveBlocked === 0 && wouldHaveExecuted > 0) {
      recommendation = "Very permissive: no recent runs would have been blocked";
    } else if (wouldHaveBlocked > wouldHaveExecuted) {
      recommendation =
        "Very restrictive: most recent signals would have been blocked";
    } else if (wouldHaveBlocked > 0) {
      recommendation = `Moderate: would have blocked ~${Math.round((wouldHaveBlocked / (wouldHaveBlocked + wouldHaveExecuted)) * 100)}% of recent executions`;
    }

    return {
      wouldHaveBlocked,
      wouldHaveExecuted,
      accountAtRisk,
      recommendation,
    };
  } catch (error) {
    logger.error(
      { err: error },
      "[riskTuningHelper] Failed to estimate impact on recent runs",
    );
    return {
      wouldHaveBlocked: 0,
      wouldHaveExecuted: 0,
      accountAtRisk: 0,
      recommendation: "Error estimating impact",
    };
  }
}

/**
 * Apply validated risk parameters to the user's account.
 * Stores in a JSON column (as extension to tradingPreferences) and logs audit event.
 */
export async function applyRiskParameters(
  userId: number,
  platform: "kalshi" | "polymarket",
  newParams: RiskParameters,
  triggeredByOpenId: string,
): Promise<void> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not initialized");
  }

  try {
    // Validate first
    const validation = await validateRiskParameters(newParams);
    if (!validation.valid) {
      throw new Error(
        `Invalid risk parameters: ${validation.errors.join(", ")}`,
      );
    }

    // Log audit event with the new parameters
    await logAuditEvent(
      `${platform}_risk_parameters_updated`,
      JSON.stringify({
        newParams,
        timestamp: new Date().toISOString(),
      }),
      triggeredByOpenId,
      "risk_parameters",
      userId,
    );
  } catch (error) {
    logger.error(
      { err: error, userId, platform },
      "[riskTuningHelper] Failed to apply risk parameters",
    );
    throw error;
  }
}

/**
 * Fetch the risk parameter history for a user from the audit log.
 * Returns the last N parameter change events across both platforms.
 */
export async function getRiskParameterHistory(
  userId: number,
  limit: number = 20,
): Promise<
  Array<{
    timestamp: string;
    platform: string;
    params: RiskParameters;
    eventId: number;
  }>
> {
  const database = await getDb();
  if (!database) {
    return [];
  }

  try {
    // Import db functions dynamically to avoid circular dependency
    const { getUserById } = await import("../db");

    const user = await getUserById(userId);
    if (!user) {
      logger.warn({ userId }, "[riskTuningHelper] User not found for parameter history");
      return [];
    }

    // Query audit log filtered by this user's openId
    const events = await database
      .select()
      .from(auditLog)
      .where(eq(auditLog.triggeredByOpenId, user.openId))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit * 2); // Fetch more to filter

    const parameterEvents = events
      .filter(
        (e: typeof events[number]) =>
          e.eventType === "kalshi_risk_parameters_updated" ||
          e.eventType === "polymarket_risk_parameters_updated",
      )
      .slice(0, limit)
      .map((e: typeof events[number]) => {
        try {
          const payload = JSON.parse(e.details || "{}");
          return {
            timestamp: e.createdAt?.toISOString() ?? new Date().toISOString(),
            platform: e.eventType.split("_")[0],
            params: payload.newParams || DEFAULT_RISK_PARAMETERS,
            eventId: e.id,
          };
        } catch {
          return null;
        }
      })
      .filter((e: any): e is NonNullable<typeof e> => e !== null);

    return parameterEvents;
  } catch (error) {
    logger.error(
      { err: error, userId },
      "[riskTuningHelper] Failed to fetch parameter history",
    );
    return [];
  }
}
