import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({
  getTodayRealizedLoss: vi.fn(),
  getKalshiCapital: vi.fn(),
  logAuditEvent: vi.fn().mockResolvedValue(true),
}));
vi.mock("./db.trading-preferences", () => ({
  getTradingPreferences: vi.fn(),
  saveTradingPreferences: vi.fn(),
}));
vi.mock("./_core/alerting", () => ({
  alertDrawdown: vi.fn().mockResolvedValue(undefined),
}));

import { evaluateDrawdown } from "./_core/drawdownEngine";
import * as db from "./db";
import * as prefsDb from "./db.trading-preferences";
import { alertDrawdown } from "./_core/alerting";

const mockPrefs = (overrides = {}) => ({
  drawdownWarnPct: 5,
  drawdownPausePct: 10,
  drawdownPanicPct: 20,
  kalshiPaused: 0,
  polymarketPaused: 0,
  ...overrides,
});

describe("evaluateDrawdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getTodayRealizedLoss).mockResolvedValue(0);
    vi.mocked(db.getKalshiCapital).mockResolvedValue({ currentBalance: 100, startingBalance: 100 } as never);
    vi.mocked(prefsDb.getTradingPreferences).mockResolvedValue(mockPrefs() as never);
    vi.mocked(prefsDb.saveTradingPreferences).mockResolvedValue(mockPrefs() as never);
  });

  it("returns ok when no loss", async () => {
    const result = await evaluateDrawdown(1, "kalshi", "system");
    expect(result.tier).toBe("ok");
    expect(result.shouldPause).toBe(false);
  });

  it("returns warn tier at 5% loss without pausing", async () => {
    vi.mocked(db.getTodayRealizedLoss).mockResolvedValue(5);
    const result = await evaluateDrawdown(1, "kalshi", "system");
    expect(result.tier).toBe("warn");
    expect(result.shouldPause).toBe(false);
    expect(alertDrawdown).toHaveBeenCalledWith(1, "kalshi", expect.objectContaining({ level: "warn" }));
  });

  it("returns pause tier at 10% loss and sets paused flag", async () => {
    vi.mocked(db.getTodayRealizedLoss).mockResolvedValue(10);
    const result = await evaluateDrawdown(1, "kalshi", "system");
    expect(result.tier).toBe("pause");
    expect(result.shouldPause).toBe(true);
    expect(prefsDb.saveTradingPreferences).toHaveBeenCalledWith(1, { kalshiPaused: 1 });
  });

  it("returns panic tier at 20% loss", async () => {
    vi.mocked(db.getTodayRealizedLoss).mockResolvedValue(20);
    const result = await evaluateDrawdown(1, "kalshi", "system");
    expect(result.tier).toBe("panic");
    expect(alertDrawdown).toHaveBeenCalledWith(1, "kalshi", expect.objectContaining({ level: "panic" }));
  });

  it("skips evaluation when already paused", async () => {
    vi.mocked(prefsDb.getTradingPreferences).mockResolvedValue(mockPrefs({ kalshiPaused: 1 }) as never);
    const result = await evaluateDrawdown(1, "kalshi", "system");
    expect(result.tier).toBe("already_paused");
    expect(prefsDb.saveTradingPreferences).not.toHaveBeenCalled();
  });

  it("returns ok when capital is zero (no meaningful loss pct)", async () => {
    vi.mocked(db.getKalshiCapital).mockResolvedValue({ currentBalance: 0, startingBalance: 0 } as never);
    const result = await evaluateDrawdown(1, "kalshi", "system");
    expect(result.tier).toBe("ok");
  });
});
