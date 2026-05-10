import OpenAI from "openai";
import { ENV } from "./env";
import { logger as defaultLogger } from "./logger";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_MIN_CALL_GAP_MS = 5_000;
const OPENROUTER_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 20_000;

export type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OpenRouterChatOptions = {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  responseFormat?: "json_object" | "text";
};

export type OpenRouterChatResult = {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type LoggerLike = {
  warn: (...args: unknown[]) => void;
};

export type OpenRouterClient = {
  chat(options: OpenRouterChatOptions): Promise<OpenRouterChatResult>;
};

let sharedClient: OpenAI | null = null;
let sharedClientKey = "";
let requestQueue: Promise<unknown> = Promise.resolve();
let lastRequestStartedAt = 0;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildDefaultHeaders() {
  const headers: Record<string, string> = {};
  if (ENV.openRouterSiteUrl) {
    headers["HTTP-Referer"] = ENV.openRouterSiteUrl;
  }
  if (ENV.openRouterAppName) {
    headers["X-Title"] = ENV.openRouterAppName;
  }
  return headers;
}

function getClient(apiKey: string) {
  if (sharedClient && sharedClientKey === apiKey) {
    return sharedClient;
  }

  sharedClient = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: buildDefaultHeaders(),
  });
  sharedClientKey = apiKey;
  return sharedClient;
}

function isRateLimitError(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const status = Number((error as { status?: unknown }).status ?? Number.NaN);
    if (status === 429) {
      return true;
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return /(^|\b)429(\b|$)|rate limit/i.test(message);
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (typeof entry === "object" && entry !== null && "text" in entry) {
          return typeof (entry as { text?: unknown }).text === "string"
            ? String((entry as { text?: unknown }).text)
            : "";
        }
        return "";
      })
      .join("\n")
      .trim();
  }

  return typeof content === "undefined" || content === null ? "" : JSON.stringify(content);
}

async function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function scheduleOpenRouterCall<T>(task: () => Promise<T>): Promise<T> {
  const run = async () => {
    const elapsedMs = Date.now() - lastRequestStartedAt;
    const waitMs = Math.max(0, OPENROUTER_MIN_CALL_GAP_MS - elapsedMs);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    lastRequestStartedAt = Date.now();
    return task();
  };

  const scheduled = requestQueue.then(run, run);
  requestQueue = scheduled.catch(() => undefined);
  return scheduled;
}

export function isOpenRouterConfigured(apiKey = ENV.openRouterApiKey) {
  return apiKey.trim().length > 0;
}

export function createOpenRouterClient(options: {
  apiKey?: string;
  logger?: LoggerLike;
} = {}): OpenRouterClient {
  const apiKey = (options.apiKey ?? ENV.openRouterApiKey).trim();
  const logger = options.logger ?? defaultLogger;

  return {
    async chat(request) {
      if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY is required for OpenRouter chat requests");
      }

      let attempts = 0;
      while (true) {
        try {
          const client = getClient(apiKey);
          const response = await scheduleOpenRouterCall(() => withTimeout(
            client.chat.completions.create({
              model: request.model,
              messages: request.messages,
              temperature: request.temperature ?? 0,
              max_tokens: request.maxTokens ?? 900,
              response_format: request.responseFormat === "json_object"
                ? { type: "json_object" }
                : undefined,
            } as never),
            Math.max(1_000, request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
            `OpenRouter ${request.model}`,
          ));

          const usage = (response as { usage?: Record<string, unknown> }).usage ?? {};
          const choice = (response as {
            choices?: Array<{ message?: { content?: unknown } }>;
            model?: unknown;
          }).choices?.[0]?.message?.content;

          return {
            content: normalizeContent(choice),
            model:
              typeof (response as { model?: unknown }).model === "string"
                ? String((response as { model?: unknown }).model)
                : request.model,
            inputTokens: Number(usage.prompt_tokens ?? 0) || 0,
            outputTokens: Number(usage.completion_tokens ?? 0) || 0,
            totalTokens: Number(usage.total_tokens ?? 0) || 0,
          };
        } catch (error) {
          if (!isRateLimitError(error) || attempts >= OPENROUTER_MAX_RETRIES) {
            throw error;
          }

          attempts += 1;
          logger.warn(
            `[OpenRouterClient] rate limited on model=${request.model}; retry ${attempts}/${OPENROUTER_MAX_RETRIES} after ${OPENROUTER_MIN_CALL_GAP_MS}ms`,
          );
          await sleep(OPENROUTER_MIN_CALL_GAP_MS);
        }
      }
    },
  };
}