const normalize = (value: string | undefined) => value?.trim() ?? "";
const normalizePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const normalizeFloat = (
  value: string | undefined,
  fallback: number,
  { min, max }: { min: number; max: number },
) => {
  const parsed = Number.parseFloat(value?.trim() ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return parsed;
};
const normalizeBoolean = (value: string | undefined, fallback = false) => {
  const trimmed = value?.trim().toLowerCase();
  if (trimmed === undefined || trimmed === "") return fallback;
  return (
    trimmed === "1" ||
    trimmed === "true" ||
    trimmed === "yes" ||
    trimmed === "on"
  );
};

export const ENV = {
  cookieSecret: normalize(process.env.JWT_SECRET),
  credentialEncryptionSecret: normalize(
    process.env.CREDENTIAL_ENCRYPTION_SECRET
  ),
  databaseUrl: normalize(process.env.DATABASE_URL),
  ownerEmail: normalize(process.env.OWNER_EMAIL),
  ownerPassword: normalize(process.env.OWNER_PASSWORD),
  openrouterApiKey:
    normalize(process.env.OPENROUTER_API_KEY) ||
    normalize(process.env.ANTHROPIC_API_KEY),
  get anthropicApiKey() {
    return this.openrouterApiKey;
  },
  openrouterModel:
    normalize(process.env.OPENROUTER_MODEL) || "tencent/hy3-preview:free",
  get anthropicModel() {
    return this.openrouterModel;
  },
  get anthropicTriageModel() {
    return this.openrouterModel;
  },
  get anthropicDeepModel() {
    return this.openrouterModel;
  },
  anthropicTimeoutMs: normalizePositiveInt(
    process.env.ANTHROPIC_TIMEOUT_MS,
    12000
  ),
  anthropicDeepTimeoutMs: normalizePositiveInt(
    process.env.ANTHROPIC_DEEP_TIMEOUT_MS,
    25000
  ),
  xaiApiKey: normalize(process.env.XAI_API_KEY),
  grokModel: normalize(process.env.GROK_MODEL) || "grok-3-latest",
  grokTimeoutMs: normalizePositiveInt(process.env.GROK_TIMEOUT_MS, 15000),
  enableGrokSolo: normalizeBoolean(process.env.ENABLE_GROK_SOLO, false),
  enableGrokTeam: normalizeBoolean(process.env.ENABLE_GROK_TEAM, true),
  // Paper graduation for non-owners
  paperGraduationWinRate: normalizePositiveInt(process.env.PAPER_GRADUATION_WIN_RATE, 55) / 100,
  paperMinTrades: normalizePositiveInt(process.env.PAPER_MIN_TRADES, 30),
  // High-leverage profit guardrails — owner can retune in Railway without a code change.
  // Values are read once at boot; redeploy after editing.  Out-of-range values fall back
  // to the defaults below (matches the prior hardcoded floor).
  profitGuardrails: {
    minPositiveEv: normalizeFloat(process.env.MIN_POSITIVE_EV, 0.035, { min: 0, max: 1 }),
    minConfidenceAfterAdjust: normalizeFloat(process.env.MIN_CONFIDENCE_AFTER_ADJUST, 0.68, { min: 0, max: 1 }),
    minDualBotAgreement: normalizeFloat(process.env.MIN_DUAL_BOT_AGREEMENT, 0.62, { min: 0, max: 1 }),
    maxPortfolioExposurePct: normalizeFloat(process.env.MAX_PORTFOLIO_EXPOSURE_PCT, 0.20, { min: 0.01, max: 1 }),
    maxCorrelatedGroupPct: normalizeFloat(process.env.MAX_CORRELATED_GROUP_PCT, 0.10, { min: 0.01, max: 1 }),
  },
  enableAiPromptCache: normalizeBoolean(
    process.env.ENABLE_AI_PROMPT_CACHE,
    true
  ),
  enableAiCategoryRouting: normalizeBoolean(
    process.env.ENABLE_AI_CATEGORY_ROUTING,
    true
  ),
  enableAiWebSearch: false,
  enableAiExtendedThinking: false,
  enableAiDeskMemory: normalizeBoolean(process.env.ENABLE_AI_DESK_MEMORY, true),
  enableAiTriage: normalizeBoolean(process.env.ENABLE_AI_TRIAGE, true),
  aiTriageThreshold: normalizePositiveInt(process.env.AI_TRIAGE_THRESHOLD, 6),
  enableAiCitations: normalizeBoolean(process.env.ENABLE_AI_CITATIONS, true),
  enableAiIntraEscalation: normalizeBoolean(
    process.env.ENABLE_AI_INTRA_ESCALATION,
    true
  ),
  kalshiApiKey: normalize(process.env.KALSHI_API_KEY),
  isProduction: process.env.NODE_ENV === "production",
  gnewsApiKey: normalize(process.env.GNEWS_API_KEY),
  // Polymarket proxy-wallet address used by the position-sync reconciliation.
  // The Polymarket data-api keys positions by EOA address (not by API key),
  // so without this set the sync silently no-ops.  Lower-cased on read so
  // case-insensitive comparisons work downstream.
  polymarketOwnerAddress: normalize(process.env.POLYMARKET_OWNER_ADDRESS).toLowerCase(),
  allowedOrigin: normalize(process.env.ALLOWED_ORIGIN),
  alertWebhookUrl: normalize(process.env.ALERT_WEBHOOK_URL),
  paperTradeMode: normalizeBoolean(process.env.PAPER_TRADE_MODE, false),
  starterCheckoutUrl: normalize(process.env.STARTER_CHECKOUT_URL),
  proCheckoutUrl: normalize(process.env.PRO_CHECKOUT_URL),
  fundCheckoutUrl: normalize(process.env.FUND_CHECKOUT_URL),
  billingPortalUrl: normalize(process.env.BILLING_PORTAL_URL),
};

const REQUIRED_SERVER_ENV = [
  ["JWT_SECRET", ENV.cookieSecret],
  ["CREDENTIAL_ENCRYPTION_SECRET", ENV.credentialEncryptionSecret],
  ["DATABASE_URL", ENV.databaseUrl],
  ["OWNER_EMAIL", ENV.ownerEmail],
  ["OWNER_PASSWORD", ENV.ownerPassword],
] as const;

export function validateServerEnv() {
  const missing = REQUIRED_SERVER_ENV.filter(
    ([, value]) => value.length === 0
  ).map(([name]) => name);

  if (missing.length > 0) {
    const present = REQUIRED_SERVER_ENV.filter(
      ([, value]) => value.length > 0
    ).map(([name]) => name);
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
        "         4. If using shared variables, reference them as ${{shared.VAR_NAME}}\n            in the service's Variables tab, or attach the shared-variable group."
    );

    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  if (ENV.isProduction && ENV.cookieSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  }

  if (ENV.isProduction && ENV.credentialEncryptionSecret.length < 32) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_SECRET must be at least 32 characters in production"
    );
  }

  if (ENV.isProduction && ENV.ownerPassword.length < 12) {
    console.warn(
      "[ENV] OWNER_PASSWORD is shorter than 12 characters. Consider using a longer password for better security in production."
    );
  }

  if (ENV.isProduction && ENV.openrouterApiKey.length === 0) {
    console.warn(
      "[ENV] OPENROUTER_API_KEY is not set. The AI trading reviewer requires this to be configured."
    );
  }

  if (
    ENV.isProduction &&
    !process.env.OPENROUTER_MODEL?.trim() &&
    ENV.openrouterModel === "tencent/hy3-preview:free"
  ) {
    console.warn(
      "[ENV] OPENROUTER_MODEL is unset; falling back to free-tier 'tencent/hy3-preview:free'. " +
        "This model has hard daily rate limits unsuitable for production trading. " +
        "Set OPENROUTER_MODEL to a paid model you have validated on OpenRouter."
    );
  }

  if (ENV.isProduction && ENV.enableGrokSolo && !ENV.xaiApiKey) {
    console.warn("[ENV] ENABLE_GROK_SOLO is true but XAI_API_KEY is not set. Grok solo mode will be disabled.");
  }

  if (ENV.isProduction && ENV.enableGrokTeam && !ENV.xaiApiKey) {
    console.warn(
      "[ENV] ENABLE_GROK_TEAM is true but XAI_API_KEY is not set. " +
      "Grok will be skipped silently and the audit log will look ensemble-enabled but only Claude reviews signals. " +
      "Set XAI_API_KEY or set ENABLE_GROK_TEAM=false to make intent explicit."
    );
  }
}

export function getCredentialEncryptionSecret() {
  const secret = ENV.credentialEncryptionSecret;

  if (!secret) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_SECRET is required for credential encryption. " +
      "Do not share this value with JWT_SECRET — they serve different purposes " +
      "and rotating one without the other would make stored credentials unreadable."
    );
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
