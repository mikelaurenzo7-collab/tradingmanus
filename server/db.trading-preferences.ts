import { eq } from "drizzle-orm";
import { tradingPreferences } from "../drizzle/schema";
import { getDb } from "./db";
import { logger } from "./_core/logger";

export const AUTONOMY_MODES = [
  "manual",
  "approval_required",
  "semi_autonomous",
  "fully_autonomous",
] as const;

export const EXECUTION_CADENCES = [
  "manual_only",
  "session_assisted",
  "hourly_watch",
  "continuous_watch",
] as const;

export const RISK_POSTURES = [
  "conservative",
  "balanced",
  "aggressive",
] as const;

export type TradingAutonomyMode = (typeof AUTONOMY_MODES)[number];
export type ExecutionCadence = (typeof EXECUTION_CADENCES)[number];
export type RiskPosture = (typeof RISK_POSTURES)[number];

export type TradingPreferencesSettings = {
  autonomyMode: TradingAutonomyMode;
  liveTradingEnabled: boolean;
  executionCadence: ExecutionCadence;
  riskPosture: RiskPosture;
  minSignalConfidence: number;
  maxOrderNotional: number;
  maxDailyOrders: number;
  requireApprovalAbove: number;
};

export const DEFAULT_TRADING_PREFERENCES: TradingPreferencesSettings = {
  autonomyMode: "approval_required",
  liveTradingEnabled: false,
  executionCadence: "manual_only",
  riskPosture: "balanced",
  minSignalConfidence: 0.72,
  maxOrderNotional: 10,
  maxDailyOrders: 3,
  requireApprovalAbove: 8,
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeTradingPreferences(
  input?: Partial<TradingPreferencesSettings> | null
): TradingPreferencesSettings {
  const autonomyMode = AUTONOMY_MODES.includes(
    input?.autonomyMode as TradingAutonomyMode
  )
    ? (input?.autonomyMode as TradingAutonomyMode)
    : DEFAULT_TRADING_PREFERENCES.autonomyMode;

  const executionCadence = EXECUTION_CADENCES.includes(
    input?.executionCadence as ExecutionCadence
  )
    ? (input?.executionCadence as ExecutionCadence)
    : DEFAULT_TRADING_PREFERENCES.executionCadence;

  const riskPosture = RISK_POSTURES.includes(
    input?.riskPosture as RiskPosture
  )
    ? (input?.riskPosture as RiskPosture)
    : DEFAULT_TRADING_PREFERENCES.riskPosture;

  const maxOrderNotional = clamp(
    Number(input?.maxOrderNotional ?? DEFAULT_TRADING_PREFERENCES.maxOrderNotional),
    1,
    250
  );

  const requireApprovalAbove = clamp(
    Number(
      input?.requireApprovalAbove ??
        DEFAULT_TRADING_PREFERENCES.requireApprovalAbove
    ),
    1,
    500
  );

  const normalized: TradingPreferencesSettings = {
    autonomyMode,
    liveTradingEnabled:
      autonomyMode === "manual"
        ? false
        : Boolean(
            input?.liveTradingEnabled ??
              DEFAULT_TRADING_PREFERENCES.liveTradingEnabled
          ),
    executionCadence,
    riskPosture,
    minSignalConfidence: clamp(
      Number(
        input?.minSignalConfidence ??
          DEFAULT_TRADING_PREFERENCES.minSignalConfidence
      ),
      0.5,
      0.99
    ),
    maxOrderNotional,
    maxDailyOrders: Math.round(
      clamp(
        Number(input?.maxDailyOrders ?? DEFAULT_TRADING_PREFERENCES.maxDailyOrders),
        1,
        48
      )
    ),
    requireApprovalAbove,
  };

  if (normalized.autonomyMode === "manual") {
    normalized.liveTradingEnabled = false;
  }

  return normalized;
}

function toDatabaseValues(input: TradingPreferencesSettings) {
  return {
    autonomyMode: input.autonomyMode,
    liveTradingEnabled: input.liveTradingEnabled ? 1 : 0,
    executionCadence: input.executionCadence,
    riskPosture: input.riskPosture,
    minSignalConfidence: input.minSignalConfidence,
    maxOrderNotional: input.maxOrderNotional,
    maxDailyOrders: input.maxDailyOrders,
    requireApprovalAbove: input.requireApprovalAbove,
  };
}

export async function getTradingPreferences(userId: number) {
  const database = await getDb();
  if (!database) {
    return DEFAULT_TRADING_PREFERENCES;
  }

  try {
    const result = await database
      .select()
      .from(tradingPreferences)
      .where(eq(tradingPreferences.userId, userId))
      .limit(1);

    if (!result || result.length === 0) {
      return DEFAULT_TRADING_PREFERENCES;
    }

    const record = result[0];
    return normalizeTradingPreferences({
      autonomyMode: record.autonomyMode,
      liveTradingEnabled: Boolean(record.liveTradingEnabled),
      executionCadence: record.executionCadence,
      riskPosture: record.riskPosture,
      minSignalConfidence: record.minSignalConfidence,
      maxOrderNotional: record.maxOrderNotional,
      maxDailyOrders: record.maxDailyOrders,
      requireApprovalAbove: record.requireApprovalAbove,
    });
  } catch (error) {
    logger.error({ err: error }, "[Database] Get trading preferences failed");
    return DEFAULT_TRADING_PREFERENCES;
  }
}

export async function saveTradingPreferences(
  userId: number,
  input: Partial<TradingPreferencesSettings>
) {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not initialized");
  }

  const existing = await getTradingPreferences(userId);
  const merged = normalizeTradingPreferences({
    ...existing,
    ...input,
  });

  try {
    await database
      .insert(tradingPreferences)
      .values({
        userId,
        ...toDatabaseValues(merged),
      })
      .onConflictDoUpdate({
        target: tradingPreferences.userId,
        set: toDatabaseValues(merged),
      });

    return merged;
  } catch (error) {
    logger.error({ err: error }, "[Database] Save trading preferences failed");
    throw error;
  }
}
