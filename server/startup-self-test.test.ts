import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: mocks.getDb,
}));

function fakeDbWith(opts: {
  selectOne?: boolean;
  exitStateColumnPresent?: boolean;
  fail?: boolean;
}) {
  if (opts.fail) {
    return {
      execute: vi.fn().mockRejectedValue(new Error("boom")),
    };
  }
  return {
    execute: vi.fn().mockImplementation(async () => {
      // First .execute is SELECT 1; second is information_schema query.
      if (opts.exitStateColumnPresent === undefined) return [];
      return opts.exitStateColumnPresent ? { rows: [{ column_name: "exitState" }] } : { rows: [] };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    JWT_SECRET: "x".repeat(40),
    CREDENTIAL_ENCRYPTION_SECRET: "y".repeat(40),
    DATABASE_URL: "postgresql://example",
    OWNER_EMAIL: "owner@example.com",
    OWNER_PASSWORD: "z".repeat(16),
  };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("runStartupSelfTest", () => {
  it("returns passed=true and ok statuses on a fully-configured prod env", async () => {
    process.env.NODE_ENV = "production";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_MODEL = "anthropic/claude-3.5-sonnet";
    mocks.getDb.mockResolvedValue(fakeDbWith({ exitStateColumnPresent: true }));

    const { runStartupSelfTest } = await import("./_core/startupSelfTest");
    const result = await runStartupSelfTest();

    expect(result.passed).toBe(true);
    const dbCheck = result.checks.find((c) => c.name === "database");
    expect(dbCheck?.status).toBe("ok");
    const exitCheck = result.checks.find((c) => c.name === "schema.kalshiPositions.exitState");
    expect(exitCheck?.status).toBe("ok");
    const aiKey = result.checks.find((c) => c.name === "ai_reviewer_key");
    expect(aiKey?.status).toBe("ok");
  });

  it("returns passed=false when DB unreachable in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_MODEL = "anthropic/claude-3.5-sonnet";
    mocks.getDb.mockResolvedValue(fakeDbWith({ fail: true }));

    const { runStartupSelfTest } = await import("./_core/startupSelfTest");
    const result = await runStartupSelfTest();

    expect(result.passed).toBe(false);
    const dbCheck = result.checks.find((c) => c.name === "database");
    expect(dbCheck?.status).toBe("fail");
    expect(dbCheck?.detail).toContain("Could not reach Postgres");
  });

  it("returns passed=true (warn-only) with a clear migration hint when exitState column is missing", async () => {
    process.env.NODE_ENV = "production";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_MODEL = "anthropic/claude-3.5-sonnet";
    mocks.getDb.mockResolvedValue(fakeDbWith({ exitStateColumnPresent: false }));

    const { runStartupSelfTest } = await import("./_core/startupSelfTest");
    const result = await runStartupSelfTest();

    // Missing exitState is a WARN, not a FAIL: the exit monitor handles
    // it gracefully (reads return no state → fresh init; writes are
    // try/caught), so the deploy still proceeds.
    expect(result.passed).toBe(true);
    const exitCheck = result.checks.find((c) => c.name === "schema.kalshiPositions.exitState");
    expect(exitCheck?.status).toBe("warn");
    expect(exitCheck?.detail).toContain("pnpm db:push");
  });

  it("returns passed=false when OPENROUTER_API_KEY is missing in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    mocks.getDb.mockResolvedValue(fakeDbWith({ exitStateColumnPresent: true }));

    const { runStartupSelfTest } = await import("./_core/startupSelfTest");
    const result = await runStartupSelfTest();

    expect(result.passed).toBe(false);
    const aiKey = result.checks.find((c) => c.name === "ai_reviewer_key");
    expect(aiKey?.status).toBe("fail");
  });

  it("downgrades missing OPENROUTER_API_KEY to a warning in development", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    mocks.getDb.mockResolvedValue(fakeDbWith({ exitStateColumnPresent: true }));

    const { runStartupSelfTest } = await import("./_core/startupSelfTest");
    const result = await runStartupSelfTest();

    expect(result.passed).toBe(true); // warn-only
    const aiKey = result.checks.find((c) => c.name === "ai_reviewer_key");
    expect(aiKey?.status).toBe("warn");
  });

  it("warns when CREDENTIAL_ENCRYPTION_SECRET equals JWT_SECRET", async () => {
    process.env.NODE_ENV = "production";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_MODEL = "anthropic/claude-3.5-sonnet";
    process.env.CREDENTIAL_ENCRYPTION_SECRET = process.env.JWT_SECRET;
    mocks.getDb.mockResolvedValue(fakeDbWith({ exitStateColumnPresent: true }));

    const { runStartupSelfTest } = await import("./_core/startupSelfTest");
    const result = await runStartupSelfTest();

    const credCheck = result.checks.find((c) => c.name === "credential_encryption_secret");
    expect(credCheck?.status).toBe("warn");
  });

  it("warns when default free OpenRouter model is in use in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    delete process.env.OPENROUTER_MODEL; // → defaults to tencent/hy3-preview:free
    mocks.getDb.mockResolvedValue(fakeDbWith({ exitStateColumnPresent: true }));

    const { runStartupSelfTest } = await import("./_core/startupSelfTest");
    const result = await runStartupSelfTest();

    const modelCheck = result.checks.find((c) => c.name === "ai_reviewer_model");
    expect(modelCheck?.status).toBe("warn");
    expect(modelCheck?.detail).toContain("free");
  });
});
