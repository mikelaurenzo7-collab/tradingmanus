import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/tradingMode", () => ({
  getEffectiveMode: vi.fn(),
}));

global.fetch = vi.fn();

import { placeKalshiOrder } from "./_core/kalshiExecution";
import { getEffectiveMode } from "./_core/tradingMode";

describe("placeKalshiOrder — mode gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ order: { order_id: "exch-123" } }),
    } as Response);
  });

  it("returns shadowed status without calling exchange when in shadow mode", async () => {
    vi.mocked(getEffectiveMode).mockResolvedValue({ mode: "shadow", paused: false, reason: "shadow", source: "user_setting" });
    const result = await placeKalshiOrder(1, "MARKET-1", "yes", 5, 0.50);
    expect(result.shadowed).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns blocked status when paused", async () => {
    vi.mocked(getEffectiveMode).mockResolvedValue({ mode: "live", paused: true, reason: "manual", source: "manual_pause" });
    const result = await placeKalshiOrder(1, "MARKET-1", "yes", 5, 0.50);
    expect(result.blocked).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
