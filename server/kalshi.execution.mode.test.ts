import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/tradingMode", () => ({
  getEffectiveMode: vi.fn(),
}));

// Mock DB so that shadow/paper paths can call db.insert without a real DB connection.
vi.mock("./db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn().mockResolvedValue(undefined),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          then: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
  },
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./db.kalshi-credentials", () => ({
  getKalshiCredentials: vi.fn().mockResolvedValue(null),
}));

vi.mock("./db.trading-preferences", () => ({
  getTradingPreferences: vi.fn().mockResolvedValue({
    kalshiLiveStartedAt: null,
    rampWindowHours: 24,
    rampSizeMultiplier: 0.25,
  }),
}));

vi.mock("./_core/rampWindow", () => ({
  applyRampWindowCap: vi.fn(() => ({
    rampActive: false,
    cappedSize: 5,
    hoursRemaining: 0,
  })),
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

  it("returns paperFilled:true without calling exchange when in paper mode", async () => {
    vi.mocked(getEffectiveMode).mockResolvedValue({ mode: "paper", paused: false, reason: "paper", source: "user_setting" });
    const result = await placeKalshiOrder(1, "MARKET-1", "yes", 5, 0.50);
    expect(result.paperFilled).toBe(true);
    expect(result.success).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
