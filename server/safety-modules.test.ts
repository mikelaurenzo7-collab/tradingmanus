import { describe, expect, it, vi } from "vitest";
import { computeColdStartScale } from "./_core/coldStart";
import {
  jaccardSimilarity,
  checkConcentration,
} from "./_core/concentrationLimits";
import { sendOperatorAlert } from "./_core/operatorAlerts";
import { decideStopLoss } from "./_core/stopLossScanner";

describe("computeColdStartScale", () => {
  it("returns full scale when feature is disabled", () => {
    const result = computeColdStartScale(
      { accountAgeDays: 0, completedTrades: 0 },
      { enabled: false },
    );
    expect(result.scale).toBe(1);
    expect(result.reason).toBe("feature_off");
  });

  it("returns floor for brand-new accounts when feature is enabled", () => {
    const result = computeColdStartScale(
      { accountAgeDays: 0, completedTrades: 0 },
      { enabled: true, floor: 0.1, daysToGraduate: 30, tradesToGraduate: 30 },
    );
    expect(result.scale).toBeCloseTo(0.1, 6);
    expect(result.reason).toBe("ramping_age");
    expect(result.progress).toBe(0);
  });

  it("ramps linearly from floor to 1.0 with age", () => {
    const result = computeColdStartScale(
      { accountAgeDays: 15, completedTrades: 0 },
      { enabled: true, floor: 0.1, daysToGraduate: 30, tradesToGraduate: 30 },
    );
    // 50% age progress → 0.1 + 0.9 * 0.5 = 0.55
    expect(result.scale).toBeCloseTo(0.55, 4);
    expect(result.reason).toBe("ramping_age");
  });

  it("graduates when age threshold is hit", () => {
    const result = computeColdStartScale(
      { accountAgeDays: 60, completedTrades: 0 },
      { enabled: true, floor: 0.1, daysToGraduate: 30, tradesToGraduate: 30 },
    );
    expect(result.scale).toBe(1);
    expect(result.reason).toBe("graduated");
  });

  it("uses trade-count axis when it leads age", () => {
    const result = computeColdStartScale(
      { accountAgeDays: 0, completedTrades: 30 },
      { enabled: true, floor: 0.1, daysToGraduate: 30, tradesToGraduate: 30 },
    );
    expect(result.scale).toBe(1);
    expect(result.reason).toBe("graduated");
  });

  it("takes the better of (age, trades) progress", () => {
    const result = computeColdStartScale(
      { accountAgeDays: 5, completedTrades: 25 }, // 16% age, 83% trades
      { enabled: true, floor: 0.1, daysToGraduate: 30, tradesToGraduate: 30 },
    );
    expect(result.reason).toBe("ramping_trades");
    expect(result.progress).toBeCloseTo(25 / 30, 4);
  });
});

describe("jaccardSimilarity", () => {
  it("returns 1 for identical strings (after stopword strip)", () => {
    expect(jaccardSimilarity("Lakers win NBA finals", "Lakers win NBA finals"))
      .toBeCloseTo(1, 6);
  });

  it("returns 0 for completely different topics", () => {
    expect(
      jaccardSimilarity("Lakers win NBA finals", "Will it rain in Seattle"),
    ).toBeLessThan(0.2);
  });

  it("strips stopwords so 'will X win' and 'X wins' match", () => {
    const sim = jaccardSimilarity("Will Lakers win NBA finals", "Lakers wins NBA finals");
    // "win"/"wins" are both stopwords-ish? Actually "wins" is in stopwords.
    expect(sim).toBeGreaterThan(0.5);
  });

  it("is symmetric", () => {
    const a = jaccardSimilarity("Trump wins primary", "Trump wins nomination");
    const b = jaccardSimilarity("Trump wins nomination", "Trump wins primary");
    expect(a).toBeCloseTo(b, 6);
  });
});

describe("checkConcentration", () => {
  it("allows when no existing exposure", () => {
    const result = checkConcentration({
      candidate: { text: "Lakers win NBA finals", category: "sports", notionalUsd: 10 },
      existingExposure: [],
      equity: 1000,
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks when existing position has high text similarity", () => {
    const result = checkConcentration({
      candidate: { text: "Will Lakers win the NBA Finals", category: "sports", notionalUsd: 10 },
      existingExposure: [
        { marketId: "EXISTING-1", text: "Lakers win NBA finals", category: "sports", notionalUsd: 20 },
      ],
      equity: 1000,
      similarityThresholdOverride: 0.4,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("correlated_event_already_held");
    }
  });

  it("allows when similar text is below threshold", () => {
    const result = checkConcentration({
      candidate: { text: "Will Lakers win NBA finals", category: "sports", notionalUsd: 10 },
      existingExposure: [
        { marketId: "EXISTING-1", text: "Will it rain tomorrow", category: "sports", notionalUsd: 20 },
      ],
      equity: 1000,
      similarityThresholdOverride: 0.5,
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks when same-category exposure would exceed cap", () => {
    const result = checkConcentration({
      candidate: { text: "totally unrelated event A", category: "politics", notionalUsd: 50 },
      existingExposure: [
        { marketId: "P1", text: "different politics question 1", category: "politics", notionalUsd: 80 },
        { marketId: "P2", text: "another politics question 2", category: "politics", notionalUsd: 80 },
      ],
      equity: 1000,
      categoryCapFractionOverride: 0.2, // 20% cap of $1000 = $200
    });
    // Would-be politics exposure = 80 + 80 + 50 = 210 > 200
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("category_cap_breached");
    }
  });

  it("allows category exposure exactly at cap", () => {
    const result = checkConcentration({
      candidate: { text: "category cap edge", category: "politics", notionalUsd: 40 },
      existingExposure: [
        { marketId: "P1", text: "first politics", category: "politics", notionalUsd: 80 },
        { marketId: "P2", text: "second politics", category: "politics", notionalUsd: 80 },
      ],
      equity: 1000,
      categoryCapFractionOverride: 0.2,
    });
    // 80 + 80 + 40 = 200, exactly equal to 20% cap → allowed.
    expect(result.allowed).toBe(true);
  });
});

describe("sendOperatorAlert", () => {
  it("returns attempted=false when no webhook is configured", async () => {
    const result = await sendOperatorAlert(
      { kind: "manual", severity: "info", message: "test" },
      { webhookUrl: "" },
    );
    expect(result.attempted).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("posts a JSON body with text + structured alert when webhook is set", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    const result = await sendOperatorAlert(
      {
        kind: "kill_switch_activated",
        severity: "critical",
        message: "all positions closing",
        details: { totalPositions: 3 },
        triggeredByOpenId: "user:42",
      },
      { webhookUrl: "https://hooks.example/abc", fetcher },
    );
    expect(result.attempted).toBe(true);
    expect(result.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://hooks.example/abc");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.text).toContain("kill_switch_activated");
    expect(body.text).toContain("user:42");
    expect(body.alert.kind).toBe("kill_switch_activated");
    expect(body.alert.severity).toBe("critical");
    expect(body.alert.details).toEqual({ totalPositions: 3 });
  });

  it("never throws on fetch failure — returns ok=false", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await sendOperatorAlert(
      { kind: "manual", severity: "warn", message: "x" },
      { webhookUrl: "https://hooks.example/x", fetcher },
    );
    expect(result.attempted).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("network down");
  });
});

describe("decideStopLoss", () => {
  const baseThresholds = {
    nowMs: new Date("2026-05-02T12:00:00Z").getTime(),
    lossFraction: 0.3,
    maxHoldHours: 72,
  };

  it("holds positions that are profitable and recent", () => {
    const result = decideStopLoss(
      {
        id: 1,
        marketId: "M1",
        side: "yes",
        entryPrice: 0.4,
        currentPrice: 0.55, // up 15c on YES
        quantity: 10,
        openedAt: new Date("2026-05-02T08:00:00Z").toISOString(),
      },
      baseThresholds,
    );
    expect(result.decision).toBe("hold");
    expect(result.unrealizedPnl).toBeCloseTo(1.5, 2);
  });

  it("triggers stop-loss when YES position has dropped past threshold", () => {
    // entry 0.5 × qty 10 = $5 exposure. 30% threshold = -$1.50 PnL.
    // Drop to 0.3 → pnl = (0.3 - 0.5) * 10 = -$2 → trips.
    const result = decideStopLoss(
      {
        id: 2,
        marketId: "M2",
        side: "yes",
        entryPrice: 0.5,
        currentPrice: 0.3,
        quantity: 10,
        openedAt: new Date("2026-05-02T11:00:00Z").toISOString(),
      },
      baseThresholds,
    );
    expect(result.decision).toBe("close_stop_loss");
    expect(result.unrealizedPnl).toBeCloseTo(-2, 2);
  });

  it("triggers stop-loss for NO positions when price moves up", () => {
    // entry 0.4 × qty 10 = $4 exposure. 30% threshold = -$1.20 PnL.
    // NO side: pnl = (entry - current) * qty = (0.4 - 0.7) * 10 = -$3 → trips.
    const result = decideStopLoss(
      {
        id: 3,
        marketId: "M3",
        side: "no",
        entryPrice: 0.4,
        currentPrice: 0.7,
        quantity: 10,
        openedAt: new Date("2026-05-02T11:30:00Z").toISOString(),
      },
      baseThresholds,
    );
    expect(result.decision).toBe("close_stop_loss");
    expect(result.unrealizedPnl).toBeCloseTo(-3, 2);
  });

  it("triggers time-stop when ageHours exceeds maxHoldHours", () => {
    const result = decideStopLoss(
      {
        id: 4,
        marketId: "M4",
        side: "yes",
        entryPrice: 0.5,
        currentPrice: 0.51, // barely moved → would otherwise hold
        quantity: 10,
        openedAt: new Date("2026-04-29T11:00:00Z").toISOString(), // > 72h ago
      },
      baseThresholds,
    );
    expect(result.decision).toBe("close_time_stop");
    expect(result.ageHours).toBeGreaterThan(72);
  });

  it("stop-loss takes priority over time-stop when both trigger", () => {
    const result = decideStopLoss(
      {
        id: 5,
        marketId: "M5",
        side: "yes",
        entryPrice: 0.5,
        currentPrice: 0.2, // heavy loss
        quantity: 10,
        openedAt: new Date("2026-04-29T08:00:00Z").toISOString(), // also old
      },
      baseThresholds,
    );
    expect(result.decision).toBe("close_stop_loss");
  });
});
