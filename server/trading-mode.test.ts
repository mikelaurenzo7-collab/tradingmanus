import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/env", () => ({
  ENV: { tradingModeOverride: "" },
}));

vi.mock("./db.trading-preferences", () => ({
  getTradingPreferences: vi.fn(),
}));

import { getEffectiveMode } from "./_core/tradingMode";
import { ENV } from "./_core/env";
import { getTradingPreferences } from "./db.trading-preferences";

const mockPrefs = (overrides: Record<string, unknown> = {}) => ({
  kalshiMode: "shadow" as const,
  polymarketMode: "shadow" as const,
  kalshiPaused: 0,
  polymarketPaused: 0,
  kalshiLiveStartedAt: null,
  polymarketLiveStartedAt: null,
  rampWindowHours: 72,
  rampSizeMultiplier: 0.25,
  drawdownWarnPct: 5,
  drawdownPausePct: 10,
  drawdownPanicPct: 20,
  ...overrides,
});

describe("getEffectiveMode", () => {
  beforeEach(() => {
    vi.mocked(getTradingPreferences).mockResolvedValue(mockPrefs() as never);
    (ENV as { tradingModeOverride: string }).tradingModeOverride = "";
  });

  it("returns shadow when user mode is shadow", async () => {
    vi.mocked(getTradingPreferences).mockResolvedValue(mockPrefs({ kalshiMode: "shadow" }) as never);
    const result = await getEffectiveMode(1, "kalshi");
    expect(result.mode).toBe("shadow");
    expect(result.paused).toBe(false);
  });

  it("returns paper when user mode is paper", async () => {
    vi.mocked(getTradingPreferences).mockResolvedValue(mockPrefs({ kalshiMode: "paper" }) as never);
    const result = await getEffectiveMode(1, "kalshi");
    expect(result.mode).toBe("paper");
    expect(result.paused).toBe(false);
  });

  it("returns live when user mode is live", async () => {
    vi.mocked(getTradingPreferences).mockResolvedValue(mockPrefs({ kalshiMode: "live" }) as never);
    const result = await getEffectiveMode(1, "kalshi");
    expect(result.mode).toBe("live");
    expect(result.paused).toBe(false);
  });

  it("returns paused when platform is manually paused", async () => {
    vi.mocked(getTradingPreferences).mockResolvedValue(mockPrefs({ kalshiMode: "live", kalshiPaused: 1 }) as never);
    const result = await getEffectiveMode(1, "kalshi");
    expect(result.paused).toBe(true);
    expect(result.source).toBe("manual_pause");
  });

  it("ENV pause override takes priority over user setting", async () => {
    vi.mocked(getTradingPreferences).mockResolvedValue(mockPrefs({ kalshiMode: "live", kalshiPaused: 0 }) as never);
    (ENV as { tradingModeOverride: string }).tradingModeOverride = "pause";
    const result = await getEffectiveMode(1, "kalshi");
    expect(result.paused).toBe(true);
    expect(result.source).toBe("env_override");
  });

  it("ENV shadow override forces shadow even when user is live", async () => {
    vi.mocked(getTradingPreferences).mockResolvedValue(mockPrefs({ kalshiMode: "live" }) as never);
    (ENV as { tradingModeOverride: string }).tradingModeOverride = "shadow";
    const result = await getEffectiveMode(1, "kalshi");
    expect(result.mode).toBe("shadow");
    expect(result.paused).toBe(false);
    expect(result.source).toBe("env_override");
  });

  it("uses polymarket mode for polymarket platform", async () => {
    vi.mocked(getTradingPreferences).mockResolvedValue(
      mockPrefs({ kalshiMode: "live", polymarketMode: "shadow" }) as never
    );
    const kalshi = await getEffectiveMode(1, "kalshi");
    const poly = await getEffectiveMode(1, "polymarket");
    expect(kalshi.mode).toBe("live");
    expect(poly.mode).toBe("shadow");
  });

  it("returns safe paused state on DB error", async () => {
    vi.mocked(getTradingPreferences).mockRejectedValue(new Error("db down"));
    const result = await getEffectiveMode(1, "kalshi");
    expect(result.paused).toBe(true);
    expect(result.source).toBe("error_reading_prefs");
  });
});
