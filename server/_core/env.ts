/**
 * Environment configuration for the personal Kalshi-only trading dashboard.
 *
 * Pivot: this is a single-owner, Grok-only, Kalshi-only deployment optimized
 * for a $200 starting capital. Anthropic / Claude / Polymarket env vars have
 * been removed entirely; the Kalshi Trade API uses RSA-PSS signing with a
 * private key loaded from `KALSHI_PRIVATE_KEY_PATH` (preferred) or inlined
 * via `KALSHI_PRIVATE_KEY` (multi-line PEM).
 */

import { readFileSync } from "node:fs";

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
  // Strict parse so trailing junk like "0.68abc" yields NaN → fallback.
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

export const ENV = {
  // ── Core platform ────────────────────────────────────────────────────────
  cookieSecret: normalize(process.env.JWT_SECRET),
  credentialEncryptionSecret: normalize(
    process.env.CREDENTIAL_ENCRYPTION_SECRET,
  ),
  databaseUrl: normalize(process.env.DATABASE_URL),
  ownerEmail: normalize(process.env.OWNER_EMAIL),
  ownerPassword: normalize(process.env.OWNER_PASSWORD),
  isProduction: process.env.NODE_ENV === "production",
  allowedOrigin: normalize(process.env.ALLOWED_ORIGIN),
  alertWebhookUrl: normalize(process.env.ALERT_WEBHOOK_URL),

  // ── Kalshi (the ONLY trading platform) ───────────────────────────────────
  // Production vs demo (https://demo-api.kalshi.co) toggle. Default false.
  kalshiDemoMode: normalizeBoolean(process.env.DEMO_MODE, false),
  // Trade API key id (the "KALSHI-ACCESS-KEY" header value).
  kalshiKeyId: normalize(process.env.KALSHI_KEY_ID),
  // Path to the RSA private key PEM (preferred for local dev).
  kalshiPrivateKeyPath: normalize(process.env.KALSHI_PRIVATE_KEY_PATH),
  // Inline PEM (for Railway-style envs where filesystem secrets are awkward).
  // Either KALSHI_PRIVATE_KEY_PATH or KALSHI_PRIVATE_KEY must be set in prod.
  kalshiPrivateKey: normalize(process.env.KALSHI_PRIVATE_KEY),
  // Legacy single-key support; kept so existing tests/encrypted-credential
  // paths don't break. New deployments should use KALSHI_KEY_ID + key.
  kalshiApiKey: normalize(process.env.KALSHI_API_KEY),

  // ── Grok (Tier 1, always-on primary reviewer) ───────────────────────────
  xaiApiKey: normalize(process.env.XAI_API_KEY),
  // Default to Grok 4.1 Fast — cheap + fast + strong reasoning floor.
  grokModel: normalize(process.env.GROK_MODEL) || "grok-4-1-fast",
  grokTimeoutMs: normalizePositiveInt(process.env.GROK_TIMEOUT_MS, 15000),
  // Self-consistency: re-run the same review at a different temperature and
  // require both passes to agree before the trade clears the gate.
  grokSelfConsistencyTemp1: normalizeFloat(
    process.env.GROK_SELF_CONSISTENCY_TEMP1,
    0.2,
    { min: 0, max: 1.5 },
  ),
  grokSelfConsistencyTemp2: normalizeFloat(
    process.env.GROK_SELF_CONSISTENCY_TEMP2,
    0.7,
    { min: 0, max: 1.5 },
  ),
  // Amortized per-review Grok cost (USD). Used to subtract from net EV in
  // the post-fee guardrail and to budget the daily run-rate. Default $0.0035
  // for grok-4-1-fast at typical prompt length; tune to actual usage.
  grokCostPerReviewUsd: normalizeFloat(
    process.env.GROK_COST_PER_REVIEW_USD,
    0.0035,
    { min: 0, max: 1 },
  ),

  // ── Claude (Tier 2 + Tier 3 ensemble reviewers) ─────────────────────────
  // ANTHROPIC_API_KEY is OPTIONAL but strongly recommended. When set, the
  // ensemble runs:
  //   Tier 1 — Grok 4.1 Fast        — every signal (cheap, has live X).
  //   Tier 2 — Claude Sonnet 4.6    — only on high-stakes signals.
  //   Tier 3 — Claude Opus 4.7      — only when Grok+Sonnet disagree, OR the
  //                                   position is a catastrophic-bet
  //                                   (≥10% of live Kalshi capital).
  // When unset, the system silently degrades to Grok-only with a boot warning.
  anthropicApiKey: normalize(process.env.ANTHROPIC_API_KEY),
  claudeSonnetModel:
    normalize(process.env.CLAUDE_SONNET_MODEL) || "claude-sonnet-4-6",
  claudeOpusModel: normalize(process.env.CLAUDE_OPUS_MODEL) || "claude-opus-4-7",
  claudeSonnetTimeoutMs: normalizePositiveInt(
    process.env.CLAUDE_SONNET_TIMEOUT_MS,
    20000,
  ),
  claudeOpusTimeoutMs: normalizePositiveInt(
    process.env.CLAUDE_OPUS_TIMEOUT_MS,
    45000,
  ),
  // Legacy escape hatch: when true, the autonomy loop's primary reviewer
  // stays on Grok even if ANTHROPIC_API_KEY is also set. Default false —
  // Claude is the primary trader when its key is present.
  reviewerPreferGrok: normalizeBoolean(process.env.REVIEWER_PREFER_GROK, false),

  // ── High-stakes triggers (all percentages — auto-scale with live balance) ─
  // A signal is high-stakes (→ Sonnet review) if any of these hold:
  highStakesPctOfCapital: normalizeFloat(
    process.env.HIGH_STAKES_PCT_OF_CAPITAL,
    0.03, // 3% of live capital. At $200 = $6; at $1000 = $30; at $5000 = $150.
    { min: 0.005, max: 0.5 },
  ),
  // Legacy hard-dollar threshold. Default `Infinity` so it's effectively off
  // unless the operator opts in. Use the percentage knob above instead.
  highStakesNotionalUsd: normalizeFloat(
    process.env.HIGH_STAKES_NOTIONAL_USD,
    Number.POSITIVE_INFINITY,
    { min: 0, max: 1_000_000 },
  ),
  highStakesResolutionMinutes: normalizePositiveInt(
    process.env.HIGH_STAKES_RESOLUTION_MINUTES,
    1440, // 24 h
  ),
  // Catastrophic-bet trigger (→ Opus unanimous gate, 3-tier consensus).
  catastrophicPctOfCapital: normalizeFloat(
    process.env.CATASTROPHIC_PCT_OF_CAPITAL,
    0.1, // 10% of live capital.
    { min: 0.02, max: 0.5 },
  ),

  // ── Profit guardrails (high-edge, capital-preservation first) ────────────
  // Hard floor net EV after Kalshi fees + amortized Grok cost: 6.5%.
  // Confidence floor: 76%. These are the post-pivot tighter thresholds.
  profitGuardrails: {
    // Net-EV floor (after fees + amortized AI cost). Default 5 % — was
    // 6.5 %, which empirically rejected 5-7 % edge trades that are
    // legitimately profitable on a calibrated reviewer. The
    // MIN_CONFIDENCE_AFTER_ADJUST floor + drawdown breakers are the
    // real miscalibration safety net; layering a tight EV floor on top
    // costs ~30-40 % of legitimate volume. Set higher for conservative
    // mode, lower for more volume.
    minNetEv: normalizeFloat(process.env.MIN_NET_EV, 0.05, { min: 0, max: 1 }),
    minPositiveEv: normalizeFloat(process.env.MIN_NET_EV, 0.05, {
      min: 0,
      max: 1,
    }),
    minConfidenceAfterAdjust: normalizeFloat(
      process.env.MIN_CONFIDENCE_AFTER_ADJUST,
      0.76,
      { min: 0, max: 1 },
    ),
    minDualBotAgreement: normalizeFloat(
      process.env.MIN_DUAL_BOT_AGREEMENT,
      0.62,
      { min: 0, max: 1 },
    ),
    maxPortfolioExposurePct: normalizeFloat(
      process.env.MAX_PORTFOLIO_EXPOSURE_PCT,
      0.25,
      { min: 0.01, max: 1 },
    ),
    maxCorrelatedGroupPct: normalizeFloat(
      process.env.MAX_CORRELATED_GROUP_PCT,
      0.1,
      { min: 0.01, max: 1 },
    ),
    // Kelly sizing: ½ Kelly capped at 4% of capital, floored at 0.5%.
    // ½ Kelly is the "moderately aggressive" point — gives up ~30% of the
    // long-run growth Full Kelly would achieve in exchange for ~5× lower
    // drawdown variance, robust to ±5% reviewer probability calibration
    // error. Override with KELLY_FRACTION=0.25 for the conservative ¼ Kelly
    // default the original pivot used.
    kellyFraction: normalizeFloat(process.env.KELLY_FRACTION, 0.5, {
      min: 0.05,
      max: 1,
    }),
    kellyMaxPctOfCapital: normalizeFloat(
      process.env.KELLY_MAX_PCT_OF_CAPITAL,
      0.05,
      { min: 0.005, max: 0.15 },
    ),
    kellyMinPctOfCapital: normalizeFloat(
      process.env.KELLY_MIN_PCT_OF_CAPITAL,
      0.005,
      { min: 0, max: 0.05 },
    ),
    // Drawdown circuit breakers: pause new trades on these losses.
    dailyDrawdownPauseFrac: normalizeFloat(
      process.env.DAILY_DRAWDOWN_PAUSE_FRAC,
      0.03,
      { min: 0.005, max: 0.5 },
    ),
    weeklyDrawdownPauseFrac: normalizeFloat(
      process.env.WEEKLY_DRAWDOWN_PAUSE_FRAC,
      0.08,
      { min: 0.01, max: 0.5 },
    ),
    // Cold streak: pause after N consecutive losses or if 7-day realized
    // edge falls below this threshold.
    coldStreakLossCount: normalizePositiveInt(
      process.env.COLD_STREAK_LOSS_COUNT,
      5,
    ),
    coldStreakMinRealizedEdgePct: normalizeFloat(
      process.env.COLD_STREAK_MIN_REALIZED_EDGE_PCT,
      0.03,
      { min: 0, max: 1 },
    ),
  },

  // ── Kalshi fee schedule (override per Kalshi published rates) ────────────
  // Maker multiplier: round_up_to_cent(0.0175 × notional × yesPrice × (1−yesPrice))
  // Taker multiplier: round_up_to_cent(0.07   × notional × yesPrice × (1−yesPrice))
  kalshiMakerFeeMultiplier: normalizeFloat(
    process.env.KALSHI_MAKER_FEE_MULTIPLIER,
    0.0175,
    { min: 0, max: 1 },
  ),
  kalshiTakerFeeMultiplier: normalizeFloat(
    process.env.KALSHI_TAKER_FEE_MULTIPLIER,
    0.07,
    { min: 0, max: 1 },
  ),
  // Strongly prefer maker (limit) orders for the lower fee.
  preferMakerOrders: normalizeBoolean(process.env.PREFER_MAKER_ORDERS, true),

  // ── Daily Sports Play (playground mode, opt-in) ──────────────────────────
  // When ENABLE_DAILY_SPORTS_PLAY=true, places ONE Kalshi sports trade per
  // UTC day at the configured hour (default 14:00 UTC = 10am ET / 7am PT).
  // Sized at DAILY_SPORTS_PLAY_PCT_OF_CAPITAL (default 2.5 %) of LIVE
  // Kalshi balance. Routes through the same ensemble (Sonnet/Opus) and
  // the same risk gate stack (drawdown breakers, exposure caps,
  // MIN_NET_EV, MIN_CONFIDENCE_AFTER_ADJUST) as the regular autonomy
  // loop. Calibration loop picks up outcomes automatically.
  enableDailySportsPlay: normalizeBoolean(
    process.env.ENABLE_DAILY_SPORTS_PLAY,
    false,
  ),
  dailySportsPlayHourUtc: (() => {
    const raw = (process.env.DAILY_SPORTS_PLAY_HOUR_UTC ?? "").trim();
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) return 14;
    return parsed;
  })(),
  dailySportsPlayPctOfCapital: normalizeFloat(
    process.env.DAILY_SPORTS_PLAY_PCT_OF_CAPITAL,
    0.025,
    { min: 0.005, max: 0.1 },
  ),

  // ── Daily Moonshot Play (aggressive playground, opt-in) ───────────────
  // Once per UTC day at the configured hour, picks the highest-edge
  // underdog (any category) priced ≤ DAILY_MOONSHOT_MAX_PRICE where the
  // AI sees materially more probability than the market. Sized at a small
  // fraction of bankroll (lottery-ticket discipline). Same risk gates as
  // Daily Sports Play. Calibration loop picks up outcomes automatically.
  enableDailyMoonshot: normalizeBoolean(
    process.env.ENABLE_DAILY_MOONSHOT,
    false,
  ),
  dailyMoonshotHourUtc: (() => {
    const raw = (process.env.DAILY_MOONSHOT_HOUR_UTC ?? "").trim();
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) return 16;
    return parsed;
  })(),
  dailyMoonshotPctOfCapital: normalizeFloat(
    process.env.DAILY_MOONSHOT_PCT_OF_CAPITAL,
    0.015, // 1.5 % default — lottery-ticket sizing
    { min: 0.001, max: 0.05 },
  ),
  dailyMoonshotMaxPrice: normalizeFloat(
    process.env.DAILY_MOONSHOT_MAX_PRICE,
    0.3, // YES contracts ≤ $0.30 (or NO equivalent ≥ $0.70) qualify
    { min: 0.05, max: 0.45 },
  ),
  dailyMoonshotMinProbRatio: normalizeFloat(
    process.env.DAILY_MOONSHOT_MIN_PROB_RATIO,
    1.75, // AI prob must be ≥ 1.75× market implied (10 % market → 17.5 % AI).
    // The earlier 1.5× threshold was too permissive — pairs with the
    // higher MIN_NET_EV below to filter for genuine underdog edge.
    { min: 1.05, max: 5 },
  ),
  dailyMoonshotMinNetEv: normalizeFloat(
    process.env.DAILY_MOONSHOT_MIN_NET_EV,
    0.15, // 15 % net-EV floor — was 4 %, which did NOTHING. Real moonshots
    // produce 30-50 % net EV by structure (low-priced contract × decent
    // edge ratio = huge per-dollar EV). Below 15 % means the prob ratio
    // is barely above the gate and the trade is marginal noise.
    { min: 0, max: 1 },
  ),

  // ── Dynamic scanner (5 base / 7-8 conditional) ───────────────────────────
  // Owner override: opt-in domains where the operator's domain knowledge
  // is high enough to relax the AI gate (still honors hard guardrails).
  ownerOverrideDomains: normalize(process.env.OWNER_OVERRIDE_DOMAINS),

  scannerBaseAnalysesPerDay: normalizePositiveInt(
    process.env.SCANNER_BASE_ANALYSES_PER_DAY,
    5,
  ),
  scannerMaxAnalysesPerDay: normalizePositiveInt(
    process.env.SCANNER_MAX_ANALYSES_PER_DAY,
    8,
  ),
  scannerHighOpportunityLiquidMarkets: normalizePositiveInt(
    process.env.SCANNER_HIGH_OPP_LIQUID_MARKETS,
    18,
  ),
  scannerHighOpportunityWeeklyEdgePct: normalizeFloat(
    process.env.SCANNER_HIGH_OPP_WEEKLY_EDGE_PCT,
    0.08,
    { min: 0, max: 1 },
  ),
  // Capital-tier scaling: as the live Kalshi balance grows, the maximum
  // ramp on a high-opportunity day grows too. Bottleneck is signal supply,
  // not reviewer quality — so we don't scale the BASE rate, only the cap.
  scannerCapMidTierUsd: normalizeFloat(
    process.env.SCANNER_CAP_MID_TIER_USD,
    500,
    { min: 0, max: 1_000_000 },
  ),
  scannerCapHighTierUsd: normalizeFloat(
    process.env.SCANNER_CAP_HIGH_TIER_USD,
    2000,
    { min: 0, max: 1_000_000 },
  ),
  scannerMaxAnalysesPerDayMidTier: normalizePositiveInt(
    process.env.SCANNER_MAX_ANALYSES_PER_DAY_MID_TIER,
    10,
  ),
  scannerMaxAnalysesPerDayHighTier: normalizePositiveInt(
    process.env.SCANNER_MAX_ANALYSES_PER_DAY_HIGH_TIER,
    12,
  ),

  // ── AI cost / cadence ────────────────────────────────────────────────────
  enableAiPromptCache: normalizeBoolean(
    process.env.ENABLE_AI_PROMPT_CACHE,
    true,
  ),
  enableAiCategoryRouting: normalizeBoolean(
    process.env.ENABLE_AI_CATEGORY_ROUTING,
    true,
  ),
  enableAiWebSearch: normalizeBoolean(process.env.ENABLE_AI_WEB_SEARCH, true),
  enableAiDeskMemory: normalizeBoolean(process.env.ENABLE_AI_DESK_MEMORY, true),
  // ── AI cost: PAY-FOR-YOURSELF cap (NOT a hard spend cap) ───────────────
  // Per the impl in aiCostBudget.ts + dailyScoreboard.ts: this is the
  // daily soft cap on `effectiveOverrun = max(0, ai_cost + fees − realized_pnl)`.
  // Profitable days NEVER throttle no matter how much we spent on AI —
  // we earned the overhead. Net-negative days self-throttle as the
  // deficit widens (×1.5 at 60 % overrun, ×2 at 80 %, ×4 at 95 %, hard
  // skip at 100 %). Cold-start exemption: under $5 AI spend, no throttle.
  // Resets at UTC midnight.
  //
  // Default $5: small enough that the throttle engages quickly when AI
  // burn meaningfully outpaces realized P&L, but high enough that the
  // cold-start exemption ($5 floor) covers normal warm-up days.
  // Set to `0` to disable the cap entirely (hot days run unbounded);
  // raise to e.g. `20` if you want more room for variance before throttling.
  aiDailyBudgetUsd: normalizeFloat(process.env.AI_DAILY_BUDGET_USD, 5, {
    min: 0,
    max: 100000,
  }),

  // ── Misc ──────────────────────────────────────────────────────────────────
  gnewsApiKey: normalize(process.env.GNEWS_API_KEY),
  // Global emergency kill-switch: when true, ALL trading is paused (still
  // sees signals, never places live orders). For a single-owner live system
  // this is the only "paper" toggle that matters.
  paperTradeMode: normalizeBoolean(process.env.PAPER_TRADE_MODE, false),
};

const REQUIRED_SERVER_ENV = [
  ["JWT_SECRET", ENV.cookieSecret],
  ["CREDENTIAL_ENCRYPTION_SECRET", ENV.credentialEncryptionSecret],
  ["DATABASE_URL", ENV.databaseUrl],
  ["OWNER_EMAIL", ENV.ownerEmail],
  ["OWNER_PASSWORD", ENV.ownerPassword],
  ["XAI_API_KEY", ENV.xaiApiKey],
] as const;

export function validateServerEnv() {
  const missing = REQUIRED_SERVER_ENV.filter(
    ([, value]) => value.length === 0,
  ).map(([name]) => name);

  if (missing.length > 0) {
    const present = REQUIRED_SERVER_ENV.filter(
      ([, value]) => value.length > 0,
    ).map(([name]) => name);
    const otherEnvKeyCount = Object.keys(process.env).length;

    console.error(
      "[ENV] Missing required environment variables.\n" +
        `       Missing: ${missing.join(", ")}\n` +
        `       Present (from this required list): ${present.join(", ") || "(none)"}\n` +
        `       Total env vars visible to the process: ${otherEnvKeyCount}\n` +
        "       If the variables are configured in Railway but not visible here:\n" +
        "         1. Confirm they are attached to THIS service & environment.\n" +
        "         2. Confirm there is no typo in the variable name (case-sensitive).\n" +
        "         3. Redeploy the service — env vars only inject at container start.",
    );

    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  if (ENV.isProduction && ENV.cookieSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  }

  if (ENV.isProduction && ENV.credentialEncryptionSecret.length < 32) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_SECRET must be at least 32 characters in production",
    );
  }

  if (ENV.isProduction && ENV.ownerPassword.length < 12) {
    console.warn(
      "[ENV] OWNER_PASSWORD is shorter than 12 characters. Consider using a longer password for better security in production.",
    );
  }

  if (
    ENV.isProduction &&
    !ENV.kalshiPrivateKey &&
    !ENV.kalshiPrivateKeyPath
  ) {
    console.warn(
      "[ENV] Neither KALSHI_PRIVATE_KEY nor KALSHI_PRIVATE_KEY_PATH is set. " +
        "Kalshi trading actions will fail until one is provided.",
    );
  }

  if (ENV.isProduction && !ENV.kalshiKeyId) {
    console.warn(
      "[ENV] KALSHI_KEY_ID is not set. Kalshi private endpoints will fail closed.",
    );
  }
}

export function getCredentialEncryptionSecret() {
  const secret = ENV.credentialEncryptionSecret;
  if (!secret) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_SECRET is required for credential encryption.",
    );
  }
  return secret;
}

/**
 * Returns the Kalshi RSA private key as a PEM string.
 *
 * Resolution order:
 *   1. `KALSHI_PRIVATE_KEY` — inline PEM (preferred for Railway).
 *   2. `KALSHI_PRIVATE_KEY_PATH` — read from disk (preferred for local dev).
 */
export function getKalshiPrivateKeyPem(): string {
  if (ENV.kalshiPrivateKey) {
    // Railway-style env vars often arrive with literal "\n" sequences instead
    // of real newlines. Restore them so crypto.createPrivateKey can parse the
    // PEM correctly.
    return ENV.kalshiPrivateKey.replace(/\\n/g, "\n");
  }
  if (ENV.kalshiPrivateKeyPath) {
    return readFileSync(ENV.kalshiPrivateKeyPath, "utf8");
  }
  if (process.env.NODE_ENV === "test") {
    return "test-private-key";
  }
  throw new Error(
    "Kalshi private key missing — set KALSHI_PRIVATE_KEY (inline PEM) or KALSHI_PRIVATE_KEY_PATH",
  );
}

export function getKalshiKeyId(): string {
  if (!ENV.kalshiKeyId) {
    if (process.env.NODE_ENV === "test") {
      return "test-kalshi-key-id";
    }
    throw new Error("KALSHI_KEY_ID is required for Kalshi trading actions");
  }
  return ENV.kalshiKeyId;
}

/**
 * Legacy: callers that used to read KALSHI_API_KEY for arbitrary public
 * endpoints. Prefer getKalshiKeyId() for signed-call usage.
 */
export function getKalshiApiKey() {
  if (!ENV.kalshiApiKey) {
    if (ENV.kalshiKeyId) return ENV.kalshiKeyId;
    if (process.env.NODE_ENV === "test") {
      return "test-kalshi-api-key";
    }
    throw new Error("KALSHI_API_KEY is required for Kalshi trading actions");
  }
  return ENV.kalshiApiKey;
}

/**
 * Base URL for the Kalshi Trade API (production by default; demo when
 * `DEMO_MODE=true`).
 */
export function getKalshiBaseUrl(): string {
  return ENV.kalshiDemoMode
    ? "https://demo-api.kalshi.co/trade-api/v2"
    : "https://api.elections.kalshi.com/trade-api/v2";
}
