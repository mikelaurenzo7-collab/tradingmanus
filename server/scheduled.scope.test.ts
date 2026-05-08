import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("scopeScheduledUsersToTrigger", () => {
  afterEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns every eligible user for local-scheduler runs (multi-user open trading)", async () => {
    // The owner-only filter was removed when live trading was opened to
    // every authenticated user.  The eligibility query upstream is what
    // gates who appears in this list — by the time it reaches scope*,
    // every user here is already configured + opted in.
    process.env.OWNER_EMAIL = "owner@example.com";
    const { scopeScheduledUsersToTrigger } = await import("./_core/app");

    const scoped = scopeScheduledUsersToTrigger(
      [
        { id: 1, openId: "owner-openid", email: "owner@example.com" },
        { id: 2, openId: "other-openid", email: "other@example.com" },
      ],
      "local_scheduler"
    );

    expect(scoped).toHaveLength(2);
    expect(scoped.map((u) => u.openId).sort()).toEqual(
      ["other-openid", "owner-openid"],
    );
  });

  it("returns the input list as-is when there's no owner among eligible users", async () => {
    // Previously this returned [] (gating local-scheduler runs to the
    // owner specifically).  Now it just passes the list through —
    // owner identity isn't special at the scheduler-scope layer.
    process.env.OWNER_EMAIL = "owner@example.com";
    const { scopeScheduledUsersToTrigger } = await import("./_core/app");

    const scoped = scopeScheduledUsersToTrigger(
      [{ id: 2, openId: "other-openid", email: "other@example.com" }],
      "local_scheduler"
    );

    expect(scoped).toHaveLength(1);
    expect(scoped[0].openId).toBe("other-openid");
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
