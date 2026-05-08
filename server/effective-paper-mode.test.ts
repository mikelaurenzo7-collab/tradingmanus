/**
 * Tests for the per-user paper-trade-mode resolver.
 *
 * The resolver was redesigned to drop the owner-email whitelist.  Live
 * trading is now open to every authenticated user; paper-mode is opt-in
 * per user via tradingPreferences.paperTradeMode, with the env-level
 * PAPER_TRADE_MODE=true global override still winning when set.
 */
import { describe, expect, it } from "vitest";
import { resolveEffectivePaperTradeMode } from "./_core/effectivePaperMode";

describe("resolveEffectivePaperTradeMode", () => {
  it("forces paper for everyone when env paperTradeMode is true (kill switch)", () => {
    expect(
      resolveEffectivePaperTradeMode({
        envPaperMode: true,
        userPaperPreference: false,
      }),
    ).toBe(true);
    expect(
      resolveEffectivePaperTradeMode({
        envPaperMode: true,
        userPaperPreference: true,
      }),
    ).toBe(true);
  });

  it("respects per-user paper preference when env is off", () => {
    expect(
      resolveEffectivePaperTradeMode({
        envPaperMode: false,
        userPaperPreference: true,
      }),
    ).toBe(true);
  });

  it("returns LIVE for users who have not opted into paper mode", () => {
    expect(
      resolveEffectivePaperTradeMode({
        envPaperMode: false,
        userPaperPreference: false,
      }),
    ).toBe(false);
  });
});
