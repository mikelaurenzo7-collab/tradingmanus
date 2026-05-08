/**
 * Startup Self-Test (Kalshi-only, Grok-only).
 *
 * Run once at server boot to surface mis-configurations LOUDLY before any
 * autonomy cycle fires.  The goal is to fail-fast on the misconfigurations
 * that would otherwise manifest as "the bot is silently doing nothing"
 * during a live deploy:
 *
 *   - DB unreachable
 *   - exitState column missing (drizzle-kit push not run)
 *   - XAI_API_KEY missing in production
 *
 * Each check returns { ok, detail } so the operator sees the full picture
 * even when one check fails — not just the first error.
 */

import { sql } from "drizzle-orm";
import { ENV } from "./env";
import { logger } from "./logger";
import { getDb } from "../db";

export type CheckStatus = "ok" | "warn" | "fail";

export interface SelfTestCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface SelfTestResult {
  passed: boolean;
  checks: SelfTestCheck[];
}

async function checkDatabaseReachable(): Promise<SelfTestCheck> {
  try {
    const database = await getDb();
    if (!database) {
      return { name: "database", status: "fail", detail: "getDb() returned null — DATABASE_URL likely invalid." };
    }
    await database.execute(sql`SELECT 1`);
    return { name: "database", status: "ok", detail: "SELECT 1 succeeded." };
  } catch (err) {
    return {
      name: "database",
      status: "fail",
      detail: `Could not reach Postgres: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkExitStateColumn(table: string): Promise<SelfTestCheck> {
  const name = `schema.${table}.exitState`;
  try {
    const database = await getDb();
    if (!database) {
      return { name, status: "fail", detail: "DB unreachable; cannot inspect schema." };
    }
    const rows = (await database.execute(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = ${table} AND column_name = 'exitState'`,
    )) as unknown as { rows?: Array<unknown>; length?: number };
    const found = Array.isArray(rows)
      ? rows.length > 0
      : Array.isArray(rows.rows) && rows.rows.length > 0;
    if (!found) {
      return {
        name,
        status: "warn",
        detail: `${table}.exitState column missing.  The exit monitor will fall back to re-initialising state every tick (trailing stops won't ratchet).  Run \`corepack pnpm db:push\` against your production DATABASE_URL to apply the migration.`,
      };
    }
    return { name, status: "ok", detail: "exitState column present." };
  } catch (err) {
    return {
      name,
      status: "warn",
      detail: `Schema check failed (driver may not expose information_schema): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function checkGrokKey(): SelfTestCheck {
  // Grok is now the OPTIONAL legacy fallback. When ANTHROPIC_API_KEY is
  // also set, Claude is the primary reviewer and Grok is silent. When
  // ANTHROPIC_API_KEY is unset, Grok becomes the primary; in that case
  // its absence is a fail in production.
  const hasAnthropic = ENV.anthropicApiKey.length > 0;
  if (ENV.xaiApiKey.length > 0) {
    return {
      name: "grok_api_key",
      status: "ok",
      detail: hasAnthropic
        ? "XAI_API_KEY is set (legacy fallback; Claude is primary)."
        : "XAI_API_KEY is set; Grok is acting as primary reviewer (no ANTHROPIC_API_KEY).",
    };
  }
  if (!hasAnthropic && ENV.isProduction) {
    return {
      name: "grok_api_key",
      status: "fail",
      detail:
        "Neither ANTHROPIC_API_KEY nor XAI_API_KEY is set in production. AI review is disabled — every autonomy cycle will fail closed.",
    };
  }
  return {
    name: "grok_api_key",
    status: "warn",
    detail: hasAnthropic
      ? "XAI_API_KEY unset — Grok fallback unavailable. Claude is the sole reviewer (this is the default Claude-as-trader mode)."
      : "XAI_API_KEY unset (dev mode — autonomy will skip AI review).",
  };
}

function checkGrokModel(): SelfTestCheck {
  return {
    name: "grok_model",
    status: "ok",
    detail: `GROK_MODEL = ${ENV.grokModel}`,
  };
}

function checkAnthropicKey(): SelfTestCheck {
  // Claude is now the PRIMARY reviewer when ANTHROPIC_API_KEY is set.
  // Grok is the legacy fallback (used only when this key is unset, or
  // when REVIEWER_PREFER_GROK=true).
  if (ENV.anthropicApiKey.length > 0) {
    const mode = ENV.reviewerPreferGrok
      ? `legacy mode active (REVIEWER_PREFER_GROK=true) — Grok is primary, Claude on high-stakes only`
      : `Claude is the primary reviewer (Sonnet=${ENV.claudeSonnetModel}, Opus on high-stakes=${ENV.claudeOpusModel})`;
    return {
      name: "anthropic_api_key",
      status: "ok",
      detail: `ANTHROPIC_API_KEY is set; ${mode}.`,
    };
  }
  // Without ANTHROPIC_API_KEY, the system falls back to Grok as primary
  // (if XAI_API_KEY is set). In production this is a downgrade — Claude
  // is the recommended primary trader.
  if (ENV.xaiApiKey.length > 0) {
    return {
      name: "anthropic_api_key",
      status: "warn",
      detail:
        "ANTHROPIC_API_KEY unset — system is falling back to Grok as primary reviewer. " +
        "Set ANTHROPIC_API_KEY to use Claude as the trader (recommended; ~$5/mo at default cadence).",
    };
  }
  if (ENV.isProduction) {
    return {
      name: "anthropic_api_key",
      status: "fail",
      detail:
        "Neither ANTHROPIC_API_KEY nor XAI_API_KEY is set in production. AI review is disabled — every autonomy cycle will fail closed.",
    };
  }
  return {
    name: "anthropic_api_key",
    status: "warn",
    detail: "ANTHROPIC_API_KEY unset (dev mode — autonomy will skip AI review).",
  };
}

function checkAiDailyBudget(): SelfTestCheck {
  const cap = ENV.aiDailyBudgetUsd;
  if (cap <= 0) {
    return {
      name: "ai_daily_budget",
      status: "warn",
      detail:
        "AI_DAILY_BUDGET_USD is unset or 0 — there is no soft cap on daily AI spend.  Setting this (e.g. AI_DAILY_BUDGET_USD=10) auto-throttles adaptive cadence as the budget burns and skips runs entirely once exhausted, with rollover at UTC midnight.  Recommended for live trading.",
    };
  }
  return {
    name: "ai_daily_budget",
    status: "ok",
    detail: `AI_DAILY_BUDGET_USD = $${cap.toFixed(2)} per UTC day; auto-throttle armed.`,
  };
}

function checkPaperMode(): SelfTestCheck {
  if (ENV.paperTradeMode) {
    return {
      name: "paper_trade_mode",
      status: "ok",
      detail:
        "PAPER_TRADE_MODE=true — global emergency override.  All trading is paused (signals still generate, no live orders placed).",
    };
  }
  return {
    name: "paper_trade_mode",
    status: "ok",
    detail:
      "PAPER_TRADE_MODE OFF — single-owner live mode.  Set PAPER_TRADE_MODE=true to halt all real trading.",
  };
}

function checkCredentialEncryptionSecret(): SelfTestCheck {
  if (ENV.credentialEncryptionSecret.length === 0) {
    return {
      name: "credential_encryption_secret",
      status: "fail",
      detail: "CREDENTIAL_ENCRYPTION_SECRET is unset.  Stored Kalshi credentials cannot be decrypted.",
    };
  }
  if (ENV.credentialEncryptionSecret === ENV.cookieSecret) {
    return {
      name: "credential_encryption_secret",
      status: "warn",
      detail:
        "CREDENTIAL_ENCRYPTION_SECRET equals JWT_SECRET.  These should be distinct: rotating the JWT secret would also break credential decryption.",
    };
  }
  return { name: "credential_encryption_secret", status: "ok", detail: "Distinct from JWT_SECRET." };
}

export async function runStartupSelfTest(): Promise<SelfTestResult> {
  const checks: SelfTestCheck[] = [];
  // Run independent checks in parallel.
  const [database, kalshiExitColumn] = await Promise.all([
    checkDatabaseReachable(),
    checkExitStateColumn("kalshiPositions"),
  ]);
  checks.push(database);
  // Only check schema if DB itself is reachable; skip otherwise to avoid noisy double-fail.
  if (database.status === "ok") {
    checks.push(kalshiExitColumn);
  }
  checks.push(checkGrokKey());
  checks.push(checkGrokModel());
  checks.push(checkAnthropicKey());
  checks.push(checkAiDailyBudget());
  checks.push(checkCredentialEncryptionSecret());
  checks.push(checkPaperMode());

  const failed = checks.filter((c) => c.status === "fail");
  const warned = checks.filter((c) => c.status === "warn");
  const passed = failed.length === 0;

  for (const check of checks) {
    const line = `[SelfTest] ${check.status.toUpperCase().padEnd(4)} ${check.name}: ${check.detail}`;
    if (check.status === "fail") logger.error(line);
    else if (check.status === "warn") logger.warn(line);
    else logger.info(line);
  }

  if (failed.length > 0) {
    logger.error(
      { failed: failed.map((c) => c.name), warned: warned.map((c) => c.name) },
      "[SelfTest] %d check(s) FAILED, %d WARN(s).  Bots will not run safely.",
      failed.length,
      warned.length,
    );
  } else {
    logger.info(
      { warned: warned.map((c) => c.name) },
      "[SelfTest] all critical checks passed (%d warning(s)).",
      warned.length,
    );
  }

  return { passed, checks };
}
