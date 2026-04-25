import { beforeEach, describe, expect, it, vi } from "vitest";

const createAppMock = vi.fn();

vi.mock("../server/_core/app", () => ({
  createApp: createAppMock,
}));

function createResponseDouble() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json };
}

describe("api/index handler", () => {
  beforeEach(() => {
    createAppMock.mockReset();
    vi.resetModules();
  });

  it("invokes the Express app as the request listener", async () => {
    const app = vi.fn();
    createAppMock.mockResolvedValue(app);

    const { default: handler } = await import("../api/index");
    const req = { method: "POST", url: "/api/trpc/auth.login" };
    const res = createResponseDouble();

    await handler(req, res);

    expect(createAppMock).toHaveBeenCalledWith({ runStartupMigrations: false });
    expect(app).toHaveBeenCalledWith(req, res);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns JSON when app startup fails", async () => {
    createAppMock.mockRejectedValue(new Error("boom"));

    const { default: handler } = await import("../api/index");
    const req = { method: "POST", url: "/api/trpc/auth.login" };
    const res = createResponseDouble();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Server initialization failed",
      detail: "boom",
    });
  });
});
