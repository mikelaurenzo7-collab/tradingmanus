/**
 * Sanity tests for scripts/applyMigrations.ts behavior.  We don't hit a
 * real DB here — those tests would belong in an integration suite.  These
 * verify the file-discovery + sort logic + the idempotent SQL we ship.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle", "migrations");

describe("migration files", () => {
  it("only contains .sql files (no stray .ts / .json)", () => {
    const all = readdirSync(MIGRATIONS_DIR);
    const sql = all.filter((f) => f.endsWith(".sql"));
    expect(sql.length).toBeGreaterThan(0);
    expect(all.every((f) => f.endsWith(".sql"))).toBe(true);
  });

  it("filenames sort lexicographically into application order", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    // First file MUST start with "0001_" or earlier.  This contract is
    // documented in the runner: numbered prefixes drive apply order.
    expect(files[0]).toMatch(/^0\d{3}_/);
  });

  it("0001_pay_for_yourself.sql is idempotent (uses IF NOT EXISTS)", () => {
    const path = join(MIGRATIONS_DIR, "0001_pay_for_yourself.sql");
    const content = readFileSync(path, "utf-8");
    // Both ALTER TABLEs must be IF NOT EXISTS so the runner is safe to
    // re-apply against a DB where the operator already added the column
    // via Neon's SQL editor.
    const alterCount = (content.match(/ALTER TABLE/g) ?? []).length;
    const ifNotExistsCount = (content.match(/IF NOT EXISTS/g) ?? []).length;
    expect(alterCount).toBeGreaterThanOrEqual(2);
    expect(ifNotExistsCount).toBeGreaterThanOrEqual(alterCount);
  });

  it("0001 adds exitState to BOTH kalshiPositions and polymarketPositions", () => {
    const path = join(MIGRATIONS_DIR, "0001_pay_for_yourself.sql");
    const content = readFileSync(path, "utf-8");
    expect(content).toContain('"kalshiPositions"');
    expect(content).toContain('"polymarketPositions"');
    expect(content).toMatch(/"exitState"\s+jsonb/);
  });
});
