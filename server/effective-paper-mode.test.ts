/**
 * Tests for the per-user effective-paper-mode resolver.
 *
 * The pure resolver is exhaustively covered here.  The DB-bound async
 * variant is covered indirectly by exit-monitor and order-flow tests
 * which mock getUserById.
 */
import { describe, expect, it } from "vitest";
import { resolveEffectivePaperTradeMode, isOwnerEmail } from "./_core/effectivePaperMode";

describe("resolveEffectivePaperTradeMode", () => {
  it("returns true (paper) when the global env override is on, regardless of user", () => {
    expect(
      resolveEffectivePaperTradeMode({
        envPaperMode: true,
        userEmail: "owner@example.com",
        ownerEmail: "owner@example.com",
      }),
    ).toBe(true);
    expect(
      resolveEffectivePaperTradeMode({
        envPaperMode: true,
        userEmail: "stranger@example.com",
        ownerEmail: "owner@example.com",
      }),
    ).toBe(true);
  });

  it("returns false (live) for the configured owner when env override is off", () => {
    expect(
      resolveEffectivePaperTradeMode({
        envPaperMode: false,
        userEmail: "owner@example.com",
        ownerEmail: "owner@example.com",
      }),
    ).toBe(false);
  });

  it("returns true (paper) for non-owner users when env override is off", () => {
    expect(
      resolveEffectivePaperTradeMode({
        envPaperMode: false,
        userEmail: "guest@example.com",
        ownerEmail: "owner@example.com",
      }),
    ).toBe(true);
  });

  it("matches owner email case- and whitespace-insensitively", () => {
    expect(
      resolveEffectivePaperTradeMode({
        envPaperMode: false,
        userEmail: "  Owner@Example.COM  ",
        ownerEmail: "owner@example.com",
      }),
    ).toBe(false);
    expect(
      resolveEffectivePaperTradeMode({
        envPaperMode: false,
        userEmail: "owner@example.com",
        ownerEmail: "  Owner@Example.COM  ",
      }),
    ).toBe(false);
  });

  it("returns true (paper) when ownerEmail is empty (no owner configured)", () => {
    expect(
      resolveEffectivePaperTradeMode({
        envPaperMode: false,
        userEmail: "anyone@example.com",
        ownerEmail: "",
      }),
    ).toBe(true);
  });

  it("returns true (paper) when userEmail is null/undefined", () => {
    expect(
      resolveEffectivePaperTradeMode({
        envPaperMode: false,
        userEmail: null,
        ownerEmail: "owner@example.com",
      }),
    ).toBe(true);
    expect(
      resolveEffectivePaperTradeMode({
        envPaperMode: false,
        userEmail: undefined,
        ownerEmail: "owner@example.com",
      }),
    ).toBe(true);
  });
});

describe("isOwnerEmail", () => {
  // Note: this depends on ENV.ownerEmail at module-load time.  We reset
  // modules in the integration tests; here we just smoke-check the
  // function is callable.
  it("returns false for an empty input regardless of owner config", () => {
    expect(isOwnerEmail("")).toBe(false);
    expect(isOwnerEmail(null)).toBe(false);
    expect(isOwnerEmail(undefined)).toBe(false);
  });
});
