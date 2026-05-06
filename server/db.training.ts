import {
  trainingInstructions,
  instructionRules,
  instructionSchedules,
  instructionHistory,
} from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { getDb, getAuditLog } from "./db";
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
    const instructionMatches: InstructionMatch[] = [];
    let signalPassed = true;

    for (const instruction of activeInstructions) {
      const rules = instruction.rules || [];
      let instructionPassed = true;
      const failedRules: Array<{ ruleId: number; ruleKey: string; ruleType: string; reason: string }> = [];

      for (const rule of rules) {
        let ruleFailed = false;
        let failureReason = "";

        // Check new rule types
        if (rule.ruleKey === "must_have_keyword") {
          const market = marketsMap.get(signal.marketId);
          if (market?.title) {
            const title = String(market.title).toLowerCase();
            const keyword = String(rule.ruleValue).toLowerCase();
            if (!title.includes(keyword)) {
              ruleFailed = true;
              failureReason = `Market title missing required keyword: ${rule.ruleValue}`;
            }
          } else {
            ruleFailed = true;
            failureReason = "Market title not available";
          }
        }

        if (rule.ruleKey === "must_not_have_keyword") {
          const market = marketsMap.get(signal.marketId);
          if (market?.title) {
            const title = String(market.title).toLowerCase();
            const keyword = String(rule.ruleValue).toLowerCase();
            if (title.includes(keyword)) {
              ruleFailed = true;
              failureReason = `Market title contains forbidden keyword: ${rule.ruleValue}`;
            }
          }
        }

        if (rule.ruleKey === "min_volume") {
          const totalVolume = signal.metadata?.totalVolume ?? 0;
          const threshold = parseFloat(rule.ruleValue);
          if (!Number.isFinite(threshold)) {
            // Fail closed: invalid threshold means rule fails
            ruleFailed = true;
            failureReason = `Invalid min_volume threshold: ${rule.ruleValue}`;
          } else if (totalVolume < threshold) {
            ruleFailed = true;
            failureReason = `Volume ${totalVolume} below minimum ${threshold}`;
          }
        }

        if (rule.ruleKey === "max_price") {
          const price = signal.marketPrice ?? 0;
          const threshold = parseFloat(rule.ruleValue);
          if (!Number.isFinite(threshold)) {
            // Fail closed: invalid threshold means rule fails
            ruleFailed = true;
            failureReason = `Invalid max_price threshold: ${rule.ruleValue}`;
          } else if (price > threshold) {
            ruleFailed = true;
            failureReason = `Price ${price} exceeds maximum ${threshold}`;
          }
        }

        if (rule.ruleKey === "category_whitelist") {
          const category = signal.metadata?.marketCategory ?? signal.marketCategory ?? "";
          const whitelist = rule.ruleValue
            .split(",")
            .map((c: string) => c.trim().toLowerCase());
          const signalCategory = String(category).toLowerCase();
          if (!whitelist.includes(signalCategory)) {
            ruleFailed = true;
            failureReason = `Category '${category}' not in whitelist`;
          }
        }

        if (rule.ruleKey === "category_blacklist") {
          const category = signal.metadata?.marketCategory ?? signal.marketCategory ?? "";
          const blacklist = rule.ruleValue
            .split(",")
            .map((c: string) => c.trim().toLowerCase());
          const signalCategory = String(category).toLowerCase();
          if (blacklist.includes(signalCategory)) {
            ruleFailed = true;
            failureReason = `Category '${category}' in blacklist`;
          }
        }

        // Legacy rule types
        if (rule.ruleType === "exclude") {
          if (
            rule.ruleKey === "category" &&
            (signal.metadata?.marketCategory ?? signal.marketCategory) === rule.ruleValue
          ) {
            ruleFailed = true;
            failureReason = `Category matches excluded value: ${rule.ruleValue}`;
          }
          if (rule.ruleKey === "signalType" && signal.signalType === rule.ruleValue) {
            ruleFailed = true;
            failureReason = `Signal type matches excluded value: ${rule.ruleValue}`;
          }
        }

        if (rule.ruleType === "require") {
          if (rule.ruleKey === "minConfidence") {
            const threshold = parseFloat(rule.ruleValue);
            if (!Number.isFinite(threshold)) {
              // Fail closed: invalid threshold means rule fails
              ruleFailed = true;
              failureReason = `Invalid minConfidence threshold: ${rule.ruleValue}`;
            } else if (signal.confidence < threshold) {
              ruleFailed = true;
              failureReason = `Confidence ${signal.confidence} below required ${threshold}`;
            }
          }
          if (
            rule.ruleKey === "category" &&
            (signal.metadata?.marketCategory ?? signal.marketCategory) !== rule.ruleValue
          ) {
            ruleFailed = true;
            failureReason = `Category does not match required value: ${rule.ruleValue}`;
          }
        }

        if (rule.ruleType === "forbid") {
          if (rule.ruleKey === "side" && signal.side === rule.ruleValue) {
            ruleFailed = true;
            failureReason = `Side ${signal.side} is forbidden`;
          }
        }

        if (ruleFailed) {
          instructionPassed = false;
          failedRules.push({
            ruleId: rule.id,
            ruleKey: rule.ruleKey,
            ruleType: rule.ruleType,
            reason: failureReason,
          });
        }
      }

      if (!instructionPassed) {
        signalPassed = false;
      }

      instructionMatches.push({
        instructionId: instruction.id,
        instructionTitle: instruction.title,
        passed: instructionPassed,
        failedRules: failedRules.length > 0 ? failedRules : undefined,
      });
    }

    // Store instruction matches in metadata for all evaluated signals (both passed and rejected)
    // This enables effectiveness analytics from audit events
    signal.metadata = signal.metadata || {};
    signal.metadata.instructionMatches = instructionMatches;

    return signalPassed;
  });
}

/**
 * Get instruction effectiveness metrics from audit events
 * 
 * Parses instruction_matches_evaluated audit events to aggregate:
 * - Per-instruction: evaluatedSignals, passedSignals, rejectedSignals, passRate, failedRuleCounts
 * - Top-level: totalEvaluatedSignals, totalPassedSignals, totalRejectedSignals, generatedAt
 * 
 * @param triggeredByOpenId - User openId to filter audit events
 * @param lookbackDays - Number of days to look back (default 30)
 */
export async function getInstructionEffectivenessFromAudit(
  triggeredByOpenId: string,
  lookbackDays: number = 30
): Promise<{
  totalEvaluatedSignals: number;
  totalPassedSignals: number;
  totalRejectedSignals: number;
  generatedAt: string;
  instructions: Array<{
    instructionId: number;
    instructionTitle: string;
    evaluatedSignals: number;
    passedSignals: number;
    rejectedSignals: number;
    passRate: number;
    failedRuleCounts: Array<{ ruleKey: string; count: number }>;
  }>;
}> {
  try {
    // Fetch audit events for the lookback period
    const auditEvents = await getAuditLog(lookbackDays, triggeredByOpenId);
    
    // Filter for instruction_matches_evaluated events
    const instructionEvents = auditEvents.filter(
      (event: any) => event.eventType === "instruction_matches_evaluated"
    );

    // Aggregate per-instruction metrics
    const instructionMetrics = new Map<number, {
      instructionId: number;
      instructionTitle: string;
      evaluatedSignals: number;
      passedSignals: number;
      rejectedSignals: number;
      failedRuleCounts: Map<string, number>;
    }>();

    let totalEvaluated = 0;
    let totalPassed = 0;
    let totalRejected = 0;

    for (const event of instructionEvents) {
      try {
        // Parse audit event details (defensive parsing)
        // Production audit log uses 'details' field, fallback to 'eventDetails' for legacy
        const rawDetails = (event as any).details ?? (event as any).eventDetails;
        const details = typeof rawDetails === "string" 
          ? JSON.parse(rawDetails) 
          : rawDetails;

        if (!details || typeof details !== "object") continue;
        
        const signals = details.signals;
        if (!Array.isArray(signals)) continue;

        // Process each signal in the event
        for (const signal of signals) {
          if (!signal || typeof signal !== "object") continue;
          
          const instructionMatches = signal.instructionMatches;
          if (!Array.isArray(instructionMatches)) continue;

          const filterOutcome = signal.filterOutcome;
          const passed = filterOutcome === "passed";

          // Process each instruction match
          for (const match of instructionMatches) {
            if (!match || typeof match !== "object") continue;
            
            const instructionId = match.instructionId;
            const instructionTitle = match.instructionTitle || `Instruction ${instructionId}`;
            const matchPassed = match.passed === true;

            if (typeof instructionId !== "number") continue;

            // Initialize instruction metrics if not exists
            if (!instructionMetrics.has(instructionId)) {
              instructionMetrics.set(instructionId, {
                instructionId,
                instructionTitle,
                evaluatedSignals: 0,
                passedSignals: 0,
                rejectedSignals: 0,
                failedRuleCounts: new Map(),
              });
            }

            const metrics = instructionMetrics.get(instructionId)!;
            metrics.evaluatedSignals++;

            if (matchPassed) {
              metrics.passedSignals++;
            } else {
              metrics.rejectedSignals++;

              // Track failed rule counts
              const failedRules = match.failedRules;
              if (Array.isArray(failedRules)) {
                for (const failedRule of failedRules) {
                  if (failedRule && typeof failedRule === "object" && failedRule.ruleKey) {
                    const ruleKey = String(failedRule.ruleKey);
                    const currentCount = metrics.failedRuleCounts.get(ruleKey) || 0;
                    metrics.failedRuleCounts.set(ruleKey, currentCount + 1);
                  }
                }
              }
            }
          }

          // Track top-level totals (count each signal once)
          totalEvaluated++;
          if (passed) {
            totalPassed++;
          } else {
            totalRejected++;
          }
        }
      } catch (parseError) {
        // Log parse errors but continue processing other events
        logger.warn(
          { err: parseError, eventId: event.id },
          "[Training] Failed to parse instruction effectiveness audit event"
        );
        continue;
      }
    }

    // Convert map to array and calculate pass rates
    const instructions = Array.from(instructionMetrics.values()).map((metrics) => ({
      instructionId: metrics.instructionId,
      instructionTitle: metrics.instructionTitle,
      evaluatedSignals: metrics.evaluatedSignals,
      passedSignals: metrics.passedSignals,
      rejectedSignals: metrics.rejectedSignals,
      passRate: metrics.evaluatedSignals > 0 
        ? metrics.passedSignals / metrics.evaluatedSignals 
        : 0,
      failedRuleCounts: Array.from(metrics.failedRuleCounts.entries()).map(
        ([ruleKey, count]) => ({ ruleKey, count })
      ).sort((a, b) => b.count - a.count), // Sort by count descending
    }));

    // Sort by total evaluated signals (most active first)
    instructions.sort((a, b) => b.evaluatedSignals - a.evaluatedSignals);

    return {
      totalEvaluatedSignals: totalEvaluated,
      totalPassedSignals: totalPassed,
      totalRejectedSignals: totalRejected,
      generatedAt: new Date().toISOString(),
      instructions,
    };
  } catch (error) {
    logger.error(
      { err: error },
      "[Training] Get instruction effectiveness from audit failed"
    );
    // Return empty result on error
    return {
      totalEvaluatedSignals: 0,
      totalPassedSignals: 0,
      totalRejectedSignals: 0,
      generatedAt: new Date().toISOString(),
      instructions: [],
    };
  }
}

export interface InstructionSuggestion {
  instructionId: number;
  instructionTitle: string;
  suggestionType: "high_performer" | "low_performer" | "common_failure_rule";
  message: string;
  confidence: number;
  supportingStats: Record<string, number | string>;
}

/**
 * Generates actionable instruction suggestions from audit effectiveness analytics
 * 
 * Rules:
 * - high_performer: passRate >= 0.7 and evaluatedSignals >= 10
 * - low_performer: passRate <= 0.35 and evaluatedSignals >= 10
 * - common_failure_rule: any rule with failedRuleCounts count >= 5
 * 
 * Confidence is a function of sample size and effect magnitude.
 * 
 * @param triggeredByOpenId - User openId to filter audit events
 * @param lookbackDays - Number of days to look back (default 30)
 */
export async function getInstructionSuggestionsFromAudit(
  triggeredByOpenId: string,
  lookbackDays: number = 30
): Promise<{
  generatedAt: string;
  lookbackDays: number;
  suggestions: InstructionSuggestion[];
}> {
  try {
    // Reuse existing effectiveness analytics to avoid duplicate parsing
    const effectiveness = await getInstructionEffectivenessFromAudit(
      triggeredByOpenId,
      lookbackDays
    );

    const suggestions: InstructionSuggestion[] = [];

    // Process each instruction for suggestions
    for (const instruction of effectiveness.instructions) {
      const { instructionId, instructionTitle, evaluatedSignals, passRate, failedRuleCounts } = instruction;

      // Suggestion 1: High performer (passes frequently)
      if (passRate >= 0.7 && evaluatedSignals >= 10) {
        // Confidence increases with sample size and pass rate
        // Bounded between 0.5 (baseline for meeting threshold) and 1.0 (very high confidence)
        const sampleBonus = Math.min((evaluatedSignals - 10) / 40, 0.3); // Up to +0.3 for 50+ samples
        const passRateBonus = Math.min((passRate - 0.7) / 0.3, 0.2); // Up to +0.2 for 100% pass rate
        const confidence = Math.min(0.5 + sampleBonus + passRateBonus, 1.0);

        suggestions.push({
          instructionId,
          instructionTitle,
          suggestionType: "high_performer",
          message: `Instruction "${instructionTitle}" passes ${Math.round(passRate * 100)}% over ${evaluatedSignals} signals — consider expanding this pattern.`,
          confidence: Math.round(confidence * 100) / 100, // Round to 2 decimals
          supportingStats: {
            passRate: Math.round(passRate * 100) / 100,
            evaluatedSignals,
          },
        });
      }

      // Suggestion 2: Low performer (rejects frequently)
      if (passRate <= 0.35 && evaluatedSignals >= 10) {
        // Similar confidence calculation
        const sampleBonus = Math.min((evaluatedSignals - 10) / 40, 0.3);
        const lowRateBonus = Math.min((0.35 - passRate) / 0.35, 0.2); // Lower pass rate = higher confidence in issue
        const confidence = Math.min(0.5 + sampleBonus + lowRateBonus, 1.0);

        suggestions.push({
          instructionId,
          instructionTitle,
          suggestionType: "low_performer",
          message: `Instruction "${instructionTitle}" passes only ${Math.round(passRate * 100)}% over ${evaluatedSignals} signals — consider relaxing or revising rules.`,
          confidence: Math.round(confidence * 100) / 100,
          supportingStats: {
            passRate: Math.round(passRate * 100) / 100,
            evaluatedSignals,
          },
        });
      }

      // Suggestion 3: Common failure rules (specific rules block often)
      for (const failedRule of failedRuleCounts) {
        if (failedRule.count >= 5) {
          // Confidence based on failure frequency relative to total evaluations
          const failureRatio = failedRule.count / evaluatedSignals;
          const countBonus = Math.min((failedRule.count - 5) / 20, 0.3); // Up to +0.3 for 25+ failures
          const ratioBonus = Math.min(failureRatio, 0.2); // Up to +0.2 if rule fails often
          const confidence = Math.min(0.5 + countBonus + ratioBonus, 1.0);

          suggestions.push({
            instructionId,
            instructionTitle,
            suggestionType: "common_failure_rule",
            message: `Rule "${failedRule.ruleKey}" in "${instructionTitle}" frequently rejects signals (${failedRule.count} times) — consider tuning threshold.`,
            confidence: Math.round(confidence * 100) / 100,
            supportingStats: {
              ruleKey: failedRule.ruleKey,
              failureCount: failedRule.count,
              evaluatedSignals,
            },
          });
        }
      }
    }

    // Sort suggestions by confidence descending
    suggestions.sort((a, b) => b.confidence - a.confidence);

    return {
      generatedAt: new Date().toISOString(),
      lookbackDays,
      suggestions,
    };
  } catch (error) {
    logger.error(
      { err: error },
      "[Training] Get instruction suggestions from audit failed"
    );
    // Return empty result on error
    return {
      generatedAt: new Date().toISOString(),
      lookbackDays,
      suggestions: [],
    };
  }
}
