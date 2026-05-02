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
  // Gate cross-platform arbitrage execution behind the Claude arbitrage desk.
  // ON by default — multi-leg trades are too easy to misjudge to ship without
  // AI sign-off.  When ON but ANTHROPIC_API_KEY is missing the reviewer
  // returns an empty list (fail-closed), so executeCrossArb refuses to fire.
  enableAiArbitrageReview: normalizeBoolean(process.env.ENABLE_AI_ARBITRAGE_REVIEW, true),
  // Minimum sizeFraction the arbitrage reviewer must return for a trade to
  // proceed.  Anything lower is treated as a soft veto.
  aiArbitrageMinSizeFraction: (() => {
    const parsed = Number.parseFloat(process.env.AI_ARBITRAGE_MIN_SIZE_FRACTION ?? "");
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : 0.1;
  })(),
  // Shadow trading mode: full pipeline runs but order placement is replaced
  // by an audit-log entry.  Operators flip this to validate edge before any
  // real capital is risked.  Default OFF so existing live-trading installs
  // are unaffected.
  shadowTradingMode: normalizeBoolean(process.env.SHADOW_TRADING_MODE, false),
  // Kelly-fractional position sizing.  When ON, each candidate's bet size
  // is shrunk to the Kelly-fractional recommendation (capped by the
  // existing per-trade and equity-fraction limits).  Default OFF — flip
  // this on once shadow-mode results justify it.
  enableKellySizing: normalizeBoolean(process.env.ENABLE_KELLY_SIZING, false),
  // Fraction of full Kelly to deploy (1.0 = full, 0.25 = quarter).  Lower
  // values trade theoretical growth for survivability.  Default 0.25.
  kellyFraction: (() => {
    const parsed = Number.parseFloat(process.env.KELLY_FRACTION ?? "");
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : 0.25;
  })(),
  // Calibrate signal.confidence against the user's historical hit rate
  // before passing it to Kelly.  Falls back to identity when there isn't
  // enough closed-trade history yet (< 10 trades).
  enableConfidenceCalibration: normalizeBoolean(process.env.ENABLE_CONFIDENCE_CALIBRATION, true),
  // Hard cap on any single bet as a fraction of equity, regardless of
  // Kelly's recommendation.  Default 5%.
  kellyMaxFractionOfEquity: (() => {
    const parsed = Number.parseFloat(process.env.KELLY_MAX_EQUITY_FRACTION ?? "");
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : 0.05;
  })(),
  // Cold-start sizing.  Scale orders down for new accounts until either a
  // time threshold (days) or trade count is reached, whichever first.
  enableColdStartSizing: normalizeBoolean(process.env.ENABLE_COLD_START_SIZING, true),
  coldStartSizeFloor: (() => {
    const parsed = Number.parseFloat(process.env.COLD_START_SIZE_FLOOR ?? "");
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : 0.1;
  })(),
  coldStartDays: (() => {
    const parsed = Number.parseInt(process.env.COLD_START_DAYS ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  })(),
  coldStartTrades: (() => {
    const parsed = Number.parseInt(process.env.COLD_START_TRADES ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  })(),
  // Operator alerts.  When set, circuit-breaker / kill-switch /
  // shadow-flip events also POST a small JSON payload to this URL.
  // Compatible with Slack/Discord generic webhook formats.
  alertsWebhookUrl: normalize(process.env.ALERTS_WEBHOOK_URL),
  // Concentration limits.  Block new positions when an existing open
  // position is too similar (Jaccard token overlap) to the candidate, or
  // when same-category exposure exceeds the configured fraction of equity.
  enableConcentrationLimits: normalizeBoolean(process.env.ENABLE_CONCENTRATION_LIMITS, true),
  concentrationSimilarityThreshold: (() => {
    const parsed = Number.parseFloat(process.env.CONCENTRATION_SIMILARITY_THRESHOLD ?? "");
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.5;
  })(),
  concentrationCategoryCapFraction: (() => {
    const parsed = Number.parseFloat(process.env.CONCENTRATION_CATEGORY_CAP_FRACTION ?? "");
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : 0.2;
  })(),
  // Stop-loss / time-stop scanner.  Runs on its own cron tick and closes
  // open Kalshi positions that have hit either threshold.
  enableStopLossScanner: normalizeBoolean(process.env.ENABLE_STOP_LOSS_SCANNER, true),
  stopLossLossFraction: (() => {
    const parsed = Number.parseFloat(process.env.STOP_LOSS_LOSS_FRACTION ?? "");
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : 0.3;
  })(),
  stopLossMaxHoldHours: (() => {
    const parsed = Number.parseFloat(process.env.STOP_LOSS_MAX_HOLD_HOURS ?? "");
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 72;
  })(),
  kalshiApiKey: normalize(process.env.KALSHI_API_KEY),
  isProduction: process.env.NODE_ENV === "production",
  gnewsApiKey: normalize(process.env.GNEWS_API_KEY),
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
    throw new Error("OWNER_PASSWORD must be at least 12 characters in production");
  }

  // Vercel cron jobs authenticate via `Authorization: Bearer ${CRON_SECRET}`.
  // Without this secret the cron handler falls through to JWT auth and silently
  // 401s on every scheduled tick — autonomous trading would never run.
  if (ENV.isProduction && ENV.cronSecret.length < 32) {
    throw new Error(
      "CRON_SECRET must be at least 32 characters in production. Autonomous trading will not work without a strong CRON_SECRET."
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
