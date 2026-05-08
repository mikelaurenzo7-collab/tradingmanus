/**
 * Custom migration runner — applies SQL files from drizzle/migrations/ in
 * filename order, tracking applied versions in a `migrations_log` table.
 *
 * Self-contained so it works in the slim runtime Docker image: uses
 * @neondatabase/serverless directly rather than reaching into server/db.ts.
 *
 * Why not drizzle-kit migrate?
 *   - This codebase predates a versioned migrations folder; the production
 *     DB has all tables already (created via historical `db:push` runs).
 *     drizzle-kit migrate expects a clean baseline + journal it controls.
 *     Bootstrapping it on a non-empty DB requires hand-seeding
 *     __drizzle_migrations entries to mark "this was already applied,"
 *     which is brittle.
 *   - This runner is dumb-simple: each .sql file is a unit of change,
 *     idempotent if written with IF NOT EXISTS, tracked in a tiny table.
 *     Designed to coexist with the operator's habit of hand-applying SQL
 *     via Neon's web SQL editor when a fast turnaround is needed.
 *
 * Usage:
 *   - Locally:           DATABASE_URL=... pnpm migrate:apply
 *   - On Railway:        runs automatically as the start script's
 *                        first step (`pnpm migrate:apply && node dist/index.js`).
 *
 * Operator semantics:
 *   - Adding a new migration → drop a new SQL file in drizzle/migrations/
 *     using the next sequential number (0002_, 0003_, ...).  Use
 *     `IF NOT EXISTS` / `IF EXISTS` to make the file idempotent so
 *     hand-applied changes don't break the runner.
 *   - First-deploy bootstrapping → the runner creates the migrations_log
 *     table on first run.  All 0001_ etc. files run in order; idempotent
 *     SQL means rerunning is safe even if the operator already applied
 *     a migration via Neon's SQL editor.
 *   - Recovering from a failed migration → fix the SQL, the runner will
 *     re-attempt the unmarked file on the next deploy.  Mark a file as
 *     applied manually only if you've verified the schema is in the
 *     expected state:
 *         INSERT INTO migrations_log (filename) VALUES ('0001_xxx.sql');
 */

import { neon } from "@neondatabase/serverless";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

async function main(): Promise<void> {
  const dbUrl = (process.env.DATABASE_URL ?? "").trim();
  if (!dbUrl) {
    console.error("[migrate] DATABASE_URL is required.");
    process.exit(1);
  }

  // Discover migrations dir.  Resolve from CWD (./drizzle/migrations) — works
  // both locally and inside the Docker runner because we copy the folder
  // into /app/drizzle/migrations.
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

  // The neon-http driver runs each tagged-template call as a single
  // statement.  For our use-case (CREATE TABLE, ALTER TABLE, etc.) we
  // assemble a connection lazily via the typed `neon()` factory.
  const sql = neon(dbUrl);

  // Ensure the tracking table exists.  Idempotent.
  await sql`
    CREATE TABLE IF NOT EXISTS migrations_log (
      filename    text        PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `;

  const appliedRows = (await sql`SELECT filename FROM migrations_log`) as Array<{
    filename: string;
  }>;
  const applied = new Set(appliedRows.map((r) => r.filename));

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
      // Empty placeholder — record it and move on.
      await sql`INSERT INTO migrations_log (filename) VALUES (${filename})`;
      console.log(`[migrate] ${filename}: empty, marked as applied.`);
      appliedCount += 1;
      continue;
    }

    console.log(`[migrate] applying ${filename}...`);
    try {
      // neon-http supports running raw SQL via the unsafe-template form.
      // Multi-statement files work because Neon's HTTP gateway processes
      // the body as a single batch.
      await sql.unsafe(content);
      await sql`INSERT INTO migrations_log (filename) VALUES (${filename})`;
      console.log(`[migrate]   ✓ ${filename} applied`);
      appliedCount += 1;
    } catch (err) {
      console.error(
        `[migrate]   ✗ ${filename} FAILED: ${err instanceof Error ? err.message : String(err)}`,
      );
      console.error(
        "[migrate] aborting — fix the SQL or hand-apply via Neon SQL editor and insert the filename into migrations_log manually.",
      );
      process.exit(1);
    }
  }

  console.log(
    `[migrate] done — applied=${appliedCount}, skipped=${skippedCount}, total=${files.length}.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[migrate] uncaught:", err);
  process.exit(1);
});
