/**
 * Custom migration runner — applies SQL files from drizzle/migrations/ in
 * filename order, tracking applied versions in a `migrations_log` table.
 *
 * Uses node-postgres (pg) directly so multi-statement SQL files work
 * correctly.  The previous version used @neondatabase/serverless's HTTP
 * driver, which silently truncates multi-statement queries to just the
 * first statement — every migration with a CREATE TYPE block followed by
 * ALTER TABLEs would only run the CREATE TYPE and the runner would log it
 * as applied.  pg's simple-query protocol natively supports multi-statement
 * batches.
 *
 * Self-contained: imports only `pg` and Node built-ins so it runs in the
 * slim Docker runner image without server/db.ts or any project code.
 *
 * Operator semantics:
 *   - Adding a new migration → drop a new SQL file in drizzle/migrations/
 *     using the next sequential number (0002_, 0003_, ...).  Use
 *     `IF NOT EXISTS` / `IF EXISTS` to make the file idempotent so
 *     hand-applied changes don't break the runner.
 *   - First-deploy bootstrapping → the runner creates the migrations_log
 *     table on first run.
 *   - Recovering from a failed migration → fix the SQL, the runner will
 *     re-attempt the unmarked file on the next deploy.  Mark a file as
 *     applied manually only if you've verified the schema is in the
 *     expected state:
 *         INSERT INTO migrations_log (filename) VALUES ('0001_xxx.sql');
 */

import pg from "pg";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

async function main(): Promise<void> {
  const dbUrl = (process.env.DATABASE_URL ?? "").trim();
  if (!dbUrl) {
    console.error("[migrate] DATABASE_URL is required.");
    process.exit(1);
  }

  const migrationsDir = join(process.cwd(), "drizzle", "migrations");
  if (!existsSync(migrationsDir)) {
    console.log(`[migrate] no ${migrationsDir} directory; nothing to do.`);
    process.exit(0);
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("[migrate] no .sql files in drizzle/migrations/; nothing to do.");
    process.exit(0);
  }

  // Connect via pg.  Neon's connection strings include `?sslmode=require`;
  // pg respects that.  We connect once and reuse the client for the whole
  // run so transaction-tracking on `migrations_log` is simple.
  const client = new pg.Client({
    connectionString: dbUrl,
    // pg parses the URL's sslmode; we set rejectUnauthorized=false to be
    // tolerant of Neon's certificate chain (their CA is widely trusted but
    // some Node versions trip on intermediates without explicit allow).
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
  } catch (err) {
    console.error(
      `[migrate] connect failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  try {
    // Ensure tracking table.  Idempotent.
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations_log (
        filename    text        PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const appliedRes = await client.query<{ filename: string }>(
      "SELECT filename FROM migrations_log",
    );
    const applied = new Set(appliedRes.rows.map((r) => r.filename));

    let appliedCount = 0;
    let skippedCount = 0;

    for (const filename of files) {
      if (applied.has(filename)) {
        skippedCount += 1;
        continue;
      }

      const filepath = join(migrationsDir, filename);
      const content = readFileSync(filepath, "utf-8");

      if (content.trim().length === 0) {
        await client.query(
          "INSERT INTO migrations_log (filename) VALUES ($1)",
          [filename],
        );
        console.log(`[migrate] ${filename}: empty, marked as applied.`);
        appliedCount += 1;
        continue;
      }

      console.log(`[migrate] applying ${filename}...`);
      try {
        // pg's simple-query protocol (used when query() is called with a
        // string and no params) supports multiple statements in one call.
        // This is the whole reason for the migration from neon-http.
        await client.query(content);
        await client.query(
          "INSERT INTO migrations_log (filename) VALUES ($1)",
          [filename],
        );
        console.log(`[migrate]   ✓ ${filename} applied`);
        appliedCount += 1;
      } catch (err) {
        console.error(
          `[migrate]   ✗ ${filename} FAILED: ${err instanceof Error ? err.message : String(err)}`,
        );
        console.error(
          "[migrate] aborting — fix the SQL or insert the filename into migrations_log manually if you've verified the schema is in the expected state.",
        );
        process.exit(1);
      }
    }

    console.log(
      `[migrate] done — applied=${appliedCount}, skipped=${skippedCount}, total=${files.length}.`,
    );
  } finally {
    await client.end().catch(() => {});
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[migrate] uncaught:", err);
  process.exit(1);
});
