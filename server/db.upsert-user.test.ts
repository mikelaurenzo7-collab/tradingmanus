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

  return {
    values,
    insert,
    selectWhere,
    from,
    select,
    updateWhere,
    set,
    update,
    database: {
      insert,
      select,
      update,
    },
    createConnection: vi.fn(),
    drizzleInit: vi.fn(),
  };
});

vi.mock("mysql2/promise", () => ({
  createConnection: mocks.createConnection,
}));

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: mocks.drizzleInit,
}));

describe("upsertUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createConnection.mockResolvedValue({});
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
});
