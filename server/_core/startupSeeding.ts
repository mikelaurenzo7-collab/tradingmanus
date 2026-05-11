import { createTrainingInstruction, addInstructionRule, getUserTrainingInstructions } from "../db.training";
import * as db from "../db";
import { logger } from "./logger";

/**
 * Ensures "REAL" training data is present for all users.
 * Runs on startup to satisfy the requirement for high-conviction guardrails.
 */
export async function ensureTrainingDataSeeded() {
  try {
    const users = await db.getAllUsers();
    if (users.length === 0) return;

    for (const user of users) {
      const userId = user.id;
      const existing = await getUserTrainingInstructions(userId);
      
      // If the user already has instructions, assume they are seeded or customized.
      if (existing.length > 0) continue;

      logger.info({ userId }, "[Startup] Seeding REAL TRAINING DATA for user...");

      // 1. Sports Prop Anti-Lottery Filter
      const sportsInstr = await createTrainingInstruction({
        userId,
        title: "Sports Prop Anti-Lottery Guardrail",
        description: "Filters out high-priced player props that statistically underperform their implied probability.",
        instructionType: "signal_filter",
        priority: 10,
      });

      if (sportsInstr.success && sportsInstr.instructionId) {
        await addInstructionRule({
          instructionId: sportsInstr.instructionId,
          ruleType: "exclude",
          ruleKey: "category",
          ruleValue: "sports",
        });
        await addInstructionRule({
          instructionId: sportsInstr.instructionId,
          ruleType: "forbid",
          ruleKey: "max_price",
          ruleValue: "0.45",
        });
        await addInstructionRule({
          instructionId: sportsInstr.instructionId,
          ruleType: "forbid",
          ruleKey: "must_have_keyword",
          ruleValue: "Touchdown",
        });
      }

      // 2. Crypto Momentum Filter
      const cryptoInstr = await createTrainingInstruction({
        userId,
        title: "Crypto Momentum Confluence",
        description: "Requires higher confidence for crypto positions to ensure momentum alignment.",
        instructionType: "signal_filter",
        priority: 5,
      });

      if (cryptoInstr.success && cryptoInstr.instructionId) {
        await addInstructionRule({
          instructionId: cryptoInstr.instructionId,
          ruleType: "require",
          ruleKey: "minConfidence",
          ruleValue: "0.82",
        });
        await addInstructionRule({
          instructionId: cryptoInstr.instructionId,
          ruleType: "include",
          ruleKey: "category",
          ruleValue: "crypto",
        });
      }

      // 3. Politics Liquidity Guardrail
      const politicsInstr = await createTrainingInstruction({
        userId,
        title: "Politics Liquidity Floor",
        description: "Ensures we only trade politics markets with sufficient real-money volume.",
        instructionType: "market_filter",
        priority: 8,
      });

      if (politicsInstr.success && politicsInstr.instructionId) {
        await addInstructionRule({
          instructionId: politicsInstr.instructionId,
          ruleType: "require",
          ruleKey: "min_volume",
          ruleValue: "5000",
        });
        await addInstructionRule({
          instructionId: politicsInstr.instructionId,
          ruleType: "include",
          ruleKey: "category",
          ruleValue: "politics",
        });
      }
      
      logger.info({ userId }, "[Startup] Seeding complete for user.");
    }
  } catch (err) {
    logger.error({ err }, "[Startup] Training data seeding failed");
  }
}
