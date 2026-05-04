/**
 * Chat Router
 * Per-platform AI chatbot with persistent memory, tool use, and strategy triggers.
 * Each platform (Kalshi / Polymarket) has its own workspace: history, memory
 * summary, persona, and system instructions.
 */

import { protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import OpenAI from "openai";
import { ENV } from "./_core/env";
import { logger } from "./_core/logger";
import * as chatDb from "./db.chat";
import type { ChatMessage } from "../drizzle/schema";
import * as db from "./db";
import { assertPositiveIntegerUserId } from "./_core/userScope";
import { fetchKalshiMarkets } from "./_core/kalshiMarketData";
import { generateSignalsForMarkets, filterSignalsByConfidence } from "./_core/kalshiSignals";
import { fetchPolymarketMarkets } from "./_core/polymarketAuth";
import { generatePolymarketSignals } from "./_core/polymarketSignals";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORM_SCHEMA = z.enum(["kalshi", "polymarket"]);
type Platform = "kalshi" | "polymarket";

const MEMORY_COMPRESSION_THRESHOLD = 30; // compress after this many messages
const MAX_CONTEXT_MESSAGES = 20; // messages to send to AI each turn
const CHAT_MODEL = ENV.openrouterModel; // Configured OpenRouter model

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  platform: Platform,
  config: {
    persona?: string | null;
    systemInstructions?: string | null;
    tone: string;
    memorySummary?: string | null;
    triggerSignalsEnabled: number;
    triggerOrdersEnabled: number;
  }
): string {
  const platformLabel = platform === "kalshi" ? "Kalshi" : "Polymarket";
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
    ? `\n\n## Conversation Memory\nThe following is a compressed summary of your prior conversations with this user:\n${config.memorySummary}`
    : "";

  const customPersona = config.persona
    ? `\n\n## Your Persona\n${config.persona}`
    : "";

  const customInstructions = config.systemInstructions
    ? `\n\n## Custom Instructions\n${config.systemInstructions}`
    : "";

  return `You are an expert AI trading assistant embedded in the Laurenzo prediction-market trading platform, specializing in ${platformLabel}.
Current UTC time: ${now}

${toneGuide[config.tone] ?? toneGuide.professional}

## Your Capabilities
You can:
- ${capabilities}

When the user asks you to perform an action (e.g. "run signals", "check my positions", "generate signals"), call the appropriate tool rather than just describing what you would do.${memoryBlock}${customPersona}${customInstructions}

## Important Rules
- Never fabricate market prices, positions, or account data. Use tools to fetch live data.
- Be transparent about what you can and cannot do.
- When order execution is disabled, explain the user can enable it in bot config.
- Always cite the source of information (tool result, memory, etc.).`;
}

function triggerCapLine(enabled: number, description: string): string | null {
  return enabled ? description : null;
}

// ---------------------------------------------------------------------------
// Tool definitions (OpenAI function calling format)
// ---------------------------------------------------------------------------

const TOOL_GET_SIGNALS: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_signals",
    description: "Fetch the latest trading signals for the current platform. Returns top opportunities ranked by confidence.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of signals to return (1-20). Default 10.",
        },
        minConfidence: {
          type: "number",
          description: "Minimum confidence threshold 0-1. Default 0.65.",
        },
      },
      required: [],
    },
  },
};

const TOOL_GET_POSITIONS: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_positions",
    description: "Fetch the user's current open positions and capital summary for the platform.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

const TOOL_GET_MARKETS: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_markets",
    description: "Search active markets on the current platform. Useful for exploring opportunities.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "How many markets to return (1-30). Default 15.",
        },
      },
      required: [],
    },
  },
};

const TOOL_RUN_SIGNALS: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "run_signals",
    description: "Generate fresh AI trading signals by scanning live markets on the current platform. More thorough than get_signals.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  platform: Platform,
  userId: number
): Promise<{ result: unknown; actionType: string }> {
  if (toolName === "get_signals") {
    const limit = Math.min(20, Math.max(1, Number(toolInput.limit ?? 10)));
    const minConf = Number(toolInput.minConfidence ?? 0.65);

    if (platform === "kalshi") {
      const dbInst = await db.getDb();
      if (!dbInst) return { result: { error: "Database unavailable" }, actionType: "get_signals" };
      const { kalshiSignals } = await import("../drizzle/schema");
      const { desc, eq } = await import("drizzle-orm");
      const signals = await dbInst
        .select()
        .from(kalshiSignals)
        .where(eq(kalshiSignals.userId, userId))
        .orderBy(desc(kalshiSignals.createdAt))
        .limit(limit);
      const filtered = signals.filter((s: { confidence: number }) => s.confidence >= minConf);
      return { result: filtered, actionType: "get_signals" };
    }

    if (platform === "polymarket") {
      const dbInst = await db.getDb();
      if (!dbInst) return { result: { error: "Database unavailable" }, actionType: "get_signals" };
      return { result: { note: "Polymarket signals are generated on-demand via run_signals." }, actionType: "get_signals" };
    }
  }

  if (toolName === "run_signals") {
    if (platform === "kalshi") {
      try {
        const markets = await fetchKalshiMarkets({ status: "open" });
        const slice = markets.slice(0, 30);
        const signals = await generateSignalsForMarkets(slice);
        const top = filterSignalsByConfidence(signals, 0.65).slice(0, 10);
        return { result: { signalsGenerated: signals.length, topSignals: top }, actionType: "run_signals" };
      } catch (err) {
        return { result: { error: String(err) }, actionType: "run_signals" };
      }
    }

    if (platform === "polymarket") {
      try {
        const markets = await fetchPolymarketMarkets({ limit: 40 });
        const signals = await generatePolymarketSignals(markets.slice(0, 30));
        const top = signals.filter((s: { confidence?: number }) => (s.confidence ?? 0) >= 0.65).slice(0, 10);
        return { result: { signalsGenerated: signals.length, topSignals: top }, actionType: "run_signals" };
      } catch (err) {
        return { result: { error: String(err) }, actionType: "run_signals" };
      }
    }
  }

  if (toolName === "get_positions") {
    const dbInst = await db.getDb();
    if (!dbInst) return { result: { error: "Database unavailable" }, actionType: "get_positions" };

    if (platform === "kalshi") {
      const { kalshiPositions, kalshiCapital } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const [positions, [capital]] = await Promise.all([
        dbInst.select().from(kalshiPositions).where(eq(kalshiPositions.userId, userId)),
        dbInst.select().from(kalshiCapital).where(eq(kalshiCapital.userId, userId)),
      ]);
      return { result: { positions, capital: capital ?? null }, actionType: "get_positions" };
    }

    return { result: { note: "Polymarket positions are fetched live from the exchange." }, actionType: "get_positions" };
  }

  if (toolName === "get_markets") {
    const limit = Math.min(30, Math.max(1, Number(toolInput.limit ?? 15)));

    if (platform === "kalshi") {
      const markets = await fetchKalshiMarkets({ status: "open" });
      return { result: markets.slice(0, limit), actionType: "get_markets" };
    }

    const markets = await fetchPolymarketMarkets({ limit });
    return { result: markets, actionType: "get_markets" };
  }

  return { result: { error: `Unknown tool: ${toolName}` }, actionType: toolName };
}

// ---------------------------------------------------------------------------
// Memory compression helper
// ---------------------------------------------------------------------------

async function maybeCompressMemory(
  userId: number,
  platform: Platform,
  existingConfig: Awaited<ReturnType<typeof chatDb.getBotConfig>>
): Promise<void> {
  if (!ENV.openrouterApiKey) return;

  const messages = await chatDb.getChatMessages(userId, platform, MEMORY_COMPRESSION_THRESHOLD + 10);
  if (messages.length < MEMORY_COMPRESSION_THRESHOLD) return;

  // Only compress the older half; leave recent messages untouched
  const toCompress = messages.slice(0, Math.floor(messages.length / 2));
  if (toCompress.length === 0) return;

  const client = new OpenAI({
    apiKey: ENV.openrouterApiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/mikelaurenzo7-collab/tradingmanus",
      "X-Title": "TradingManus",
    },
  });
  const transcript = toCompress
    .map((m: Pick<ChatMessage, "role" | "content">) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const existing = existingConfig?.memorySummary ?? "";

  try {
    const response = await client.chat.completions.create({
      model: CHAT_MODEL,
      max_tokens: 512,
      messages: [
        {
          role: "system",
          content:
            "You are a memory compressor. Summarize the conversation transcript into a concise paragraph (max 400 words) capturing: key topics discussed, decisions made, user preferences revealed, and any strategies or markets mentioned. Preserve facts, numbers, and dates. Be dense and specific.",
        },
        {
          role: "user",
          content: `Previous summary (if any):\n${existing}\n\nNew transcript to incorporate:\n${transcript}`,
        },
      ],
    });

    const summary = response.choices[0]?.message?.content?.trim() ?? "";

    if (summary) {
      await chatDb.upsertBotConfig(userId, platform, { memorySummary: summary });
    }
  } catch {
    // Compression is best-effort — don't fail the request
  }
}

// ---------------------------------------------------------------------------
// Chat Router
// ---------------------------------------------------------------------------

export const chatRouter = router({
  // ── Config ────────────────────────────────────────────────────────────────

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

  // ── History ───────────────────────────────────────────────────────────────

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

  // ── Send Message ──────────────────────────────────────────────────────────

  sendMessage: protectedProcedure
    .input(
      z.object({
        platform: PLATFORM_SCHEMA,
        content: z.string().min(1).max(4000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = assertPositiveIntegerUserId(ctx.user!.id, "chat sendMessage userId");

      if (!ENV.openrouterApiKey) {
        return {
          success: false,
          message: null,
          error: "AI chat requires OPENROUTER_API_KEY (or ANTHROPIC_API_KEY) to be configured.",
        };
      }

      // 1. Persist user message
      await chatDb.addChatMessage({
        userId,
        platform: input.platform,
        role: "user",
        content: input.content,
      });

      // 2. Load bot config + recent history
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

      // 3. Build message array for Anthropic (exclude the just-added user message from history
      //    since we'll append it explicitly)
      const contextMessages = history
        .slice(0, -1) // drop the message we just persisted
        .slice(-MAX_CONTEXT_MESSAGES)
        .map((m: Pick<ChatMessage, "role" | "content">) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      contextMessages.push({ role: "user", content: input.content });

      // 4. Tools available to the bot (OpenAI function calling format)
      const tools: OpenAI.Chat.ChatCompletionTool[] = [
        TOOL_GET_SIGNALS,
        TOOL_GET_POSITIONS,
        TOOL_GET_MARKETS,
        TOOL_RUN_SIGNALS,
      ];

      const client = new OpenAI({
        apiKey: ENV.openrouterApiKey,
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": "https://github.com/mikelaurenzo7-collab/tradingmanus",
          "X-Title": "TradingManus",
        },
      });

      // 5. Agentic loop — handle tool calls
      let assistantContent = "";
      let finalActionType: string | null = null;
      let finalActionData: string | null = null;

      const oaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...contextMessages,
      ];

      let iterations = 0;
      const MAX_TOOL_ITERATIONS = 4;

      while (iterations < MAX_TOOL_ITERATIONS) {
        iterations++;

        const response = await client.chat.completions.create({
          model: CHAT_MODEL,
          max_tokens: 1024,
          messages: oaiMessages,
          tools,
          tool_choice: "auto",
        });

        const choice = response.choices[0];
        if (!choice) break;

        const { message } = choice;
        if (message.content) {
          assistantContent = message.content;
        }

        if (choice.finish_reason === "stop" || choice.finish_reason === "length") {
          break;
        }

        // Handle tool_calls
        const toolCalls = message.tool_calls;
        if (!toolCalls || toolCalls.length === 0) break;

        // Add the assistant's message (with tool_calls) to history
        oaiMessages.push({ role: "assistant", content: message.content ?? null, tool_calls: toolCalls });

        // Execute each tool and add tool result messages
        for (const toolCall of toolCalls) {
          if (toolCall.type !== "function") continue;
          let toolInput: Record<string, unknown> = {};
          try {
            toolInput = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
          } catch (parseErr) {
            logger.warn(
              { err: parseErr, toolName: toolCall.function.name, args: toolCall.function.arguments },
              "[Chat] Failed to parse tool call arguments as JSON; using empty input",
            );
          }
          const { result, actionType } = await executeTool(
            toolCall.function.name,
            toolInput,
            input.platform,
            userId
          );
          finalActionType = actionType;
          finalActionData = JSON.stringify(result);
          oaiMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }
      }

      // Fallback if we got no text content
      if (!assistantContent) {
        assistantContent = "I encountered an issue generating a response. Please try again.";
      }

      // 6. Persist assistant reply
      const saved = await chatDb.addChatMessage({
        userId,
        platform: input.platform,
        role: "assistant",
        content: assistantContent,
        actionType: finalActionType,
        actionData: finalActionData,
      });

      // 7. Maybe compress memory (fire-and-forget, background)
      maybeCompressMemory(userId, input.platform, config).catch(() => {});

      return { success: true, message: saved, error: null };
    }),
});
