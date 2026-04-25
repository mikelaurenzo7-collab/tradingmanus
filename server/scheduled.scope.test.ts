import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("scopeScheduledUsersToTrigger", () => {
  afterEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it("scopes cron-triggered runs to the configured owner email", async () => {
    process.env.OWNER_EMAIL = "owner@example.com";
    const { scopeScheduledUsersToTrigger } = await import("./_core/app");

    const scoped = scopeScheduledUsersToTrigger(
      [
        { id: 1, openId: "owner-openid", email: "owner@example.com" },
        { id: 2, openId: "other-openid", email: "other@example.com" },
      ],
      "vercel_cron"
    );

    expect(scoped).toHaveLength(1);
    expect(scoped[0].openId).toBe("owner-openid");
  });

  it("returns an empty list when cron trigger cannot find the owner among eligible users", async () => {
    process.env.OWNER_EMAIL = "owner@example.com";
    const { scopeScheduledUsersToTrigger } = await import("./_core/app");

    const scoped = scopeScheduledUsersToTrigger(
      [{ id: 2, openId: "other-openid", email: "other@example.com" }],
      "vercel_cron"
    );

    expect(scoped).toHaveLength(0);
  });

  it("scopes authenticated manual trigger runs to the requester's openId", async () => {
    process.env.OWNER_EMAIL = "owner@example.com";
    const { scopeScheduledUsersToTrigger } = await import("./_core/app");

    const scoped = scopeScheduledUsersToTrigger(
      [
        { id: 1, openId: "owner-openid", email: "owner@example.com" },
        { id: 2, openId: "other-openid", email: "other@example.com" },
      ],
      "owner-openid"
    );

    expect(scoped).toHaveLength(1);
    expect(scoped[0].openId).toBe("owner-openid");
  });
});
