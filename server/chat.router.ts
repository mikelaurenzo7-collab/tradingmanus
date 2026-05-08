/**
 * Chat Router (Kalshi-only, Grok-backed).
 *
 * AI chatbot with persistent memory and lightweight tool use.  The Anthropic
 * provider was removed in the Kalshi-only pivot; the bot now talks to xAI's
 * Grok API via the shared anthropicClient shim, which preserves the
 * messages.create surface so this router didn't need rewriting end-to-end.
 */

import { protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { createAnthropicClient } from "./_core/anthropicClient";
import { ENV } from "./_core/env";
import { logger } from "./_core/logger";
import * as chatDb from "./db.chat";
import type { ChatMessage } from "../drizzle/schema";
import * as db from "./db";
import { assertPositiveIntegerUserId } from "./_core/userScope";
import { fetchKalshiMarkets } from "./_core/kalshiMarketData";
import { generateSignalsForMarkets, filterSignalsByConfidence } from "./_core/kalshiSignals";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORM_SCHEMA = z.enum(["kalshi"]);
type Platform = "kalshi";

const MEMORY_COMPRESSION_THRESHOLD = 30; // compress after this many messages
const MAX_CONTEXT_MESSAGES = 20; // messages to send to AI each turn
const CHAT_MODEL = ENV.grokModel;

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  _platform: Platform,
  config: {
    persona?: string | null;
    systemInstructions?: string | null;
    tone: string;
    memorySummary?: string | null;
    triggerSignalsEnabled: number;
    triggerOrdersEnabled: number;
  }
): string {
  const platformLabel = "Kalshi";
  const now = new Date().toISOString();

  const toneGuide: Record<string, string> = {
    professional: "Respond in a precise, professional tone. Use financial terminology naturally.",
    casual: "Respond in a friendly, conversational tone. Keep it engaging and approachable.",
    aggressive: "Respond with high conviction. Be direct, bold, and action-oriented.",
    analytical: "Respond with deep analytical rigor. Include numbers, percentages, and statistical framing whenever possible.",
  };

  const capabilities = [
    triggerCapLine(config.triggerSignalsEnabled, "generate trading signals"),
    triggerCapLine(config.triggerOrdersEnabled, "place orders directly"),
    "show your positions and capital",
    "analyze market conditions",
    "discuss strategy and risk management",
  ]
    .filter(Boolean)
    .join("\n- ");

  const memoryBlock = config.memorySummary
    ? `\n\n## Conversation Memory\n${config.memorySummary}`
    : "";

  const customPersona = config.persona ? `\n\n## Your Persona\n${config.persona}` : "";
  const customInstructions = config.systemInstructions ? `\n\n## Custom Instructions\n${config.systemInstructions}` : "";

  return `You are an expert AI trading assistant embedded in the Laurenzo prediction-market trading platform, specializing in ${platformLabel}.
Current UTC time: ${now}

${toneGuide[config.tone] ?? toneGuide.professional}

## Your Capabilities
You can:
- ${capabilities}

When the user asks you to perform an action (e.g. "run signals", "check my positions", "generate signals"), describe what you would do and ask the operator to trigger it from the dashboard.${memoryBlock}${customPersona}${customInstructions}

## Important Rules
- Never fabricate market prices, positions, or account data.
- Be transparent about what you can and cannot do.
- When order execution is disabled, explain the user can enable it in bot config.`;
}

function triggerCapLine(enabled: number, description: string): string | null {
  return enabled ? description : null;
}

// ---------------------------------------------------------------------------
// Lightweight, server-side helpers (the Grok shim does not expose tool_use,
// so we surface "tool" results through targeted slash-commands instead).
// ---------------------------------------------------------------------------

async function maybeRunSlashCommand(
  content: string,
  userId: number,
): Promise<{ actionType: string; actionData: string } | null> {
  const trimmed = content.trim().toLowerCase();
  if (trimmed.startsWith("/signals") || trimmed.startsWith("/run signals")) {
    try {
      const markets = await fetchKalshiMarkets({ status: "open" });
      const slice = markets.slice(0, 30);
      const signals = await generateSignalsForMarkets(slice, undefined, undefined, undefined, userId);
      const top = filterSignalsByConfidence(signals, 0.65).slice(0, 10);
      return {
        actionType: "run_signals",
        actionData: JSON.stringify({ signalsGenerated: signals.length, topSignals: top }),
      };
    } catch (err) {
      return { actionType: "run_signals", actionData: JSON.stringify({ error: String(err) }) };
    }
  }
  if (trimmed.startsWith("/positions")) {
    const dbInst = await db.getDb();
    if (!dbInst) return { actionType: "get_positions", actionData: JSON.stringify({ error: "Database unavailable" }) };
    const { kalshiPositions, kalshiCapital } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [positions, [capital]] = await Promise.all([
      dbInst.select().from(kalshiPositions).where(eq(kalshiPositions.userId, userId)),
      dbInst.select().from(kalshiCapital).where(eq(kalshiCapital.userId, userId)),
    ]);
    return {
      actionType: "get_positions",
      actionData: JSON.stringify({ positions, capital: capital ?? null }),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Memory compression helper
// ---------------------------------------------------------------------------

async function maybeCompressMemory(
  userId: number,
  platform: Platform,
  existingConfig: Awaited<ReturnType<typeof chatDb.getBotConfig>>
): Promise<void> {
  if (!ENV.xaiApiKey) return;

  const messages = await chatDb.getChatMessages(userId, platform, MEMORY_COMPRESSION_THRESHOLD + 10);
  if (messages.length < MEMORY_COMPRESSION_THRESHOLD) return;

  const toCompress = messages.slice(0, Math.floor(messages.length / 2));
  if (toCompress.length === 0) return;

  const client = createAnthropicClient(ENV.xaiApiKey);
  const transcript = toCompress
    .map((m: Pick<ChatMessage, "role" | "content">) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const existing = existingConfig?.memorySummary ?? "";

  try {
    const response = await client.messages.create({
      model: CHAT_MODEL,
      max_tokens: 512,
      system:
        "You are a memory compressor. Summarize the conversation transcript into a concise paragraph (max 400 words) capturing: key topics, decisions, user preferences, strategies and markets mentioned. Be dense and specific.",
      messages: [
        {
          role: "user",
          content: `Previous summary (if any):\n${existing}\n\nNew transcript to incorporate:\n${transcript}`,
        },
      ],
    });

    const summary = response.content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text ?? "")
      .join("\n")
      .trim();

    if (summary) {
      await chatDb.upsertBotConfig(userId, platform, { memorySummary: summary });
    }
  } catch (err) {
    logger.warn({ err }, "[Chat] memory compression failed");
  }
}

// ---------------------------------------------------------------------------
// Chat Router
// ---------------------------------------------------------------------------

export const chatRouter = router({
  getConfig: protectedProcedure
    .input(z.object({ platform: PLATFORM_SCHEMA }))
    .query(async ({ input, ctx }) => {
      const userId = assertPositiveIntegerUserId(ctx.user!.id, "chat getConfig userId");
      const config = await chatDb.getBotConfig(userId, input.platform);
      return (
        config ?? {
          platform: input.platform,
          persona: null,
          systemInstructions: null,
          tone: "professional" as const,
          memorySummary: null,
          triggerSignalsEnabled: 1,
          triggerOrdersEnabled: 0,
        }
      );
    }),

  updateConfig: protectedProcedure
    .input(
      z.object({
        platform: PLATFORM_SCHEMA,
        persona: z.string().max(1000).nullable().optional(),
        systemInstructions: z.string().max(2000).nullable().optional(),
        tone: z.enum(["professional", "casual", "aggressive", "analytical"]).optional(),
        triggerSignalsEnabled: z.boolean().optional(),
        triggerOrdersEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = assertPositiveIntegerUserId(ctx.user!.id, "chat updateConfig userId");
      const patch: Parameters<typeof chatDb.upsertBotConfig>[2] = {};
      if (input.persona !== undefined) patch.persona = input.persona;
      if (input.systemInstructions !== undefined) patch.systemInstructions = input.systemInstructions;
      if (input.tone !== undefined) patch.tone = input.tone;
      if (input.triggerSignalsEnabled !== undefined) patch.triggerSignalsEnabled = input.triggerSignalsEnabled ? 1 : 0;
      if (input.triggerOrdersEnabled !== undefined) patch.triggerOrdersEnabled = input.triggerOrdersEnabled ? 1 : 0;
      const updated = await chatDb.upsertBotConfig(userId, input.platform, patch);
      return { success: true, config: updated };
    }),

  resetMemory: protectedProcedure
    .input(z.object({ platform: PLATFORM_SCHEMA }))
    .mutation(async ({ input, ctx }) => {
      const userId = assertPositiveIntegerUserId(ctx.user!.id, "chat resetMemory userId");
      await chatDb.upsertBotConfig(userId, input.platform, { memorySummary: null });
      return { success: true };
    }),

  getHistory: protectedProcedure
    .input(z.object({ platform: PLATFORM_SCHEMA, limit: z.number().int().min(1).max(100).optional() }))
    .query(async ({ input, ctx }) => {
      const userId = assertPositiveIntegerUserId(ctx.user!.id, "chat getHistory userId");
      return chatDb.getChatMessages(userId, input.platform, input.limit ?? 60);
    }),

  clearHistory: protectedProcedure
    .input(z.object({ platform: PLATFORM_SCHEMA }))
    .mutation(async ({ input, ctx }) => {
      const userId = assertPositiveIntegerUserId(ctx.user!.id, "chat clearHistory userId");
      await chatDb.clearChatMessages(userId, input.platform);
      return { success: true };
    }),

  sendMessage: protectedProcedure
    .input(
      z.object({
        platform: PLATFORM_SCHEMA,
        content: z.string().min(1).max(4000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = assertPositiveIntegerUserId(ctx.user!.id, "chat sendMessage userId");

      if (!ENV.xaiApiKey) {
        return {
          success: false,
          message: null,
          error: "AI chat requires XAI_API_KEY to be configured.",
        };
      }

      // 1. Persist user message
      await chatDb.addChatMessage({
        userId,
        platform: input.platform,
        role: "user",
        content: input.content,
      });

      // 2. Slash-command shortcut: skip the LLM round-trip when the user is
      // running a deterministic action.
      const slash = await maybeRunSlashCommand(input.content, userId);

      // 3. Load bot config + recent history
      const [config, history] = await Promise.all([
        chatDb.getBotConfig(userId, input.platform),
        chatDb.getChatMessages(userId, input.platform, MAX_CONTEXT_MESSAGES + 1),
      ]);

      const effectiveConfig = config ?? {
        tone: "professional" as const,
        persona: null,
        systemInstructions: null,
        memorySummary: null,
        triggerSignalsEnabled: 1,
        triggerOrdersEnabled: 0,
      };

      const systemPrompt = buildSystemPrompt(input.platform, effectiveConfig);

      const contextMessages = history
        .slice(0, -1)
        .slice(-MAX_CONTEXT_MESSAGES)
        .map((m: Pick<ChatMessage, "role" | "content">) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      contextMessages.push({ role: "user", content: input.content });
      if (slash) {
        contextMessages.push({
          role: "user",
          content: `[tool result for ${slash.actionType}]\n${slash.actionData}`,
        });
      }

      const client = createAnthropicClient(ENV.xaiApiKey);

      let assistantContent = "";
      try {
        const response = await client.messages.create({
          model: CHAT_MODEL,
          max_tokens: 1024,
          system: systemPrompt,
          messages: contextMessages,
        });
        const blocks = response.content ?? [];
        assistantContent = blocks
          .filter((b) => b.type === "text")
          .map((b) => (typeof b.text === "string" ? b.text : ""))
          .join("\n")
          .trim();
      } catch (err) {
        logger.error({ err }, "[Chat] Grok call failed");
      }

      if (!assistantContent) {
        assistantContent = "I encountered an issue generating a response. Please try again.";
      }

      const saved = await chatDb.addChatMessage({
        userId,
        platform: input.platform,
        role: "assistant",
        content: assistantContent,
        actionType: slash?.actionType ?? null,
        actionData: slash?.actionData ?? null,
      });

      maybeCompressMemory(userId, input.platform, config).catch(() => {});

      return { success: true, message: saved, error: null };
    }),
});
