import { protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as trainingDb from "./db.training";
import { assertPositiveIntegerUserId } from "./_core/userScope";
import { logger } from "./_core/logger";

export const trainingRouter = router({
  // Create new instruction
  createInstruction: protectedProcedure
    .input(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        instructionType: z.enum(["market_filter", "signal_filter", "position_limit", "time_window", "custom"]),
        priority: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = assertPositiveIntegerUserId(ctx.user!.id, "training create userId");
        const result = await trainingDb.createTrainingInstruction({
          userId,
          title: input.title,
          description: input.description,
          instructionType: input.instructionType,
          priority: input.priority,
        });
        return { success: true, instructionId: result.instructionId };
      } catch (error) {
        logger.error({ err: error }, "[Training] Create instruction error");
        return { success: false, error: String(error) };
      }
    }),

  // Get all instructions for user
  getInstructions: protectedProcedure.query(async ({ ctx }) => {
    try {
      const userId = assertPositiveIntegerUserId(ctx.user!.id, "training list userId");
      return await trainingDb.getUserTrainingInstructions(userId);
    } catch (error) {
      logger.error({ err: error }, "[Training] Get instructions error");
      return [];
    }
  }),

  // Add rule to instruction
  addRule: protectedProcedure
    .input(
      z.object({
        instructionId: z.number(),
        ruleType: z.enum(["include", "exclude", "require", "forbid"]),
        ruleKey: z.string(),
        ruleValue: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await trainingDb.addInstructionRule({
          instructionId: input.instructionId,
          ruleType: input.ruleType,
          ruleKey: input.ruleKey,
          ruleValue: input.ruleValue,
        });
        return result;
      } catch (error) {
        logger.error({ err: error }, "[Training] Add rule error");
        return { success: false, error: String(error) };
      }
    }),

  // Add schedule to instruction
  addSchedule: protectedProcedure
    .input(
      z.object({
        instructionId: z.number(),
        scheduleType: z.enum(["always", "time_window", "day_of_week", "market_condition"]),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        daysOfWeek: z.string().optional(),
        timezone: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await trainingDb.addInstructionSchedule({
          instructionId: input.instructionId,
          scheduleType: input.scheduleType,
          startTime: input.startTime,
          endTime: input.endTime,
          daysOfWeek: input.daysOfWeek,
          timezone: input.timezone,
        });
        return result;
      } catch (error) {
        logger.error({ err: error }, "[Training] Add schedule error");
        return { success: false, error: String(error) };
      }
    }),

  // Update instruction status
  updateStatus: protectedProcedure
    .input(
      z.object({
        instructionId: z.number(),
        isActive: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await trainingDb.updateInstructionStatus(input.instructionId, input.isActive);
        return result;
      } catch (error) {
        logger.error({ err: error }, "[Training] Update status error");
        return { success: false, error: String(error) };
      }
    }),

  // Delete instruction
  deleteInstruction: protectedProcedure
    .input(z.object({ instructionId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await trainingDb.deleteTrainingInstruction(input.instructionId, ctx.user!.openId);
        return result;
      } catch (error) {
        logger.error({ err: error }, "[Training] Delete instruction error");
        return { success: false, error: String(error) };
      }
    }),

  // Delete a rule
  deleteRule: protectedProcedure
    .input(z.object({ ruleId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        return await trainingDb.deleteInstructionRule(input.ruleId);
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }),

  // Delete a schedule
  deleteSchedule: protectedProcedure
    .input(z.object({ scheduleId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        return await trainingDb.deleteInstructionSchedule(input.scheduleId);
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }),

  // Get instruction effectiveness analytics from audit events
  getInstructionEffectiveness: protectedProcedure
    .input(
      z.object({
        lookbackDays: z.number().int().min(1).max(365).optional().default(30),
      }).optional()
    )
    .query(async ({ input, ctx }) => {
      try {
        const lookbackDays = input?.lookbackDays ?? 30;
        return await trainingDb.getInstructionEffectivenessFromAudit(
          ctx.user!.openId,
          lookbackDays
        );
      } catch (error) {
        logger.error({ err: error }, "[Training] Get instruction effectiveness error");
        // Return empty result on error
        return {
          totalEvaluatedSignals: 0,
          totalPassedSignals: 0,
          totalRejectedSignals: 0,
          generatedAt: new Date().toISOString(),
          instructions: [],
        };
      }
    }),
});
