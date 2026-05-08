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
 *   - ANTHROPIC_API_KEY missing in production
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
      // WARN, not FAIL.  The exit monitor's writes are already wrapped in
      // try/catch and reads tolerate missing data (treated as fresh state),
      // so a missing exitState column means "trailing stops won't persist
      // across ticks" rather than "the bot crashes".  Crashing the deploy
      // for a column that's only consulted by the exit monitor would block
      // the operator from ever shipping a release that adds the column.
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

function checkAiReviewerKey(): SelfTestCheck {
  if (ENV.anthropicApiKey.length > 0) {
    return { name: "ai_reviewer_key", status: "ok", detail: "ANTHROPIC_API_KEY is set." };
  }
  if (ENV.isProduction) {
    return {
      name: "ai_reviewer_key",
      status: "fail",
      detail:
        "ANTHROPIC_API_KEY is unset in production.  The AI reviewer is the gate before any live order — every autonomy cycle will fail closed until this is set.",
    };
  }
  return { name: "ai_reviewer_key", status: "warn", detail: "ANTHROPIC_API_KEY unset (dev mode — autonomy will skip AI review)." };
}

function checkAiReviewerModel(): SelfTestCheck {
  return {
    name: "ai_reviewer_model",
    status: "ok",
    detail: `CLAUDE_MODEL = ${ENV.anthropicModel} (triage=${ENV.anthropicTriageModel}, deep=${ENV.anthropicDeepModel})`,
  };
}

function checkGrokTeamMode(): SelfTestCheck {
  if (!ENV.enableGrokTeam) {
    return {
      name: "grok_team_mode",
      status: "ok",
      detail: "ENABLE_GROK_TEAM=false; Claude is the sole reviewer.",
    };
  }
  if (ENV.xaiApiKey.length === 0) {
    return {
      name: "grok_team_mode",
      status: "warn",
      detail:
        "ENABLE_GROK_TEAM=true but XAI_API_KEY is unset.  The reviewer will degrade to Claude-only.  Set XAI_API_KEY for true dual-bot consensus, or set ENABLE_GROK_TEAM=false to make intent explicit.",
    };
  }
  return {
    name: "grok_team_mode",
    status: "ok",
    detail: `Dual-bot consensus armed — Claude (${ENV.anthropicModel}) + Grok (${ENV.grokModel}).`,
  };
}

function checkPolymarketOwnerAddress(): SelfTestCheck {
  if (ENV.polymarketOwnerAddress.length > 0) {
    if (!/^0x[a-f0-9]{40}$/.test(ENV.polymarketOwnerAddress)) {
      return {
        name: "polymarket_owner_address",
        status: "warn",
        detail:
          `POLYMARKET_OWNER_ADDRESS=${ENV.polymarketOwnerAddress.slice(0, 10)}... does not match expected EOA format (0x + 40 hex chars).  Position sync will fetch with this value but the data-api will likely return empty.`,
      };
    }
    return {
      name: "polymarket_owner_address",
      status: "ok",
      detail:
        `POLYMARKET_OWNER_ADDRESS set; position sync reconciles every order-sync tick.`,
    };
  }
  return {
    name: "polymarket_owner_address",
    status: "warn",
    detail:
      "POLYMARKET_OWNER_ADDRESS is unset; Polymarket position sync will silently no-op.  " +
      "Manual UI closes on Polymarket will desync the local DB and the exit monitor will " +
      "re-attempt to close vanished positions every cycle (logged as 'insufficient balance').  " +
      "Set this to your Polymarket proxy wallet (the address shown in the Polymarket UI under " +
      "your account / deposit page).",
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
        "PAPER_TRADE_MODE=true (global override) — every user's orders simulated; no real exchange hits.",
    };
  }
  return {
    name: "paper_trade_mode",
    status: "warn",
    detail:
      `PAPER_TRADE_MODE is OFF — owner ${ENV.ownerEmail || "(unset)"} trades LIVE by default; ` +
      "every other user is forced to paper.  Verify per-user `liveTradingEnabled` is set deliberately.",
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
  checks.push(checkGrokTeamMode());
  checks.push(checkAiDailyBudget());
  checks.push(checkCredentialEncryptionSecret());
  checks.push(checkPolymarketOwnerAddress());
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
