import { ENV } from "./env";
import { logger } from "./logger";
import type { TriageCandidate } from "./aiToolbelt";

type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenRouterChatRequest = {
  model: string;
  messages: OpenRouterMessage[];
  temperature: number;
  max_tokens: number;
  response_format?: { type: "json_object" };
};

type OpenRouterChatResponse = {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
  error?: { message?: string };
};

export function isOpenRouterTriageConfigured(): boolean {
  return Boolean(ENV.openRouterApiKey) && ENV.openRouterTriageEnabled;
}

function extractKeepSet(text: string): Set<string> | null {
  const trimmed = text.trim();
  const jsonText = trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;
  try {
    const parsed = JSON.parse(jsonText) as { keep?: unknown };
    if (!Array.isArray(parsed.keep)) return null;
    const keep = new Set<string>();
    for (const id of parsed.keep) {
      if (typeof id === "string" && id.trim()) keep.add(id.trim());
    }
    return keep;
  } catch {
    return null;
  }
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ENV.openRouterApiKey}`,
    "X-Title": ENV.openRouterAppName,
  };
  if (ENV.openRouterSiteUrl) {
    headers["HTTP-Referer"] = ENV.openRouterSiteUrl;
  }
  return headers;
}

function buildTriagePayload(candidates: TriageCandidate[]) {
  return {
    task: "Free-model pre-triage for a Kalshi trading bot. You may ONLY decide which candidates deserve paid Claude review. You do NOT approve trades.",
    keepRules: [
      "Keep if confidence >= 0.70 and expectedValue is positive.",
      "Keep if expectedValue >= 0.05 and impliedProbability is between 0.05 and 0.95.",
      "Keep if signalType indicates confluence/arbitrage/order_flow and pricing is actionable.",
      "When uncertain, keep. False negatives cost real profit; false positives merely cost paid review.",
    ],
    dropRules: [
      "Drop if expectedValue <= 0 or confidence < 0.55.",
      "Drop if impliedProbability is extreme (<0.03 or >0.97) unless confidence >= 0.85 and expectedValue >= 0.08.",
      "Drop if signal appears purely stale/heuristic with no catalyst and weak EV.",
    ],
    output: "JSON only: {\"keep\":[\"marketId\", ...]}",
    candidates,
  };
}

export async function runOpenRouterTriage(
  candidates: TriageCandidate[],
  options: { timeoutMs?: number; log?: Pick<Console, "warn"> } = {},
): Promise<Set<string> | null> {
  if (candidates.length === 0) return new Set();
  if (!isOpenRouterTriageConfigured()) return null;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, Math.min(options.timeoutMs ?? ENV.openRouterTimeoutMs, 15000)),
  );

  try {
    const request: OpenRouterChatRequest = {
      model: ENV.openRouterTriageModel,
      temperature: 0,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a conservative pre-triage filter for Kalshi prediction-market signals. Output JSON only. You cannot approve trades; you can only keep candidates for paid review. Prefer false positives over false negatives.",
        },
        { role: "user", content: JSON.stringify(buildTriagePayload(candidates)) },
      ],
    };

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 240)}`);
    }

    const data = (await res.json()) as OpenRouterChatResponse;
    if (data.error?.message) throw new Error(data.error.message);
    const text = data.choices?.[0]?.message?.content ?? "";
    const keep = extractKeepSet(text);
    if (!keep) throw new Error("OpenRouter returned malformed triage JSON");
    return keep;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (options.log ?? logger).warn(
      `[OpenRouterTriage] failed (${message}); falling back to full paid review.`,
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}