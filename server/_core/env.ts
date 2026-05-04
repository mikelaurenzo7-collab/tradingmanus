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
  // OpenRouter API key.  OPENROUTER_API_KEY is the canonical variable;
  // ANTHROPIC_API_KEY is accepted as a backward-compatible fallback so
  // existing deployments do not need to rename their environment variable.
  openrouterApiKey: normalize(process.env.OPENROUTER_API_KEY) || normalize(process.env.ANTHROPIC_API_KEY),
  // Keep anthropicApiKey as an alias so existing call-sites compile without
  // change during the transition period.
  get anthropicApiKey() { return this.openrouterApiKey; },
  // The model served through OpenRouter.  Override via OPENROUTER_MODEL.
  // All tiers (triage / review / deep) resolve to this single model since
  // tencent/hy3-preview:free is the configured provider.
  openrouterModel: normalize(process.env.OPENROUTER_MODEL) || "tencent/hy3-preview:free",
  // Backward-compat model aliases — all resolve to openrouterModel.
  get anthropicModel() { return this.openrouterModel; },
  get anthropicTriageModel() { return this.openrouterModel; },
  get anthropicDeepModel() { return this.openrouterModel; },
  anthropicTimeoutMs: normalizePositiveInt(process.env.ANTHROPIC_TIMEOUT_MS, 12000),
  /**
   * Deep-tier timeout in milliseconds.  Defaults to 25 s.
   */
  anthropicDeepTimeoutMs: normalizePositiveInt(process.env.ANTHROPIC_DEEP_TIMEOUT_MS, 25000),
  // Feature toggles for the AI toolbelt.
  enableAiPromptCache: normalizeBoolean(process.env.ENABLE_AI_PROMPT_CACHE, true),
  enableAiCategoryRouting: normalizeBoolean(process.env.ENABLE_AI_CATEGORY_ROUTING, true),
  // Web search and extended thinking are Anthropic-only features; they are
  // disabled when routing through OpenRouter.
  enableAiWebSearch: false as boolean,
  enableAiExtendedThinking: false as boolean,
  // Per-desk persistent learning tape (loaded into the cached system prompt).
  enableAiDeskMemory: normalizeBoolean(process.env.ENABLE_AI_DESK_MEMORY, true),
  // Cheap Haiku pre-filter when the candidate batch is large.
  enableAiTriage: normalizeBoolean(process.env.ENABLE_AI_TRIAGE, true),
  aiTriageThreshold: normalizePositiveInt(process.env.AI_TRIAGE_THRESHOLD, 6),
  // Surface web_search citations in the audit-log reasoning blurb.
  enableAiCitations: normalizeBoolean(process.env.ENABLE_AI_CITATIONS, true),
  /**
   * Intra-Claude second opinion: when Sonnet approves a non-high-stakes
   * trade but tugs confidence down or moves expected value materially,
   * escalate just that single market to an Opus second pass.  Both must
   * agree to keep the trade; disagreement drops it.  Cheap, in-family
   * replacement for the OpenAI second-opinion we previously ran.
   */
  enableAiIntraEscalation: normalizeBoolean(process.env.ENABLE_AI_INTRA_ESCALATION, true),
  kalshiApiKey: normalize(process.env.KALSHI_API_KEY),
  isProduction: process.env.NODE_ENV === "production",
  gnewsApiKey: normalize(process.env.GNEWS_API_KEY),
  // Optional extra origin to add to the production CORS allow-list.
  // Set to the full base URL of your deployed frontend (e.g. https://app.example.com).
  // Vercel preview URLs (*.vercel.app) are always allowed in production regardless.
  allowedOrigin: normalize(process.env.ALLOWED_ORIGIN),
  // Optional: URL to receive webhook POST alerts for critical operational events
  // (consecutive autonomy failures, equity drops, exchange rejections).
  alertWebhookUrl: normalize(process.env.ALERT_WEBHOOK_URL),
  // Paper trading mode: when true, all orders are simulated at current market prices.
  // Simulated trades still update desk memory and learning feedback.
  paperTradeMode: normalizeBoolean(process.env.PAPER_TRADE_MODE, false),
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
    // Surface a diagnostic that tells the operator *what their runtime
    // actually sees*, not just which names we expected.  When Railway/Vercel
    // fail to inject variables (most often because a shared-variable group
    // wasn't attached to this service, or the service hasn't been
    // redeployed since the var was added), the operator's instinct is
    // "but I set those!" — proving the variable is genuinely absent from
    // process.env saves a long debugging cycle.
    const present = REQUIRED_SERVER_ENV
      .filter(([, value]) => value.length > 0)
      .map(([name]) => name);
    const otherEnvKeyCount = Object.keys(process.env).length;

    console.error(
      "[ENV] Missing required environment variables.\n" +
        `       Missing: ${missing.join(", ")}\n` +
        `       Present (from this required list): ${present.join(", ") || "(none)"}\n` +
        `       Total env vars visible to the process: ${otherEnvKeyCount}\n` +
        "       If the variables are configured in Railway/Vercel but not visible here:\n" +
        "         1. Confirm they are attached to THIS service & environment (not a sibling).\n" +
        "         2. Confirm there is no typo in the variable name (case-sensitive).\n" +
        "         3. Redeploy the service — env vars only inject at container start.\n" +
        "         4. If using shared variables, reference them as ${{shared.VAR_NAME}}\n" +
        "            in the service's Variables tab, or attach the shared-variable group."
    );

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

  if (ENV.isProduction && ENV.openrouterApiKey.length === 0) {
    console.warn(
      "[ENV] OPENROUTER_API_KEY is not set. The AI trading reviewer requires this to be configured."
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
