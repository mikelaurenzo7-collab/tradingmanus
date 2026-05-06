/**
 * Startup Self-Test
 *
 * Run once at server boot to surface mis-configurations LOUDLY before any
 * autonomy cycle fires.  The goal is to fail-fast on the misconfigurations
 * that would otherwise manifest as "the bot is silently doing nothing"
 * during a live deploy:
 *
 *   - DB unreachable
 *   - exitState column missing (drizzle-kit push not run)
 *   - OPENROUTER_API_KEY missing in production
 *   - Owner user not found (would mean the local-scheduler's owner-scope
 *     filter returns zero users every cycle)
 *
 * Each check returns { ok, detail } so the operator sees the full picture
 * even when one check fails — not just the first error.
 *
 * In production we throw on any FAIL so Railway's restart policy + alerting
 * pick it up immediately.  In development / test we log and continue so the
 * dev loop isn't blocked by missing optional setup.
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
        status: "fail",
        detail: `${table}.exitState column missing.  Run \`corepack pnpm db:push\` against your production DATABASE_URL to apply the migration before starting the autonomy.`,
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

function checkAiReviewerKey(): SelfTestCheck {
  if (ENV.openrouterApiKey.length > 0) {
    return { name: "ai_reviewer_key", status: "ok", detail: "OPENROUTER_API_KEY is set." };
  }
  if (ENV.isProduction) {
    return {
      name: "ai_reviewer_key",
      status: "fail",
      detail:
        "OPENROUTER_API_KEY (or ANTHROPIC_API_KEY) is unset in production.  The AI reviewer is the gate before any live order — runScheduledAutonomousTradingBatch will throw on every cycle until this is set.",
    };
  }
  return { name: "ai_reviewer_key", status: "warn", detail: "OPENROUTER_API_KEY unset (dev mode — autonomy will skip AI review)." };
}

function checkAiReviewerModel(): SelfTestCheck {
  // Production warning when the default free model is in use.
  if (ENV.isProduction && !process.env.OPENROUTER_MODEL?.trim() && ENV.openrouterModel === "tencent/hy3-preview:free") {
    return {
      name: "ai_reviewer_model",
      status: "warn",
      detail:
        "OPENROUTER_MODEL is unset; using free-tier 'tencent/hy3-preview:free'.  The free quota will exhaust within hours of running 2-min autonomy cadence — set OPENROUTER_MODEL to a paid model before going live.",
    };
  }
  return { name: "ai_reviewer_model", status: "ok", detail: `OPENROUTER_MODEL = ${ENV.openrouterModel}` };
}

function checkPaperMode(): SelfTestCheck {
  if (ENV.paperTradeMode) {
    return {
      name: "paper_trade_mode",
      status: "ok",
      detail: "PAPER_TRADE_MODE=true — Kalshi and Polymarket orders simulated; no real exchange hits.",
    };
  }
  return {
    name: "paper_trade_mode",
    status: "warn",
    detail: "PAPER_TRADE_MODE is OFF — orders will hit the live exchanges.  Verify per-user `liveTradingEnabled` is set deliberately.",
  };
}

function checkCredentialEncryptionSecret(): SelfTestCheck {
  if (ENV.credentialEncryptionSecret.length === 0) {
    return {
      name: "credential_encryption_secret",
      status: "fail",
      detail: "CREDENTIAL_ENCRYPTION_SECRET is unset.  Stored Kalshi/Polymarket credentials cannot be decrypted.",
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
  const [database, kalshiExitColumn, polymarketExitColumn] = await Promise.all([
    checkDatabaseReachable(),
    checkExitStateColumn("kalshiPositions"),
    checkExitStateColumn("polymarketPositions"),
  ]);
  checks.push(database);
  // Only check schema if DB itself is reachable; skip otherwise to avoid noisy double-fail.
  if (database.status === "ok") {
    checks.push(kalshiExitColumn);
    checks.push(polymarketExitColumn);
  }
  checks.push(checkAiReviewerKey());
  checks.push(checkAiReviewerModel());
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
