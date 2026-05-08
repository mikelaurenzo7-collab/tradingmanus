/**
 * Anthropic SDK adapter — real Claude when ANTHROPIC_API_KEY is set,
 * Grok-shim fallback otherwise.
 *
 * Historical context: an earlier "Kalshi-only / Grok-only" pivot replaced
 * the Anthropic implementation with a Grok shim that ignored the apiKey
 * and routed everything to xAI. That broke Anthropic-only deployments
 * (the autonomy fail-closed every cycle because the underlying
 * createGrokChatCompletion call threw when XAI_API_KEY was absent).
 *
 * This file now does the right thing:
 *   - ANTHROPIC_API_KEY present → real Anthropic SDK call (Claude is the
 *     primary trader; cache_control + extended thinking + structured
 *     outputs all preserved)
 *   - ANTHROPIC_API_KEY unset, XAI_API_KEY present → legacy Grok shim
 *     (translates Anthropic-shaped input into Grok's OpenAI-compatible
 *     shape, drops Anthropic-only features)
 *   - Neither key → throws on first call
 *
 * Call sites pass the API key but the active provider is determined by
 * what's actually set in ENV — passing a Grok key into a deployment that
 * also has ANTHROPIC_API_KEY set will still route through Anthropic.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "./env";
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

// Lazy-init real Anthropic client. Re-used across calls; ENV.anthropicApiKey
// is read once at first construction.
let _anthropicClientInstance: Anthropic | null = null;
function getAnthropicSdk(): Anthropic | null {
  const key = ENV.anthropicApiKey.trim();
  if (!key) return null;
  if (!_anthropicClientInstance) {
    _anthropicClientInstance = new Anthropic({ apiKey: key });
  }
  return _anthropicClientInstance;
}

/**
 * Returns a client whose `messages.create()` interface matches the legacy
 * shim's shape (so existing call sites compile unchanged) but transparently
 * picks the right backend at call time.
 *
 * Decision per-call:
 *   - ENV.anthropicApiKey present → real Anthropic SDK call
 *   - else if ENV.xaiApiKey present → Grok shim (legacy fallback)
 *   - else → throws
 */
export function createAnthropicClient(_apiKey: string): {
  messages: {
    create: (input: AnthropicMessageInput) => Promise<AnthropicMessageOutput>;
  };
} {
  return {
    messages: {
      async create(
        input: AnthropicMessageInput,
      ): Promise<AnthropicMessageOutput> {
        const sdk = getAnthropicSdk();
        if (sdk) {
          // Real Anthropic call. Pass the input through directly so
          // cache_control, extended thinking, structured outputs, and
          // tool definitions all work natively.
          const response = (await sdk.messages.create(
            input as unknown as Anthropic.MessageCreateParamsNonStreaming,
          )) as unknown as Anthropic.Message;
          // The SDK's response shape already matches AnthropicMessageOutput
          // (content blocks + usage). Cast through to satisfy the local type.
          return response as unknown as AnthropicMessageOutput;
        }

        // Legacy Grok shim path — only fires when ANTHROPIC_API_KEY is
        // unset. Translates Anthropic-shaped input into Grok's
        // OpenAI-compatible chat-completion shape.
        if (!ENV.xaiApiKey.trim()) {
          throw new Error(
            "AI reviewer not configured: neither ANTHROPIC_API_KEY nor XAI_API_KEY is set",
          );
        }
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
        const model =
          typeof input.model === "string" ? (input.model as string) : undefined;
        const temperature =
          typeof input.temperature === "number"
            ? (input.temperature as number)
            : undefined;
        const maxTokens =
          typeof input.max_tokens === "number"
            ? (input.max_tokens as number)
            : undefined;

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
