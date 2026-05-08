/**
 * Grok (xAI) client - OpenAI-compatible API
 * Base URL: https://api.x.ai/v1
 * Models: grok-3-latest, grok-2-1212, etc.
 */

import { ENV } from "./env";
import { recordAiCallCost } from "./aiCostBudget";

export type GrokMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GrokChatCompletion = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export async function createGrokChatCompletion(
  messages: GrokMessage[],
  options: {
    model?: string;
    temperature?: number;
    max_tokens?: number;
    timeoutMs?: number;
  } = {}
): Promise<GrokChatCompletion> {
  const apiKey = ENV.xaiApiKey;
  if (!apiKey) {
    throw new Error("XAI_API_KEY is required for Grok calls");
  }

  const model = options.model ?? ENV.grokModel;
  const temperature = options.temperature ?? 0; // deterministic for trading reviews
  const maxTokens = options.max_tokens ?? 3200;
  const timeoutMs = options.timeoutMs ?? ENV.grokTimeoutMs;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Grok API error ${response.status}: ${errorText}`);
    }

    const completion = (await response.json()) as GrokChatCompletion;
    // Bill against the daily AI cost budget — no-op when
    // AI_DAILY_BUDGET_USD is unset.
    recordAiCallCost(
      model,
      {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      },
      { provider: "grok" },
    );
    return completion;
  } finally {
    clearTimeout(timeout);
  }
}

export function extractGrokText(completion: GrokChatCompletion): string {
  return completion.choices?.[0]?.message?.content ?? "";
}
