import {
  trainingInstructions,
  instructionRules,
  instructionSchedules,
  instructionHistory,
} from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { getDb } from "./db";

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
    const result = await database.insert(trainingInstructions).values({
      userId: payload.userId,
      title: payload.title,
      description: payload.description,
      instructionType: payload.instructionType,
      priority: payload.priority || 0,
      isActive: 1,
    });

    return { success: true, instructionId: (result as any).insertId };
  } catch (error) {
    console.error("[Database] Create training instruction failed:", error);
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
    console.error("[Database] Get training instructions failed:", error);
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
    console.error("[Database] Add instruction rule failed:", error);
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
    console.error("[Database] Add instruction schedule failed:", error);
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
    console.error("[Database] Update instruction status failed:", error);
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
    console.error("[Database] Delete training instruction failed:", error);
    throw error;
  }
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
 */
export function applyInstructionsToSignals(signals: any[], instructions: any[]): any[] {
  const activeInstructions = instructions.filter(isInstructionActiveNow);

  return signals.filter((signal) => {
    for (const instruction of activeInstructions) {
      const rules = instruction.rules || [];

      for (const rule of rules) {
        if (rule.ruleType === "exclude") {
          // Exclude signals matching this rule
          if (rule.ruleKey === "category" && signal.marketCategory === rule.ruleValue) {
            return false;
          }
          if (rule.ruleKey === "signalType" && signal.signalType === rule.ruleValue) {
            return false;
          }
        }

        if (rule.ruleType === "require") {
          // Only include signals matching this rule
          if (rule.ruleKey === "minConfidence" && signal.confidence < parseFloat(rule.ruleValue)) {
            return false;
          }
          if (rule.ruleKey === "category" && signal.marketCategory !== rule.ruleValue) {
            return false;
          }
        }

        if (rule.ruleType === "forbid") {
          // Forbid signals with this property
          if (rule.ruleKey === "side" && signal.side === rule.ruleValue) {
            return false;
          }
        }
      }
    }

    return true;
  });
}
