import {
  trainingInstructions,
  instructionRules,
  instructionSchedules,
  instructionHistory,
} from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { getDb } from "./db";
import { logger } from "./_core/logger";

export interface InstructionMatch {
  instructionId: number;
  instructionTitle: string;
  passed: boolean;
  failedRules?: Array<{ ruleId: number; ruleKey: string; ruleType: string; reason: string }>;
}

export interface ApplyInstructionsOptions {
  /** Map of marketId -> market object, used for keyword matching and market-level checks */
  markets?: Map<string, any> | any[];
  /** If true, skip all instruction filtering (emergency override) */
  bypassInstructions?: boolean;
  /** If true, log detailed instruction match results to console */
  verbose?: boolean;
}

/**
 * Create a new training instruction
 */
export async function createTrainingInstruction(payload: {
  userId: number;
  title: string;
  description?: string;
  instructionType: "market_filter" | "signal_filter" | "position_limit" | "time_window" | "custom";
  priority?: number;
}) {
  const database = await getDb();
  if (!database) throw new Error("Database not initialized");

  try {
    const [created] = await database
      .insert(trainingInstructions)
      .values({
        userId: payload.userId,
        title: payload.title,
        description: payload.description,
        instructionType: payload.instructionType,
        priority: payload.priority || 0,
        isActive: 1,
      })
      .returning({ id: trainingInstructions.id });

    return { success: true, instructionId: created?.id };
  } catch (error) {
    logger.error({ err: error }, "[Database] Create training instruction failed");
    throw error;
  }
}

/**
 * Get all training instructions for a user
 */
export async function getUserTrainingInstructions(userId: number) {
  const database = await getDb();
  if (!database) return [];

  try {
    const instructions = await database
      .select()
      .from(trainingInstructions)
      .where(eq(trainingInstructions.userId, userId));

    // Fetch rules and schedules for each instruction
    const enriched = await Promise.all(
      instructions.map(async (instr: any) => {
        const rules = await database
          .select()
          .from(instructionRules)
          .where(eq(instructionRules.instructionId, instr.id));

        const schedules = await database
          .select()
          .from(instructionSchedules)
          .where(eq(instructionSchedules.instructionId, instr.id));

        return {
          ...instr,
          rules,
          schedules,
        };
      })
    );

    return enriched;
  } catch (error) {
    logger.error({ err: error }, "[Database] Get training instructions failed");
    return [];
  }
}

/**
 * Add a rule to an instruction
 */
export async function addInstructionRule(payload: {
  instructionId: number;
  ruleType: "include" | "exclude" | "require" | "forbid";
  ruleKey: string;
  ruleValue: string;
}) {
  const database = await getDb();
  if (!database) throw new Error("Database not initialized");

  try {
    await database.insert(instructionRules).values({
      instructionId: payload.instructionId,
      ruleType: payload.ruleType,
      ruleKey: payload.ruleKey,
      ruleValue: payload.ruleValue,
    });

    return { success: true };
  } catch (error) {
    logger.error({ err: error }, "[Database] Add instruction rule failed");
    throw error;
  }
}

/**
 * Add a schedule to an instruction
 */
export async function addInstructionSchedule(payload: {
  instructionId: number;
  scheduleType: "always" | "time_window" | "day_of_week" | "market_condition";
  startTime?: string;
  endTime?: string;
  daysOfWeek?: string;
  timezone?: string;
}) {
  const database = await getDb();
  if (!database) throw new Error("Database not initialized");

  try {
    await database.insert(instructionSchedules).values({
      instructionId: payload.instructionId,
      scheduleType: payload.scheduleType,
      startTime: payload.startTime,
      endTime: payload.endTime,
      daysOfWeek: payload.daysOfWeek,
      timezone: payload.timezone || "UTC",
    });

    return { success: true };
  } catch (error) {
    logger.error({ err: error }, "[Database] Add instruction schedule failed");
    throw error;
  }
}

/**
 * Update instruction active status
 */
export async function updateInstructionStatus(instructionId: number, isActive: boolean) {
  const database = await getDb();
  if (!database) throw new Error("Database not initialized");

  try {
    await database
      .update(trainingInstructions)
      .set({ isActive: isActive ? 1 : 0 })
      .where(eq(trainingInstructions.id, instructionId));

    return { success: true };
  } catch (error) {
    logger.error({ err: error }, "[Database] Update instruction status failed");
    throw error;
  }
}

/**
 * Delete an instruction and all related rules/schedules
 */
export async function deleteTrainingInstruction(instructionId: number, userId: string) {
  const database = await getDb();
  if (!database) throw new Error("Database not initialized");

  try {
    // Get current state for history
    const instruction = await database
      .select()
      .from(trainingInstructions)
      .where(eq(trainingInstructions.id, instructionId))
      .limit(1);

    if (instruction.length > 0) {
      // Record in history
      await database.insert(instructionHistory).values({
        instructionId,
        version: 1,
        previousState: JSON.stringify(instruction[0]),
        changeReason: "Instruction deleted",
        changedBy: userId,
      });
    }

    // Delete related records
    await database.delete(instructionRules).where(eq(instructionRules.instructionId, instructionId));
    await database.delete(instructionSchedules).where(eq(instructionSchedules.instructionId, instructionId));
    await database.delete(trainingInstructions).where(eq(trainingInstructions.id, instructionId));

    return { success: true };
  } catch (error) {
    logger.error({ err: error }, "[Database] Delete training instruction failed");
    throw error;
  }
}

/**
 * Delete a rule
 */
export async function deleteInstructionRule(ruleId: number) {
  const database = await getDb();
  if (!database) throw new Error("Database not initialized");
  await database.delete(instructionRules).where(eq(instructionRules.id, ruleId));
  return { success: true };
}

/**
 * Delete a schedule
 */
export async function deleteInstructionSchedule(scheduleId: number) {
  const database = await getDb();
  if (!database) throw new Error("Database not initialized");
  await database.delete(instructionSchedules).where(eq(instructionSchedules.id, scheduleId));
  return { success: true };
}

/**
 * Check if instruction is active at current time
 */
export function isInstructionActiveNow(instruction: any): boolean {
  if (instruction.isActive === 0) return false;

  const schedules = instruction.schedules || [];
  if (schedules.length === 0) return true; // No schedule = always active

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTime = `${String(currentHour).padStart(2, "0")}:${String(currentMinute).padStart(2, "0")}`;
  const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.

  return schedules.some((schedule: any) => {
    if (schedule.scheduleType === "always") return true;

    if (schedule.scheduleType === "time_window") {
      if (!schedule.startTime || !schedule.endTime) return false;
      return currentTime >= schedule.startTime && currentTime <= schedule.endTime;
    }

    if (schedule.scheduleType === "day_of_week") {
      if (!schedule.daysOfWeek) return false;
      const days = schedule.daysOfWeek.split(",").map((d: string) => parseInt(d));
      return days.includes(currentDay);
    }

    return false;
  });
}

/**
 * Apply instructions to filter signals
 * 
 * Supports 6 rule types via ruleKey:
 * - must_have_keyword: market title must contain keyword (case-insensitive)
 * - must_not_have_keyword: market title must NOT contain keyword (case-insensitive)
 * - min_volume: signal total volume must be >= threshold
 * - max_price: signal market price must be <= threshold
 * - category_whitelist: signal category must be in comma-separated list
 * - category_blacklist: signal category must NOT be in comma-separated list
 * 
 * Legacy support for:
 * - category (ruleType=exclude/require): category matching
 * - signalType (ruleType=exclude): signal type filtering
 * - minConfidence (ruleType=require): confidence threshold
 * - side (ruleType=forbid): side filtering
 */
export function applyInstructionsToSignals(
  signals: any[],
  instructions: any[],
  options?: {
    markets?: Map<string, any> | any[];
    bypassInstructions?: boolean;
  }
): any[] {
  // Handle bypass flag
  if (options?.bypassInstructions) {
    logger.info("[Training] Instruction filtering bypassed via bypassInstructions flag");
    return signals;
  }

  const activeInstructions = instructions.filter(isInstructionActiveNow);

  if (activeInstructions.length === 0) {
    return signals;
  }

  // Convert markets array to Map for efficient lookup
  const marketsMap =
    options?.markets instanceof Map
      ? options.markets
      : options?.markets
      ? new Map((options.markets as any[]).map((m) => [m.id, m]))
      : new Map();

  return signals.filter((signal) => {
    for (const instruction of activeInstructions) {
      const rules = instruction.rules || [];

      for (const rule of rules) {
        // Check new rule types
        if (rule.ruleKey === "must_have_keyword") {
          const market = marketsMap.get(signal.marketId);
          if (market?.title) {
            const title = String(market.title).toLowerCase();
            const keyword = String(rule.ruleValue).toLowerCase();
            if (!title.includes(keyword)) {
              return false;
            }
          } else {
            return false; // No title available
          }
        }

        if (rule.ruleKey === "must_not_have_keyword") {
          const market = marketsMap.get(signal.marketId);
          if (market?.title) {
            const title = String(market.title).toLowerCase();
            const keyword = String(rule.ruleValue).toLowerCase();
            if (title.includes(keyword)) {
              return false;
            }
          }
        }

        if (rule.ruleKey === "min_volume") {
          const totalVolume = signal.metadata?.totalVolume ?? 0;
          const threshold = parseFloat(rule.ruleValue);
          if (Number.isFinite(threshold) && totalVolume < threshold) {
            return false;
          }
        }

        if (rule.ruleKey === "max_price") {
          const price = signal.marketPrice ?? 0;
          const threshold = parseFloat(rule.ruleValue);
          if (Number.isFinite(threshold) && price > threshold) {
            return false;
          }
        }

        if (rule.ruleKey === "category_whitelist") {
          const category = signal.metadata?.marketCategory ?? signal.marketCategory ?? "";
          const whitelist = rule.ruleValue
            .split(",")
            .map((c: string) => c.trim().toLowerCase());
          const signalCategory = String(category).toLowerCase();
          if (!whitelist.includes(signalCategory)) {
            return false;
          }
        }

        if (rule.ruleKey === "category_blacklist") {
          const category = signal.metadata?.marketCategory ?? signal.marketCategory ?? "";
          const blacklist = rule.ruleValue
            .split(",")
            .map((c: string) => c.trim().toLowerCase());
          const signalCategory = String(category).toLowerCase();
          if (blacklist.includes(signalCategory)) {
            return false;
          }
        }

        // Legacy rule types
        if (rule.ruleType === "exclude") {
          if (
            rule.ruleKey === "category" &&
            (signal.metadata?.marketCategory ?? signal.marketCategory) === rule.ruleValue
          ) {
            return false;
          }
          if (rule.ruleKey === "signalType" && signal.signalType === rule.ruleValue) {
            return false;
          }
        }

        if (rule.ruleType === "require") {
          if (rule.ruleKey === "minConfidence") {
            const threshold = parseFloat(rule.ruleValue);
            if (Number.isFinite(threshold) && signal.confidence < threshold) {
              return false;
            }
          }
          if (
            rule.ruleKey === "category" &&
            (signal.metadata?.marketCategory ?? signal.marketCategory) !== rule.ruleValue
          ) {
            return false;
          }
        }

        if (rule.ruleType === "forbid") {
          if (rule.ruleKey === "side" && signal.side === rule.ruleValue) {
            return false;
          }
        }
      }
    }

    return true;
  });
}
