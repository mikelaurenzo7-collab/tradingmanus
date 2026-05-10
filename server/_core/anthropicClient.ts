import { ENV } from "./env";
import { createOpenRouterClient } from "./openRouterClient";

type AnthropicMessageInput = {
  model?: unknown;
  max_tokens?: unknown;
  temperature?: unknown;
  system?: unknown;
  messages?: Array<{ role?: unknown; content?: unknown }>;
};

type AnthropicMessageOutput = {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    [key: string]: unknown;
  };
  model?: string;
  [key: string]: unknown;
};

function normalizeSystemPrompt(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (typeof entry === "object" && entry !== null && "text" in entry) {
          return typeof (entry as { text?: unknown }).text === "string"
            ? String((entry as { text?: unknown }).text)
            : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
}

export function createAnthropicClient(apiKey: string): {
  messages: {
    create: (input: AnthropicMessageInput) => Promise<AnthropicMessageOutput>;
  };
} {
  const client = createOpenRouterClient({
    apiKey: apiKey.trim() || ENV.openRouterApiKey,
  });

  return {
    messages: {
      async create(input: AnthropicMessageInput): Promise<AnthropicMessageOutput> {
        const systemPrompt = normalizeSystemPrompt(input.system);
        const response = await client.chat({
          model:
            typeof input.model === "string" && input.model.trim().length > 0
              ? input.model.trim()
              : ENV.openRouterQuantModel,
          maxTokens: Number(input.max_tokens ?? 900) || 900,
          temperature: Number(input.temperature ?? 0) || 0,
          messages: [
            ...(systemPrompt
              ? [{ role: "system" as const, content: systemPrompt }]
              : []),
            ...((input.messages ?? [])
              .filter((message) => typeof message.content === "string")
              .map((message) => {
                const role =
                  message.role === "assistant"
                    ? ("assistant" as const)
                    : ("user" as const);
                return {
                  role,
                  content: String(message.content),
                };
              })),
          ],
        });

        return {
          content: [{ type: "text", text: response.content }],
          usage: {
            input_tokens: response.inputTokens,
            output_tokens: response.outputTokens,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          model: response.model,
        };
      },
    },
  };
}