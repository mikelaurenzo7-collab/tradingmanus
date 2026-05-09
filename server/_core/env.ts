/**
 * Environment configuration for the personal Kalshi-only trading dashboard.
 *
 * Single-owner Kalshi-only deployment.  Claude (Anthropic) + optional Grok
 * (xAI, breaking-news niches) are the AI reviewers.  The Kalshi Trade API
 * uses RSA-PSS signing with a private key loaded from
 * `KALSHI_PRIVATE_KEY_PATH` (preferred) or inlined via `KALSHI_PRIVATE_KEY`
 * (multi-line PEM).  Account is sized at ~$500; all %-based thresholds scale
 * automatically with live balance fetched each tick.
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

  // ── Claude (sole AI reviewer, Phase 1+) ──────────────────────────────────
  // ANTHROPIC_API_KEY is REQUIRED. The pipeline runs:
  //   Tier 1 — Claude Haiku 4.5     — every signal (cheap, fast).
  //   Tier 2 — Claude Sonnet 4.6    — high-stakes signals (cross-tier).
  //   Tier 3 — Claude Opus 4.7      — catastrophic-bet unanimous gate, or
  //                                   intra-Claude tiebreaker on contested
  //                                   high-EV approvals.
  anthropicApiKey: normalize(process.env.ANTHROPIC_API_KEY),
  // Haiku 4.5 is the default primary reviewer (Tier 1) on every signal —
  // 3× cheaper than Sonnet, fast enough that the 10-min cron still has
  // headroom. Opus 4.7 reserves for high-edge candidates only.
  claudeHaikuModel:
    normalize(process.env.CLAUDE_HAIKU_MODEL) || "claude-haiku-4-5",
  // Sonnet kept available for callers that explicitly want it (the
  // ensemble's high-stakes Tier 2 still uses Sonnet).
  claudeSonnetModel:
    normalize(process.env.CLAUDE_SONNET_MODEL) || "claude-sonnet-4-6",
  claudeOpusModel: normalize(process.env.CLAUDE_OPUS_MODEL) || "claude-opus-4-7",
  // Opus is gated on gross-EV-after-Haiku to control cost. Default 5 %:
  // only candidates with ≥5 % gross EV after the Haiku review get the
  // expensive Opus second-pass / catastrophic-bet treatment.
  opusEscalationMinGrossEv: normalizeFloat(
    process.env.OPUS_ESCALATION_MIN_GROSS_EV,
    0.07, // 7% (Phase 1.5 tightened from 5%). When Sonnet contests a
    // Tier-1 approval, only escalate to Opus if the gross EV is meaty
    // enough to be worth Opus's per-call cost (~12× Sonnet).
    { min: 0, max: 1 },
  ),
  claudeHaikuTimeoutMs: normalizePositiveInt(
    process.env.CLAUDE_HAIKU_TIMEOUT_MS,
    15000,
  ),
  // Phase 1.5 — Haiku self-consistency on Tier 1.  Two parallel calls at
  // different temperatures; both must approve to clear Tier 1.  When passes
  // disagree (`split`), the signal auto-escalates to Sonnet for a tiebreaker
  // instead of being plain-vetoed — disagreement IS a useful signal.
  claudeHaikuSelfConsistencyEnabled: normalizeBoolean(
    process.env.CLAUDE_HAIKU_SELF_CONSISTENCY_ENABLED,
    true,
  ),
  claudeHaikuSelfConsistencyTemp1: normalizeFloat(
    process.env.CLAUDE_HAIKU_SELF_CONSISTENCY_TEMP1,
    0.2,
    { min: 0, max: 1.5 },
  ),
  claudeHaikuSelfConsistencyTemp2: normalizeFloat(
    process.env.CLAUDE_HAIKU_SELF_CONSISTENCY_TEMP2,
    0.7,
    { min: 0, max: 1.5 },
  ),
  claudeHaikuSelfConsistencyEscalateOnSplit: normalizeBoolean(
    process.env.CLAUDE_HAIKU_SELF_CONSISTENCY_ESCALATE_ON_SPLIT,
    true,
  ),
  claudeSonnetTimeoutMs: normalizePositiveInt(
    process.env.CLAUDE_SONNET_TIMEOUT_MS,
    20000,
  ),
  claudeOpusTimeoutMs: normalizePositiveInt(
    process.env.CLAUDE_OPUS_TIMEOUT_MS,
    45000,
  ),

  // ── Grok (xAI) — Real-time information specialist ────────────────────────
  // Optional. When enabled, Grok 4 handles Tier-2 review for breaking-news
  // niches (Weather, Sports, Economics) where real-time X/Twitter info +
  // NOAA data provides edge. For non-breaking-news high-stakes (Politics,
  // Other), Claude Opus handles Tier-2 depth reasoning.
  xaiApiKey: normalize(process.env.XAI_API_KEY),
  grokModel: normalize(process.env.GROK_MODEL) || "grok-4-latest",
  grokReviewerEnabled: normalizeBoolean(
    process.env.GROK_REVIEWER_ENABLED,
    false, // Default OFF — must opt-in explicitly after Phase B shadow-mode validation
  ),
  grokTimeoutMs: normalizePositiveInt(process.env.GROK_TIMEOUT_MS, 25000),

  // ── High-stakes triggers (all percentages — auto-scale with live balance) ─
  // A signal is high-stakes (→ Tier-2 review) if any of these hold:
  highStakesPctOfCapital: normalizeFloat(
    process.env.HIGH_STAKES_PCT_OF_CAPITAL,
    0.02, // 2% of live capital (Phase 1.5 tightened from 3%). At $300 = $6;
    // at $1000 = $20; at $5000 = $100. Tighter threshold concentrates Sonnet
    // review on more borderline trades — pairs with Haiku self-consistency.
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
    2160, // 36 h (Phase 1.5 tightened from 24 h). Mispricing collapses
    // fastest in the last 1-2 days; widen the window so Sonnet sees the
    // entire pre-resolution acceleration.
  ),
  // Catastrophic-bet trigger (→ Opus unanimous gate, 3-tier consensus).
  catastrophicPctOfCapital: normalizeFloat(
    process.env.CATASTROPHIC_PCT_OF_CAPITAL,
    0.08, // 8% of live capital (Phase 1.5 tightened from 10%). At $300 =
    // $24; small bankroll → tighter trigger so Opus sees more of the
    // largest bets before they fire.
    { min: 0.02, max: 0.5 },
  ),

  // ── Profit guardrails (aggressive small-account tuning) ──────────────────
  // Defaults tuned for a <$1000 risk-tolerant account where the goal is
  // maximum intelligent trade volume.  Override individually for stricter
  // posture; the dashboard exposes per-user knobs that take precedence.
  profitGuardrails: {
    // Net-EV floor (after Kalshi fees + amortized AI cost).  Default 2 % —
    // aggressive volume mode.  The dual-bot Claude+Grok consensus + the
    // confidence floor + drawdown breakers are the real safety net; a
    // tight EV floor on top costs ~40 % of legitimate volume on a small
    // account.  Raise to 0.05 for conservative posture.
    minNetEv: normalizeFloat(process.env.MIN_NET_EV, 0.02, { min: 0, max: 1 }),
    minPositiveEv: normalizeFloat(process.env.MIN_NET_EV, 0.02, {
      min: 0,
      max: 1,
    }),
    // Confidence floor after AI adjustment.  0.70 — every signal still has
    // to clear two independent reviewers (Claude + Grok), so 0.70 here
    // means "both reviewers agreed and the joint posterior is ≥0.70".
    minConfidenceAfterAdjust: normalizeFloat(
      process.env.MIN_CONFIDENCE_AFTER_ADJUST,
      0.70,
      { min: 0, max: 1 },
    ),
    // 35% total exposure (was 25%): at $500 we want 3-7 concurrent
    // positions to compound properly. 35% allows up to 7 × 5% positions.
    maxPortfolioExposurePct: normalizeFloat(
      process.env.MAX_PORTFOLIO_EXPOSURE_PCT,
      0.35,
      { min: 0.01, max: 1 },
    ),
    // 15% per correlated group (was 10%): allows 2-3 concurrent correlated
    // positions (e.g., two NFP markets, or two hurricane markets).
    maxCorrelatedGroupPct: normalizeFloat(
      process.env.MAX_CORRELATED_GROUP_PCT,
      0.15,
      { min: 0.01, max: 1 },
    ),
    // Half-Kelly (0.5).  Long-run growth rate ~85 % of full-Kelly with
    // 4× less drawdown variance.  Best fit for a calibrated dual-bot
    // reviewer and a small high-risk-tolerance account.  KELLY_FRACTION=
    // 0.65 for two-thirds Kelly, 0.25 for quarter-Kelly.
    kellyFraction: normalizeFloat(process.env.KELLY_FRACTION, 0.5, {
      min: 0.05,
      max: 1,
    }),
    // 25 % cap (was 8 %).  At <$1000 with high risk tolerance the operator
    // wants Kelly to bind on edge magnitude, not on an artificially-low
    // ceiling.  MAX_RISK_PER_TRADE_PERCENT (below) is an additional outer
    // cap layered on top so a misbehaving signal can't blow up the bankroll.
    kellyMaxPctOfCapital: normalizeFloat(
      process.env.KELLY_MAX_PCT_OF_CAPITAL,
      0.25,
      { min: 0.005, max: 0.5 },
    ),
    // 1% floor: at $500 = $5 minimum.  Below $5 the round-trip fee eats
    // more than the edge even on a 10% EV trade.
    kellyMinPctOfCapital: normalizeFloat(
      process.env.KELLY_MIN_PCT_OF_CAPITAL,
      0.01,
      { min: 0, max: 0.05 },
    ),
    // Drawdown circuit breakers: pause new trades on these losses.
    // 5% daily / 12% weekly — slightly wider than the earlier conservative
    // 3%/8% because at $500 a single bad trade can hit 5% naturally;
    // too-tight breakers pause the system on normal variance.
    dailyDrawdownPauseFrac: normalizeFloat(
      process.env.DAILY_DRAWDOWN_PAUSE_FRAC,
      0.05,
      { min: 0.005, max: 0.5 },
    ),
    weeklyDrawdownPauseFrac: normalizeFloat(
      process.env.WEEKLY_DRAWDOWN_PAUSE_FRAC,
      0.12,
      { min: 0.01, max: 0.5 },
    ),
    // Cold streak: pause after 6 consecutive losses (was 5 — at $500 we
    // need more volume to compound; small-account normal variance touches
    // 4-5 losses even on profitable strategies).
    coldStreakLossCount: normalizePositiveInt(
      process.env.COLD_STREAK_LOSS_COUNT,
      6,
    ),
    coldStreakMinRealizedEdgePct: normalizeFloat(
      process.env.COLD_STREAK_MIN_REALIZED_EDGE_PCT,
      0.03,
      { min: 0, max: 1 },
    ),
    // Outer cap on Kelly-sized order budget, expressed as % of live capital.
    // This is the absolute hardest constraint — even if Kelly suggests
    // 25 % and capital fraction allows it, no single order will ever
    // exceed this fraction of the account.  Default 4 % (≈$40 on a
    // $1000 account).  Set MAX_RISK_PER_TRADE_PERCENT=8 in env to allow
    // Kelly to bind up to its cap; lower for stricter posture.
    maxRiskPerTradePct: normalizeFloat(
      process.env.MAX_RISK_PER_TRADE_PERCENT,
      4,
      { min: 0.1, max: 25 },
    ) / 100,
    // Minimum aggregate liquidity (USD volume + open interest) required
    // to consider a market actionable.  Below this floor, fills are
    // unreliable, spreads blow out, and the AI cost > expected edge.
    // $40k is the empirical sweet spot on Kalshi for a small account.
    minLiquidityUsd: normalizeFloat(
      process.env.MIN_LIQUIDITY_USD,
      40_000,
      { min: 0, max: 10_000_000 },
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

  // ── Coinbase scaffolding (Phase 10 — architectural only, NOT yet wired) ──
  // Live placement is gated behind `enableCoinbaseLive` even when creds
  // are present.  Sandbox mode routes orders to Coinbase's testnet so
  // the operator can validate the integration without real funds.
  enableCoinbaseLive: normalizeBoolean(process.env.ENABLE_COINBASE_LIVE, false),
  coinbaseSandboxMode: normalizeBoolean(process.env.COINBASE_SANDBOX_MODE, true),

  // ── Dynamic scanner (5 base / 7-8 conditional) ───────────────────────────
  // Profit-maximised scanner: 10 base / 20 max analyses per day.
  // Higher than the earlier conservative 5/8 because at $500 with ~60s
  // autonomy interval we have capacity to evaluate more opportunities;
  // the AI cost gate (aiCostBudget) caps the actual AI spend regardless.
  scannerBaseAnalysesPerDay: normalizePositiveInt(
    process.env.SCANNER_BASE_ANALYSES_PER_DAY,
    10,
  ),
  scannerMaxAnalysesPerDay: normalizePositiveInt(
    process.env.SCANNER_MAX_ANALYSES_PER_DAY,
    20,
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
  // ── Misc ──────────────────────────────────────────────────────────────────
  gnewsApiKey: normalize(process.env.GNEWS_API_KEY),
  // Global emergency kill-switch: when true, ALL trading is paused (still
  // sees signals, never places live orders). For a single-owner live system
  // this is the only "paper" toggle that matters.
  paperTradeMode: normalizeBoolean(process.env.PAPER_TRADE_MODE, false),

};

// Hard-required vars that must be present for any deploy.
const REQUIRED_SERVER_ENV = [
  ["JWT_SECRET", ENV.cookieSecret],
  ["CREDENTIAL_ENCRYPTION_SECRET", ENV.credentialEncryptionSecret],
  ["DATABASE_URL", ENV.databaseUrl],
  ["OWNER_EMAIL", ENV.ownerEmail],
  ["OWNER_PASSWORD", ENV.ownerPassword],
] as const;

export function validateServerEnv() {
  const missing: string[] = REQUIRED_SERVER_ENV
    .filter(([, value]) => value.length === 0)
    .map(([name]) => String(name));

  // Anthropic is the sole AI provider after Phase 1.
  if (ENV.anthropicApiKey.length === 0) {
    missing.push("ANTHROPIC_API_KEY");
  }

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
