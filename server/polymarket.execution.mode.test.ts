import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/tradingMode", () => ({
  getEffectiveMode: vi.fn(),
}));
vi.mock("./db", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(true),
}));

global.fetch = vi.fn();

import { gatedPlacePolymarketOrder } from "./_core/polymarketAuth";
import { getEffectiveMode } from "./_core/tradingMode";

describe("gatedPlacePolymarketOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ order_id: "poly-123" }) } as Response);
  });

  it("blocks exchange call when paused", async () => {
    vi.mocked(getEffectiveMode).mockResolvedValue({ mode: "live", paused: true, reason: "paused", source: "manual_pause" });
    const result = await gatedPlacePolymarketOrder(1, "key", "secret", "pass", { tokenId: "tok-1", side: "BUY", price: 0.55, size: 10 });
    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns shadowed without calling exchange in shadow mode", async () => {
    vi.mocked(getEffectiveMode).mockResolvedValue({ mode: "shadow", paused: false, reason: "shadow", source: "user_setting" });
    const result = await gatedPlacePolymarketOrder(1, "key", "secret", "pass", { tokenId: "tok-1", side: "BUY", price: 0.55, size: 10 });
    expect(result.success).toBe(false);
    expect(result.shadowed).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("calls exchange in live mode", async () => {
    vi.mocked(getEffectiveMode).mockResolvedValue({ mode: "live", paused: false, reason: "live", source: "user_setting" });
    const result = await gatedPlacePolymarketOrder(1, "key", "secret", "pass", { tokenId: "tok-1", side: "BUY", price: 0.55, size: 10 });
    expect(fetch).toHaveBeenCalled();
  });
});
