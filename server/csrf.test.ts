import { describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { csrfProtection, issueCsrfToken, CSRF_COOKIE_NAME } from "./_core/csrf";

vi.mock("./_core/logger", () => ({
  logger: { warn: vi.fn() },
}));

function makeReq(overrides: Partial<Request> = {}) {
  return {
    method: "POST",
    path: "/api/trpc/kalshi.placeOrder",
    ip: "127.0.0.1",
    headers: {},
    cookies: {},
    ...overrides,
  } as Request;
}

function makeRes() {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
    cookie: vi.fn(() => res),
  } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    cookie: ReturnType<typeof vi.fn>;
  };
  return res;
}

function nextSpy() {
  return vi.fn() as NextFunction;
}

describe("CSRF protection", () => {
  it("issues a readable strict CSRF cookie on safe requests", () => {
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    const next = nextSpy();

    issueCsrfToken(req, res, next);

    expect(res.cookie).toHaveBeenCalledWith(
      CSRF_COOKIE_NAME,
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.objectContaining({
        httpOnly: false,
        sameSite: "strict",
        path: "/",
      })
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows mutation requests when the header matches the cookie", () => {
    const token = "a".repeat(64);
    const req = makeReq({
      headers: { "x-csrf-token": token },
      cookies: { [CSRF_COOKIE_NAME]: token },
    });
    const res = makeRes();
    const next = nextSpy();

    csrfProtection(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects mutation requests with malformed tokens", () => {
    const req = makeReq({
      headers: { "x-csrf-token": "not-a-token" },
      cookies: { [CSRF_COOKIE_NAME]: "not-a-token" },
    });
    const res = makeRes();
    const next = nextSpy();

    csrfProtection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("rejects mutation requests when the header and cookie differ", () => {
    const req = makeReq({
      headers: { "x-csrf-token": "a".repeat(64) },
      cookies: { [CSRF_COOKIE_NAME]: "b".repeat(64) },
    });
    const res = makeRes();
    const next = nextSpy();

    csrfProtection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
