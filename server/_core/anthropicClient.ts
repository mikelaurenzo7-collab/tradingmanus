/**
 * Anthropic SDK shim — Grok-backed.
 *
 * The Kalshi-only pivot dropped Anthropic entirely; Grok (xAI) is the
 * sole AI provider.  This file keeps the old `createAnthropicClient(...)`
 * export so existing call sites compile, but routes all `messages.create`
 * calls to the Grok chat-completion endpoint.  The shim translates
 * Anthropic-shaped requests (system blocks, content arrays) into Grok's
 * OpenAI-compatible shape, and translates the response back into the
 * minimal Anthropic shape the reviewers expect.
 *
 * Anthropic-only features (prompt caching, extended thinking, hosted
 * tools) are silently dropped — Grok does not support them.  Cache
 * accounting therefore reports 0 cache hits.
 */

import { createGrokChatCompletion, type GrokMessage } from "./grokClient";

type AnthropicMessageInput = Record<string, unknown>;

type AnthropicMessageOutput = {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function flattenSystem(system: unknown): string | undefined {
  if (system === undefined || system === null) return undefined;
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .map((b) => {
        if (b && typeof b === "object" && "text" in b) {
          const t = (b as { text?: unknown }).text;
          return typeof t === "string" ? t : "";
        }
        return typeof b === "string" ? b : "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return undefined;
}

function flattenContent(content: unknown): string {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (b && typeof b === "object" && "text" in b) {
          const t = (b as { text?: unknown }).text;
          return typeof t === "string" ? t : "";
        }
        return typeof b === "string" ? b : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function createAnthropicClient(_apiKey: string): {
  messages: {
    create: (input: AnthropicMessageInput) => Promise<AnthropicMessageOutput>;
  };
} {
  return {
    messages: {
      async create(input: AnthropicMessageInput): Promise<AnthropicMessageOutput> {
        const grokMessages: GrokMessage[] = [];

        const systemText = flattenSystem(input.system);
        if (systemText) {
          grokMessages.push({ role: "system", content: systemText });
        }

        const rawMessages = Array.isArray(input.messages) ? input.messages : [];
        for (const m of rawMessages) {
          if (!m || typeof m !== "object") continue;
          const role = (m as { role?: string }).role;
          const content = flattenContent((m as { content?: unknown }).content);
          if (role === "user" || role === "assistant" || role === "system") {
            grokMessages.push({ role, content });
          }
        }

        const model = typeof input.model === "string" ? (input.model as string) : undefined;
        const temperature = typeof input.temperature === "number" ? (input.temperature as number) : undefined;
        const maxTokens =
          typeof input.max_tokens === "number" ? (input.max_tokens as number) : undefined;

        const completion = await createGrokChatCompletion(grokMessages, {
          model,
          temperature,
          max_tokens: maxTokens,
        });

        const text = completion.choices?.[0]?.message?.content ?? "";
        return {
          content: [{ type: "text", text }],
          usage: {
            input_tokens: completion.usage?.prompt_tokens ?? 0,
            output_tokens: completion.usage?.completion_tokens ?? 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        };
      },
    },
  };
}
