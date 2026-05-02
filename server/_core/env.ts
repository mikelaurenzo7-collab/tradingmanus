const normalize = (value: string | undefined) => value?.trim() ?? "";
const normalizePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const normalizeBoolean = (value: string | undefined, fallback = false) => {
  const trimmed = value?.trim().toLowerCase();
  if (trimmed === undefined || trimmed === "") return fallback;
  return trimmed === "1" || trimmed === "true" || trimmed === "yes" || trimmed === "on";
};

export const ENV = {
  cookieSecret: normalize(process.env.JWT_SECRET),
  credentialEncryptionSecret: normalize(process.env.CREDENTIAL_ENCRYPTION_SECRET),
  databaseUrl: normalize(process.env.DATABASE_URL),
  ownerEmail: normalize(process.env.OWNER_EMAIL),
  ownerPassword: normalize(process.env.OWNER_PASSWORD),
  cronSecret: normalize(process.env.CRON_SECRET),
  openaiApiKey: normalize(process.env.OPENAI_API_KEY),
  openaiModel: normalize(process.env.OPENAI_MODEL) || "gpt-4.1-mini",
  openaiTimeoutMs: normalizePositiveInt(process.env.OPENAI_TIMEOUT_MS, 12000),
  anthropicApiKey: normalize(process.env.ANTHROPIC_API_KEY),
  anthropicModel: normalize(process.env.ANTHROPIC_MODEL) || "claude-sonnet-4-5",
  anthropicTimeoutMs: normalizePositiveInt(process.env.ANTHROPIC_TIMEOUT_MS, 12000),
  // Tiered Claude models for the per-category trading reviewers.
  // Triage: cheap/fast Haiku for large candidate sets and low-stakes filtering.
  // Deep: Opus for high-stakes trades that warrant extended thinking.
  anthropicTriageModel: normalize(process.env.ANTHROPIC_TRIAGE_MODEL),
  anthropicDeepModel: normalize(process.env.ANTHROPIC_DEEP_MODEL),
  // Feature toggles for the AI toolbelt.
  enableAiPromptCache: normalizeBoolean(process.env.ENABLE_AI_PROMPT_CACHE, true),
  enableAiCategoryRouting: normalizeBoolean(process.env.ENABLE_AI_CATEGORY_ROUTING, true),
  // Defaults are ON now that Claude is the primary reviewer; both features are
  // gated per-call by stakes / availability inside aiToolbelt.
  enableAiWebSearch: normalizeBoolean(process.env.ENABLE_AI_WEB_SEARCH, true),
  enableAiExtendedThinking: normalizeBoolean(process.env.ENABLE_AI_EXTENDED_THINKING, true),
  // Per-desk persistent learning tape (loaded into the cached system prompt).
  enableAiDeskMemory: normalizeBoolean(process.env.ENABLE_AI_DESK_MEMORY, true),
  // Cheap Haiku pre-filter when the candidate batch is large.
  enableAiTriage: normalizeBoolean(process.env.ENABLE_AI_TRIAGE, true),
  aiTriageThreshold: normalizePositiveInt(process.env.AI_TRIAGE_THRESHOLD, 12),
  // Surface web_search citations in the audit-log reasoning blurb.
  enableAiCitations: normalizeBoolean(process.env.ENABLE_AI_CITATIONS, true),
  kalshiApiKey: normalize(process.env.KALSHI_API_KEY),
  isProduction: process.env.NODE_ENV === "production",
  gnewsApiKey: normalize(process.env.GNEWS_API_KEY),
  // Optional: URL to receive webhook POST alerts for critical operational events
  // (consecutive autonomy failures, equity drops, exchange rejections).
  alertWebhookUrl: normalize(process.env.ALERT_WEBHOOK_URL),
};

const REQUIRED_SERVER_ENV = [
  ["JWT_SECRET", ENV.cookieSecret],
  ["CREDENTIAL_ENCRYPTION_SECRET", ENV.credentialEncryptionSecret],
  ["DATABASE_URL", ENV.databaseUrl],
  ["OWNER_EMAIL", ENV.ownerEmail],
  ["OWNER_PASSWORD", ENV.ownerPassword],
] as const;

export function validateServerEnv() {
  const missing = REQUIRED_SERVER_ENV.filter(([, value]) => value.length === 0).map(
    ([name]) => name
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  if (ENV.isProduction && ENV.cookieSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  }

  if (ENV.isProduction && ENV.credentialEncryptionSecret.length < 32) {
    throw new Error("CREDENTIAL_ENCRYPTION_SECRET must be at least 32 characters in production");
  }

  if (ENV.isProduction && ENV.ownerPassword.length < 12) {
    console.warn(
      "[ENV] OWNER_PASSWORD is shorter than 12 characters. Consider using a longer password for better security in production."
    );
  }

  // Vercel cron jobs authenticate via `Authorization: Bearer ${CRON_SECRET}`.
  // Without this secret the cron handler falls through to JWT auth and silently
  // 401s on every scheduled tick — autonomous trading would never run.
  if (ENV.isProduction && ENV.cronSecret.length < 32) {
    console.warn(
      "[ENV] CRON_SECRET is not set or is shorter than 32 characters. " +
        "Vercel cron-triggered autonomous trading will not work until CRON_SECRET is configured in the Vercel environment."
    );
  }

  if (ENV.isProduction && ENV.openaiApiKey.length === 0) {
    console.warn(
      "[ENV] OPENAI_API_KEY is not set. The duo AI trading reviewer requires this to be configured."
    );
  }

  if (ENV.isProduction && ENV.anthropicApiKey.length === 0) {
    console.warn(
      "[ENV] ANTHROPIC_API_KEY is not set. The duo AI trading reviewer requires this to be configured."
    );
  }
}

export function getCredentialEncryptionSecret() {
  const secret = ENV.credentialEncryptionSecret || ENV.cookieSecret;

  if (!secret) {
    throw new Error("CREDENTIAL_ENCRYPTION_SECRET or JWT_SECRET is required for credential encryption");
  }

  return secret;
}

export function getKalshiApiKey() {
  if (!ENV.kalshiApiKey) {
    if (process.env.NODE_ENV === "test") {
      return "test-kalshi-api-key";
    }
    throw new Error("KALSHI_API_KEY is required for Kalshi trading actions");
  }

  return ENV.kalshiApiKey;
}
