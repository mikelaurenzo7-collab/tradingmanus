/**
 * OpenRouter client adapter.
 *
 * Provides an Anthropic-compatible `messages.create` interface that internally
 * routes calls through OpenRouter's OpenAI-compatible API endpoint.
 *
 * This lets all existing reviewer code (tradingReviewer, polymarketSignalReviewer,
 * arbitrageReviewer, runHaikuTriage) keep its Anthropic-shaped call sites unchanged.
 * The adapter handles three conversions:
 *
 *   1. System prompt: SystemBlock[] with optional cache_control → plain string
 *      (OpenRouter / OpenAI does not support Anthropic prompt caching)
 *
 *   2. Anthropic-specific request extensions stripped:
 *        - cache_control fields on system and message blocks
 *        - thinking: { type: "enabled", budget_tokens } (extended thinking)
 *        - Anthropic hosted web_search_20250305 tool (not available on OpenRouter)
 *
 *   3. Response: OpenAI choices[0].message.content → content: [{type:"text", text}]
 *      with usage fields mapped to Anthropic names.
 */

import OpenAI from "openai";
import { logger } from "./logger";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

type SystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

type AnthropicRequestInput = {
  model: string;
  max_tokens: number;
  temperature?: number;
  system?: string | SystemBlock[];
  messages: Array<{
    role: "user" | "assistant";
    content: string | Array<{ type: string; [key: string]: unknown }>;
  }>;
  thinking?: { type: string; budget_tokens?: number };
  tools?: Array<{ type?: string; name?: string; [key: string]: unknown }>;
  [key: string]: unknown;
};

type AnthropicResponseOutput = {
  content: Array<{ type: string; text?: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
};

/**
 * Convert an Anthropic system prompt (string or SystemBlock array) into a
 * single plain string by concatenating block texts, separated by two newlines.
 */
function systemBlocksToString(system: string | SystemBlock[]): string {
  if (typeof system === "string") return system;
  return system.map((b) => b.text.trim()).filter(Boolean).join("\n\n");
}

/** Named type for OpenAI-format function tool entries returned by filterTools. */
type FunctionTool = {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown> };
};

/**
 * Filter out Anthropic-only hosted tools (e.g. web_search_20250305) that are
 * not available on OpenRouter, and return only plain function-call tools.
 * Returns undefined when the resulting list is empty.
 */
function filterTools(
  tools: Array<{ type?: string; name?: string; [key: string]: unknown }>,
): FunctionTool[] | undefined {
  const functionTools = tools.filter(
    (t) => t.type !== "web_search_20250305" && typeof t.name === "string",
  );
  if (functionTools.length === 0) return undefined;

  return functionTools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name as string,
      description: typeof t.description === "string" ? t.description : undefined,
      parameters:
        (t.input_schema as Record<string, unknown> | undefined) ??
        (t.parameters as Record<string, unknown> | undefined) ??
        { type: "object", properties: {} },
    },
  }));
}

/**
 * Create an OpenRouter client that presents an Anthropic-compatible interface.
 *
 * @param apiKey  OpenRouter API key (from OPENROUTER_API_KEY or ANTHROPIC_API_KEY)
 * @returns       Object with `messages.create` matching the Anthropic SDK surface
 *                used by the trading reviewers and triage helper.
 */
export function createOpenRouterClient(apiKey: string): {
  messages: {
    create: (input: AnthropicRequestInput) => Promise<AnthropicResponseOutput>;
  };
} {
  const oai = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/mikelaurenzo7-collab/tradingmanus",
      "X-Title": "TradingManus",
    },
  });

  return {
    messages: {
      async create(input: AnthropicRequestInput): Promise<AnthropicResponseOutput> {
        // Build the OpenAI messages array.
        const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

        // System prompt
        if (input.system) {
          const systemText = systemBlocksToString(input.system as string | SystemBlock[]);
          if (systemText) {
            openaiMessages.push({ role: "system", content: systemText });
          }
        }

        // User / assistant messages
        for (const msg of input.messages) {
          if (typeof msg.content === "string") {
            openaiMessages.push({ role: msg.role, content: msg.content });
          } else if (Array.isArray(msg.content)) {
            // Concatenate text blocks for simplicity
            const text = msg.content
              .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
              .map((b) => b.text)
              .join("\n");
            openaiMessages.push({ role: msg.role, content: text });
          }
        }

        // Filter tools: strip Anthropic-only hosted tools
        const tools = input.tools ? filterTools(input.tools) : undefined;

        const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
          model: input.model,
          max_tokens: input.max_tokens,
          temperature: input.temperature ?? 0,
          messages: openaiMessages,
        };
        if (tools && tools.length > 0) {
          requestParams.tools = tools;
        }

        const response = await oai.chat.completions.create(requestParams);

        const choice = response.choices[0];
        // OpenAI-shaped responses can return:
        //   - string content (the common path for text completions)
        //   - null content with `tool_calls` populated (when the model picks a
        //     tool); we don't currently surface tool_calls back to Anthropic
        //     callers, so flatten to "" but log a warning so silent-empty
        //     reviewer responses don't masquerade as "approved nothing".
        //   - array of content parts (rare, multi-modal).  We concatenate
        //     text parts and skip non-text.
        // OpenAI SDK types `message.content` as `string | null`. The null
        // branch most often appears when the model picks `tool_calls`
        // instead of returning text. Downstream reviewer code parses this
        // string as JSON, so an unannotated null would silently degrade to
        // "approved nothing" — log a warning so the pattern is visible.
        const rawContent = choice?.message?.content;
        let text = "";
        if (typeof rawContent === "string") {
          text = rawContent;
        } else {
          logger.warn(
            {
              finishReason: choice?.finish_reason,
              model: response.model,
              hadToolCalls: Boolean(choice?.message?.tool_calls?.length),
            },
            "[openrouter] Model returned non-string content; downstream callers will see empty response.",
          );
        }

        const usage = response.usage;

        return {
          content: [{ type: "text", text }],
          usage: {
            input_tokens: usage?.prompt_tokens ?? 0,
            output_tokens: usage?.completion_tokens ?? 0,
            // OpenRouter does not provide Anthropic-style cache stats.
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        };
      },
    },
  };
}
