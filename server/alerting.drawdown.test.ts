import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/env", () => ({
  ENV: { alertWebhookUrl: "https://hooks.example.com/test" },
}));

global.fetch = vi.fn();

import { alertDrawdown, alertKillSwitch, alertModeChange } from "./_core/alerting";

describe("alertDrawdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
  });

  it("calls sendAlert with correct event for warn level", async () => {
    await alertDrawdown(1, "kalshi", { level: "warn", lossPct: 5.5, threshold: 5.0 });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.event).toBe("drawdown_warn");
    expect(body.severity).toBe("warning");
    expect(body.details.platform).toBe("kalshi");
  });

  it("calls sendAlert with critical severity for panic level", async () => {
    await alertDrawdown(1, "kalshi", { level: "panic", lossPct: 21.0, threshold: 20.0 });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.severity).toBe("critical");
    expect(body.event).toBe("drawdown_panic");
  });
});

describe("alertKillSwitch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
  });

  it("fires with correct event", async () => {
    await alertKillSwitch(1, "kalshi", { reason: "manual pause", source: "manual" });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.event).toBe("kill_switch_activated");
  });
});

describe("alertModeChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
  });

  it("fires with old and new mode in details", async () => {
    await alertModeChange(1, "kalshi", { oldMode: "shadow", newMode: "live", actor: "user" });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.event).toBe("trading_mode_changed");
    expect(body.details.oldMode).toBe("shadow");
    expect(body.details.newMode).toBe("live");
  });
});
