import { eq } from "drizzle-orm";
import { tradingPreferences } from "../drizzle/schema";
import { getDb } from "./db";
import { logger } from "./_core/logger";

// Single-tenant simplification: removed `approval_required` and
// `semi_autonomous` from the surface — they were friction modes designed
// for hand-holding non-owner users, and the owner already has Aggressive
// Mode + manual as the meaningful axes.  Existing DB rows holding the
// removed values are coerced to `fully_autonomous` on read so behaviour
// is well-defined; the underlying Postgres enum still has the old
// labels for backward compat (PostgreSQL doesn't support DROP VALUE).
export const AUTONOMY_MODES = [
  "manual",
  "fully_autonomous",
] as const;

// Same simplification for executionCadence: `session_assisted` was an
// in-app-supervised mode that's pointless for an owner who isn't there
// most of the time.  Coerced to `continuous_watch` on read.
export const EXECUTION_CADENCES = [
  "manual_only",
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
  /**
   * When true, this user's orders are simulated even in fully_autonomous
   * mode.  Default false = live trading.  The env-level PAPER_TRADE_MODE
   * global override still wins when set.
   */
  paperTradeMode: boolean;
  /**
   * Aggressive Mode — single "training wheels off" toggle.  Bypasses the
   * 5-min recent-manual-order cooldown, the per-category concentration
   * cap, and the posture-driven confidence floor boost.  Tightens the
   * adaptive cadence ×0.5.  Hard safety gates (credentials, capital,
   * price drift, exchange rejection) remain unchanged.  Default true =
   * on for single-tenant.  (Was named ownerMode pre-migration 0010.)
   */
  aggressiveMode: boolean;
  /**
   * Moonshot Mode — only effective when aggressiveMode is also true.  Lets the
   * bot hunt low-probability asymmetric plays (2-20¢ / 80-98¢ markets).
   * Each moonshot trade is capped at MOONSHOT_MAX_NOTIONAL ($5) and total
   * open moonshot exposure is capped at MOONSHOT_MAX_TOTAL_USD ($25), so
   * a streak of bad moonshots can lose at most that bucket.
   */
  moonshotMode: boolean;
  executionCadence: ExecutionCadence;
  riskPosture: RiskPosture;
  minSignalConfidence: number;
  maxOrderNotional: number;
  maxDailyOrders: number;
  requireApprovalAbove: number;
};

export const DEFAULT_TRADING_PREFERENCES: TradingPreferencesSettings = {
  autonomyMode: "fully_autonomous",
  liveTradingEnabled: true,
  paperTradeMode: false,
  aggressiveMode: true,
  moonshotMode: true,
  executionCadence: "continuous_watch",
  riskPosture: "aggressive",
  // Per-user floor; the env-driven MIN_CONFIDENCE_AFTER_ADJUST is the
  // authoritative gate.  Keep this aligned so the dashboard preset never
  // bottlenecks the env aggressive preset (0.50).
  minSignalConfidence: 0.50,
  // Per-user notional cap; ENV-driven Kelly + MAX_RISK_PER_TRADE_PERCENT
  // are the authoritative sizing.  Set well above the env-derived per-trade
  // ceiling ($69 on a $459 account at 15% max risk) so it's never the
  // binding constraint.
  maxOrderNotional: 200,
  // Per-user daily order cap; aggressive preset targets 15-30 trades/day,
  // so 100 leaves headroom for spike days without ever bottlenecking.
  maxDailyOrders: 100,
  // Effectively never require manual approval — env aggressive preset
  // assumes fully-autonomous owner trading.
  requireApprovalAbove: 999,
};

/**
 * Permissive preset applied atomically when the user enables Aggressive Mode.
 * Sets autonomy/cadence/notional/daily-cap to their max-permissive values
 * so no follow-up tweaking is needed.  Pure function so callers (routers,
 * tests) can reuse without side effects.
 */
export function buildAggressiveModePresetOverrides(): Partial<TradingPreferencesSettings> {
  return {
    aggressiveMode: true,
    autonomyMode: "fully_autonomous",
    liveTradingEnabled: true,
    executionCadence: "continuous_watch",
    riskPosture: "aggressive",
    minSignalConfidence: 0.55,
    maxOrderNotional: 250,
    maxDailyOrders: 48,
    requireApprovalAbove: 250,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeTradingPreferences(
  input?: Partial<TradingPreferencesSettings> | null
): TradingPreferencesSettings {
  // Coerce removed legacy values to their replacement before validation.
  // Old DB rows or stale clients may still carry approval_required /
  // semi_autonomous / session_assisted; map them so behaviour is
  // well-defined.  approval_required and semi_autonomous both become
  // "manual" (safe default — user must re-arm explicitly via Aggressive
  // Mode rather than silently graduating to fully_autonomous).
  const rawMode = input?.autonomyMode as string | undefined;
  const coercedMode =
    rawMode === "approval_required" || rawMode === "semi_autonomous"
      ? "manual"
      : rawMode;
  const rawCadence = input?.executionCadence as string | undefined;
  const coercedCadence =
    rawCadence === "session_assisted" ? "continuous_watch" : rawCadence;

  const autonomyMode = AUTONOMY_MODES.includes(
    coercedMode as TradingAutonomyMode
  )
    ? (coercedMode as TradingAutonomyMode)
    : DEFAULT_TRADING_PREFERENCES.autonomyMode;

  const executionCadence = EXECUTION_CADENCES.includes(
    coercedCadence as ExecutionCadence
  )
    ? (coercedCadence as ExecutionCadence)
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
    paperTradeMode: Boolean(
      input?.paperTradeMode ?? DEFAULT_TRADING_PREFERENCES.paperTradeMode,
    ),
    aggressiveMode: Boolean(
      input?.aggressiveMode ?? DEFAULT_TRADING_PREFERENCES.aggressiveMode,
    ),
    moonshotMode: Boolean(
      input?.moonshotMode ?? DEFAULT_TRADING_PREFERENCES.moonshotMode,
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
    paperTradeMode: input.paperTradeMode ? 1 : 0,
    aggressiveMode: input.aggressiveMode ? 1 : 0,
    moonshotMode: input.moonshotMode ? 1 : 0,
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
      paperTradeMode: Boolean((record as { paperTradeMode?: number }).paperTradeMode ?? 0),
      aggressiveMode: Boolean(
        (record as { aggressiveMode?: number }).aggressiveMode ?? 1,
      ),
      moonshotMode: Boolean((record as { moonshotMode?: number }).moonshotMode ?? 0),
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
