import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const values = vi.fn();
  const insert = vi.fn(() => ({ values }));

  const selectWhere = vi.fn();
  const from = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from }));

  const updateWhere = vi.fn();
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  const ping = vi.fn();
  const release = vi.fn();
  const getConnection = vi.fn(async () => ({ ping, release }));
  const end = vi.fn();
  const pool = {
    getConnection,
    end,
  };

  return {
    values,
    insert,
    selectWhere,
    from,
    select,
    updateWhere,
    set,
    update,
    ping,
    release,
    getConnection,
    end,
    pool,
    database: {
      insert,
      select,
      update,
    },
    createPool: vi.fn(),
    drizzleInit: vi.fn(),
  };
});

vi.mock("mysql2/promise", () => ({
  createPool: mocks.createPool,
}));

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: mocks.drizzleInit,
}));

describe("upsertUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPool.mockReturnValue(mocks.pool);
    mocks.getConnection.mockResolvedValue({ ping: mocks.ping, release: mocks.release });
    mocks.ping.mockResolvedValue(undefined);
    mocks.drizzleInit.mockReturnValue(mocks.database);
  });

  it("inserts a new user without attempting a duplicate-key update when only openId is available", async () => {
    vi.resetModules();
    mocks.selectWhere.mockResolvedValueOnce([]);
    mocks.values.mockResolvedValueOnce(undefined);

    const db = await import("./db");

    await db.upsertUser({
      openId: "open-id-only",
      lastSignedIn: new Date("2026-04-24T00:00:00.000Z"),
    });

    expect(mocks.createPool).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.values).toHaveBeenCalledWith({ openId: "open-id-only" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("updates an existing user when new profile fields are available", async () => {
    vi.resetModules();
    mocks.selectWhere.mockResolvedValueOnce([{ openId: "existing-user" }]);
    mocks.updateWhere.mockResolvedValueOnce(undefined);

    const db = await import("./db");

    await db.upsertUser({
      openId: "existing-user",
      name: "Laurenzo",
      email: "trader@example.com",
    });

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledWith({
      name: "Laurenzo",
      email: "trader@example.com",
    });
    expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
  });

  it("recreates the client when the existing pool health check fails", async () => {
    vi.resetModules();
    mocks.selectWhere.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mocks.values.mockResolvedValue(undefined);
    mocks.getConnection
      .mockResolvedValueOnce({ ping: mocks.ping, release: mocks.release })
      .mockResolvedValueOnce({
        ping: vi.fn().mockRejectedValueOnce(new Error("closed state")),
        release: mocks.release,
      })
      .mockResolvedValueOnce({ ping: mocks.ping, release: mocks.release });

    const db = await import("./db");

    await db.upsertUser({ openId: "first-user" });
    await db.upsertUser({ openId: "second-user" });

    expect(mocks.createPool).toHaveBeenCalledTimes(2);
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });
});
