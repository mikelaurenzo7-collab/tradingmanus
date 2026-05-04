import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function setBaseRequiredEnv() {
  process.env.JWT_SECRET = "x".repeat(40);
  process.env.CREDENTIAL_ENCRYPTION_SECRET = "y".repeat(40);
  process.env.DATABASE_URL = "postgresql://example";
  process.env.OWNER_EMAIL = "owner@example.com";
  process.env.OWNER_PASSWORD = "z".repeat(16);
  process.env.CRON_SECRET = "c".repeat(32); // Changed to 32 chars
}

describe("validateServerEnv", () => {
  afterEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it("does not throw when OPENROUTER_API_KEY is absent in production (emits warning only)", async () => {
    setBaseRequiredEnv();
    process.env.NODE_ENV = "production";
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const envModule = await import("./_core/env");

    expect(() => envModule.validateServerEnv()).not.toThrow();
  });

  it("does not throw when CRON_SECRET is short in production (emits warning only)", async () => {
    setBaseRequiredEnv();
    process.env.NODE_ENV = "production";
    process.env.CRON_SECRET = "short"; // Less than 32 chars
    process.env.OPENROUTER_API_KEY = "sk-or-test";

    const envModule = await import("./_core/env");

    // CRON_SECRET too short now emits a console.warn instead of throwing,
    // so the server can still start (autonomous trading just won't work).
    expect(() => envModule.validateServerEnv()).not.toThrow();
  });

  it("accepts a complete production env with OpenRouter API key", async () => {
    setBaseRequiredEnv();
    process.env.NODE_ENV = "production";
    process.env.OPENROUTER_API_KEY = "sk-or-test";

    const envModule = await import("./_core/env");

    expect(() => envModule.validateServerEnv()).not.toThrow();
  });

  it("also accepts ANTHROPIC_API_KEY as backward-compatible fallback", async () => {
    setBaseRequiredEnv();
    process.env.NODE_ENV = "production";
    delete process.env.OPENROUTER_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const envModule = await import("./_core/env");

    expect(() => envModule.validateServerEnv()).not.toThrow();
  });

  it("still throws for missing core required vars in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    delete process.env.CREDENTIAL_ENCRYPTION_SECRET;
    delete process.env.DATABASE_URL;
    delete process.env.OWNER_EMAIL;
    delete process.env.OWNER_PASSWORD;

    const envModule = await import("./_core/env");

    expect(() => envModule.validateServerEnv()).toThrow("Missing required environment variables");
  });
});
