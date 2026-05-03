import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function setBaseRequiredEnv() {
  process.env.JWT_SECRET = "x".repeat(40);
  process.env.CREDENTIAL_ENCRYPTION_SECRET = "y".repeat(40);
  process.env.DATABASE_URL = "postgresql://example";
  process.env.OWNER_EMAIL = "owner@example.com";
  process.env.OWNER_PASSWORD = "z".repeat(16);
  process.env.CRON_SECRET = "c".repeat(32);
}

describe("validateServerEnv", () => {
  afterEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it("does not throw when ANTHROPIC_API_KEY is absent in production (emits warning only)", async () => {
    setBaseRequiredEnv();
    process.env.NODE_ENV = "production";
    delete process.env.ANTHROPIC_API_KEY;

    const envModule = await import("./_core/env");

    expect(() => envModule.validateServerEnv()).not.toThrow();
  });

  it("requires CRON_SECRET to be at least 32 chars in production", async () => {
    setBaseRequiredEnv();
    process.env.NODE_ENV = "production";
    process.env.CRON_SECRET = "short";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const envModule = await import("./_core/env");

    expect(() => envModule.validateServerEnv()).toThrow("CRON_SECRET must be at least 32 characters");
  });

  it("accepts a complete production env with the Anthropic key set", async () => {
    setBaseRequiredEnv();
    process.env.NODE_ENV = "production";
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
