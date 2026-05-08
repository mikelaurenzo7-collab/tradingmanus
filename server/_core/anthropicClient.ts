/**
 * Anthropic SDK adapter.
 *
 * Thin wrapper around `@anthropic-ai/sdk` that exposes the same
 * `{messages: {create(...)}}` surface the trading reviewers use.  All
 * Anthropic-native features (prompt caching via `cache_control`, extended
 * thinking, hosted `web_search_20250305` tool, citations) are passed through
 * to the SDK directly — no shape conversion is needed because the reviewers
 * have always built Anthropic-shaped requests.
 *
 * Why a wrapper at all?
 *   1. Keeps callsites short — reviewers do not need to import `Anthropic`
 *      themselves, and tests can swap in a mock client by passing
 *      `anthropicClient: ...` instead of the real one.
 *   2. Loosens the SDK's strict request typing at the boundary.  The
 *      reviewers build their request as `Record<string, unknown>` so they
 *      can conditionally omit `thinking`, `tools`, `system` blocks, etc.
 *      without per-feature type unions; the wrapper accepts that shape and
 *      forwards it untyped to the SDK, which validates at runtime.
 */

import Anthropic from "@anthropic-ai/sdk";

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

export function createAnthropicClient(apiKey: string): {
  messages: {
    create: (input: AnthropicMessageInput) => Promise<AnthropicMessageOutput>;
  };
} {
  const sdk = new Anthropic({ apiKey });

  return {
    messages: {
      async create(input: AnthropicMessageInput): Promise<AnthropicMessageOutput> {
        // The SDK's typed signature is intentionally strict; the reviewers
        // build their request dynamically (conditional `thinking`/`tools`/
        // multi-block `system`) so we forward as-is and let the SDK validate.
        const response = await sdk.messages.create(
          input as unknown as Anthropic.MessageCreateParamsNonStreaming,
        );
        return response as unknown as AnthropicMessageOutput;
      },
    },
  };
}
