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
  // Strict parse (Number, not Number.parseFloat) so trailing junk like
  // "0.68abc" yields NaN → fallback, rather than silently parsing as 0.68.
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
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

// Default Anthropic model IDs.  Default review tier is Haiku 4.5 — cheapest +
// fastest model that still meets the trading reviewer's reasoning bar.  Triage
// also uses Haiku.  Deep tier escalates to Opus 4.7 for high-stakes trades
// (large notional, near-resolution, contested mid-stakes).  Override per-tier
// via CLAUDE_MODEL / CLAUDE_TRIAGE_MODEL / CLAUDE_DEEP_MODEL.
const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_CLAUDE_TRIAGE_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_CLAUDE_DEEP_MODEL = "claude-opus-4-7";

export const ENV = {
  cookieSecret: normalize(process.env.JWT_SECRET),
  credentialEncryptionSecret: normalize(
    process.env.CREDENTIAL_ENCRYPTION_SECRET
  ),
  databaseUrl: normalize(process.env.DATABASE_URL),
  ownerEmail: normalize(process.env.OWNER_EMAIL),
  ownerPassword: normalize(process.env.OWNER_PASSWORD),
  // Direct Anthropic API key.  Required for AI-reviewer-gated live trading.
  // OpenRouter has been removed; ANTHROPIC_API_KEY is the only accepted source.
  anthropicApiKey: normalize(process.env.ANTHROPIC_API_KEY),
  // Tier-aware model selection.  Reviewers pick triage/review/deep via
  // selectAnthropicModel() in aiToolbelt.ts.
  anthropicModel: normalize(process.env.CLAUDE_MODEL) || DEFAULT_CLAUDE_MODEL,
  anthropicTriageModel:
    normalize(process.env.CLAUDE_TRIAGE_MODEL) || DEFAULT_CLAUDE_TRIAGE_MODEL,
  anthropicDeepModel:
    normalize(process.env.CLAUDE_DEEP_MODEL) || DEFAULT_CLAUDE_DEEP_MODEL,
  anthropicTimeoutMs: normalizePositiveInt(
    process.env.ANTHROPIC_TIMEOUT_MS,
    12000
  ),
  anthropicDeepTimeoutMs: normalizePositiveInt(
    process.env.ANTHROPIC_DEEP_TIMEOUT_MS,
    25000
  ),
  // Grok (xAI) — direct API.  Optional; team mode is enabled by default but
  // gracefully degrades to Claude-only when XAI_API_KEY is unset.
  xaiApiKey: normalize(process.env.XAI_API_KEY),
  grokModel: normalize(process.env.GROK_MODEL) || "grok-3-latest",
  grokTimeoutMs: normalizePositiveInt(process.env.GROK_TIMEOUT_MS, 15000),
  enableGrokSolo: normalizeBoolean(process.env.ENABLE_GROK_SOLO, false),
  enableGrokTeam: normalizeBoolean(process.env.ENABLE_GROK_TEAM, true),
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
  // Anthropic-native features — re-enabled now that we're on the direct SDK.
  // Both default ON because they materially improve reviewer quality on the
  // trades that matter (high stakes, fresh news), at modest cost.
  enableAiWebSearch: normalizeBoolean(process.env.ENABLE_AI_WEB_SEARCH, true),
  enableAiExtendedThinking: normalizeBoolean(
    process.env.ENABLE_AI_EXTENDED_THINKING,
    true
  ),
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
  // Daily AI cost cap in USD.  When > 0, the scheduler throttles adaptive
  // cadence as the budget burns and skips runs entirely once 100 %
  // spent (resets at UTC midnight).  See server/_core/aiCostBudget.ts.
  // 0 (or unset) = unlimited.
  aiDailyBudgetUsd: normalizeFloat(process.env.AI_DAILY_BUDGET_USD, 0, { min: 0, max: 100000 }),
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

  if (ENV.isProduction && ENV.anthropicApiKey.length === 0) {
    console.warn(
      "[ENV] ANTHROPIC_API_KEY is not set. The AI trading reviewer requires this — autonomy will fail closed every cycle until it is configured."
    );
  }

  if (ENV.isProduction && ENV.enableGrokSolo && !ENV.xaiApiKey) {
    console.warn("[ENV] ENABLE_GROK_SOLO is true but XAI_API_KEY is not set. Grok solo mode will be disabled.");
  }

  if (ENV.isProduction && ENV.enableGrokTeam && !ENV.xaiApiKey) {
    console.warn(
      "[ENV] ENABLE_GROK_TEAM is true but XAI_API_KEY is not set. " +
      "The reviewer will degrade to Claude-only and the audit log will record solo Claude reviews. " +
      "Set XAI_API_KEY to enable true dual-bot consensus, or set ENABLE_GROK_TEAM=false to make intent explicit."
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
