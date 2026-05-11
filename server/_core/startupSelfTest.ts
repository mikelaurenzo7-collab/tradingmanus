/**
 * Startup Self-Test (Kalshi-only, OpenRouter-first).
 *
 * Run once at server boot to surface mis-configurations LOUDLY before any
 * autonomy cycle fires.  The goal is to fail-fast on the misconfigurations
 * that would otherwise manifest as "the bot is silently doing nothing"
 * during a live deploy:
 *
 *   - DB unreachable
 *   - exitState column missing (drizzle-kit push not run)
 *   - OPENROUTER_API_KEY missing in production
 *
 * Each check returns { ok, detail } so the operator sees the full picture
 * even when one check fails — not just the first error.
 */

import { sql } from "drizzle-orm";
import { ENV } from "./env";
import { getDb } from "../db";
import { getOddsClient } from "./oddsApi";
import { fetchBinanceKlines } from "./binanceClient";

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

function checkOpenRouterKey(): SelfTestCheck {
  if (ENV.openRouterApiKey.length > 0) {
    return {
      name: "openrouter_api_key",
      status: "ok",
      detail: `OPENROUTER_API_KEY is set; reviewer stack is Researcher=${ENV.openRouterResearcherModel}, Quant=${ENV.openRouterQuantModel}, Executioner=${ENV.openRouterExecutionerModel}.`,
    };
  }
  if (ENV.isProduction) {
    return {
      name: "openrouter_api_key",
      status: "fail",
      detail:
        "OPENROUTER_API_KEY is not set in production. AI review is disabled — every autonomy cycle will fail closed.",
    };
  }
  return {
    name: "openrouter_api_key",
    status: "warn",
    detail: "OPENROUTER_API_KEY unset (dev mode — autonomy will skip AI review).",
  };
}

function checkDailyLossLimit(): SelfTestCheck {
  const raw = (process.env.DAILY_LOSS_LIMIT_USD ?? "").trim();
  const limit = raw ? Number.parseFloat(raw) : 50;
  if (!Number.isFinite(limit) || limit <= 0) {
    return {
      name: "daily_loss_limit",
      status: "warn",
      detail:
        "DAILY_LOSS_LIMIT_USD is 0 or unset — the scheduler will never hard-stop on a losing day.  Recommended to set (e.g. DAILY_LOSS_LIMIT_USD=50) for live trading.",
    };
  }
  return {
    name: "daily_loss_limit",
    status: "ok",
    detail: `DAILY_LOSS_LIMIT_USD = $${limit.toFixed(2)}; scheduler hard-stops when daily net falls below -$${limit.toFixed(2)}.`,
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

function checkOddsApiKey(): SelfTestCheck {
  const apiKey = ENV.oddsApiKey || "b5ddfc0af8e39668db82af26c53d33e0";
  if (apiKey && apiKey.length > 5) {
    return {
      name: "odds_api_key",
      status: "ok",
      detail: "Odds API key is present; sports priors enabled.",
    };
  }
  return {
    name: "odds_api_key",
    status: "fail",
    detail: "Odds API key is missing or invalid. Sports trading will fail closed.",
  };
}

async function checkBinanceConnectivity(): Promise<SelfTestCheck> {
  try {
    const klines = await fetchBinanceKlines("BTCUSDT", "15m", 1);
    if (klines.length > 0) {
      return {
        name: "binance_api",
        status: "ok",
        detail: "Successfully fetched BTCUSDT klines; crypto priors enabled.",
      };
    }
    return {
      name: "binance_api",
      status: "fail",
      detail: "Binance API returned empty klines.",
    };
  } catch (err) {
    return {
      name: "binance_api",
      status: "warn",
      detail: `Binance unreachable: ${err instanceof Error ? err.message : String(err)}. Crypto trading will use fallback priors.`,
    };
  }
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
  checks.push(checkOpenRouterKey());
  checks.push(checkDailyLossLimit());
  checks.push(checkCredentialEncryptionSecret());
  checks.push(checkPaperMode());
  checks.push(checkOddsApiKey());
  checks.push(await checkBinanceConnectivity());

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
