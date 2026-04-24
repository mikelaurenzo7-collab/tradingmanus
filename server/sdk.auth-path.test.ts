import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserByOpenId: vi.fn(),
  upsertUser: vi.fn(),
  axiosCreate: vi.fn(() => ({ post: vi.fn() })),
}));

vi.mock("axios", () => ({
  default: {
    create: mocks.axiosCreate,
  },
  create: mocks.axiosCreate,
}));

vi.mock("./db", () => ({
  getUserByOpenId: mocks.getUserByOpenId,
  upsertUser: mocks.upsertUser,
}));

describe("SDK authenticateRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("syncs a user even when OAuth returns only an openId and then records the sign-in heartbeat", async () => {
    vi.resetModules();
    const { sdk } = await import("./_core/sdk");

    vi.spyOn(sdk as any, "verifySession").mockResolvedValue({
      openId: "open-id-only",
      appId: "app-id",
      name: "Michael Laurenzo",
    });

    vi.spyOn(sdk, "getUserInfoWithJwt").mockResolvedValue({
      openId: "open-id-only",
      name: "",
      email: "",
      platform: null,
      loginMethod: null,
      platforms: [],
    } as any);

    mocks.getUserByOpenId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 1,
        openId: "open-id-only",
        name: null,
        email: null,
        role: "user",
        createdAt: new Date("2026-04-11T14:15:46.000Z"),
      });

    const result = await sdk.authenticateRequest({
      headers: { cookie: "app_session_id=fake-session-token" },
    } as any);

    expect(mocks.upsertUser).toHaveBeenCalledTimes(2);
    expect(mocks.upsertUser.mock.calls[0][0]).toMatchObject({
      openId: "open-id-only",
      name: undefined,
      email: undefined,
      loginMethod: undefined,
    });
    expect(mocks.upsertUser.mock.calls[0][0].lastSignedIn).toBeInstanceOf(Date);

    expect(mocks.upsertUser.mock.calls[1][0]).toMatchObject({
      openId: "open-id-only",
    });
    expect(mocks.upsertUser.mock.calls[1][0].lastSignedIn).toBeInstanceOf(Date);

    expect(result).toMatchObject({
      id: 1,
      openId: "open-id-only",
      role: "user",
    });
  });
});
