/**
 * Anthropic SDK adapter — Claude is the only AI reviewer (Phase 1).
 *
 * ANTHROPIC_API_KEY is a hard requirement (env validation rejects boot
 * otherwise). Cache_control + extended thinking + structured outputs all
 * flow through natively.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "./env";

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

// Lazy-init real Anthropic client. Re-used across calls; ENV.anthropicApiKey
// is read once at first construction.
let _anthropicClientInstance: Anthropic | null = null;
function getAnthropicSdk(): Anthropic {
  const key = ENV.anthropicApiKey.trim();
  if (!key) {
    throw new Error(
      "AI reviewer not configured: ANTHROPIC_API_KEY is required",
    );
  }
  if (!_anthropicClientInstance) {
    _anthropicClientInstance = new Anthropic({ apiKey: key });
  }
  return _anthropicClientInstance;
}

/**
 * Returns a thin client whose `messages.create()` matches the SDK signature
 * but throws fast when ANTHROPIC_API_KEY is unset (which env validation
 * already prevents at boot).
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
        const response = (await sdk.messages.create(
          input as unknown as Anthropic.MessageCreateParamsNonStreaming,
        )) as unknown as Anthropic.Message;
        return response as unknown as AnthropicMessageOutput;
      },
    },
  };
}
