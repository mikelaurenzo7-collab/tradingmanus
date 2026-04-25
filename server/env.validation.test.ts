import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function setBaseRequiredEnv() {
  process.env.JWT_SECRET = "x".repeat(40);
  process.env.CREDENTIAL_ENCRYPTION_SECRET = "y".repeat(40);
  process.env.DATABASE_URL = "postgresql://example";
  process.env.OWNER_EMAIL = "owner@example.com";
  process.env.OWNER_PASSWORD = "z".repeat(16);
  process.env.CRON_SECRET = "c".repeat(20);
}

describe("validateServerEnv", () => {
  afterEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it("requires OPENAI_API_KEY in production", async () => {
    setBaseRequiredEnv();
    process.env.NODE_ENV = "production";
    delete process.env.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const envModule = await import("./_core/env");

    expect(() => envModule.validateServerEnv()).toThrow(
      "OPENAI_API_KEY must be set in production for the duo AI trading reviewer"
    );
  });

  it("requires ANTHROPIC_API_KEY in production", async () => {
    setBaseRequiredEnv();
    process.env.NODE_ENV = "production";
    process.env.OPENAI_API_KEY = "sk-test-value";
    delete process.env.ANTHROPIC_API_KEY;

    const envModule = await import("./_core/env");

    expect(() => envModule.validateServerEnv()).toThrow(
      "ANTHROPIC_API_KEY must be set in production for the duo AI trading reviewer"
    );
  });

  it("accepts a complete production env including both AI provider keys", async () => {
    setBaseRequiredEnv();
    process.env.NODE_ENV = "production";
    process.env.OPENAI_API_KEY = "sk-test-value";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const envModule = await import("./_core/env");

    expect(() => envModule.validateServerEnv()).not.toThrow();
  });
});
