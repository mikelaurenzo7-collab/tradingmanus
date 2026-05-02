import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./db", () => ({
  logAuditEvent: dbMocks.logAuditEvent,
}));

import {
  isShadowModeEnabled,
  recordKalshiShadowOrder,
  recordPolymarketShadowOrder,
} from "./_core/shadowMode";
import { ENV } from "./_core/env";

describe("shadowMode", () => {
  beforeEach(() => {
    dbMocks.logAuditEvent.mockClear();
  });

  it("isShadowModeEnabled mirrors ENV.shadowTradingMode", () => {
    expect(isShadowModeEnabled()).toBe(ENV.shadowTradingMode);
  });

  it("recordKalshiShadowOrder writes a kalshi_shadow_order_intent audit event with full context", async () => {
    const result = await recordKalshiShadowOrder({
      userId: 7,
      triggeredByOpenId: "user:7",
      marketId: "KX-01",
      marketTitle: "Lakers win NBA Finals",
      side: "yes",
      quantity: 12,
      limitPrice: 0.45,
      signalConfidence: 0.78,
      signalReasoning: "Momentum confirmed by liquidity surge.",
      expectedValue: 0.18,
      availableCapital: 500,
      orderExposure: 5.4,
      maxLossOnTrade: 5.4,
    });

    expect(result.success).toBe(true);
    expect(result.shadow).toBe(true);
    expect(result.orderId).toMatch(/^shadow:kalshi:/);
    expect(dbMocks.logAuditEvent).toHaveBeenCalledTimes(1);
    const [eventType, detailsJson, openId] = dbMocks.logAuditEvent.mock.calls[0];
    expect(eventType).toBe("kalshi_shadow_order_intent");
    expect(openId).toBe("user:7");
    const details = JSON.parse(detailsJson);
    expect(details).toMatchObject({
      marketId: "KX-01",
      side: "yes",
      quantity: 12,
      limitPrice: 0.45,
      notional: 5.4,
      maxLossOnTrade: 5.4,
      signalConfidence: 0.78,
      reasoning: "Momentum confirmed by liquidity surge.",
    });
    expect(details.shadowOrderId).toMatch(/^shadow:kalshi:/);
  });

  it("recordPolymarketShadowOrder writes a polymarket_shadow_order_intent audit event", async () => {
    const result = await recordPolymarketShadowOrder({
      userId: 9,
      triggeredByOpenId: "user:9",
      marketId: "PM-42",
      question: "Will it rain tomorrow?",
      tokenId: "tok-yes-1",
      side: "yes",
      limitPrice: 0.55,
      sizeUsdc: 25,
      signalConfidence: 0.82,
      signalType: "value_play",
      signalReasoning: "Forecast diverges from price.",
    });

    expect(result.shadow).toBe(true);
    expect(result.orderId).toMatch(/^shadow:polymarket:/);
    expect(dbMocks.logAuditEvent).toHaveBeenCalledWith(
      "polymarket_shadow_order_intent",
      expect.any(String),
      "user:9",
    );
    const details = JSON.parse(dbMocks.logAuditEvent.mock.calls[0][1]);
    expect(details).toMatchObject({
      marketId: "PM-42",
      tokenId: "tok-yes-1",
      side: "yes",
      limitPrice: 0.55,
      sizeUsdc: 25,
      signalType: "value_play",
    });
  });

  it("truncates long reasoning to 600 chars", async () => {
    const long = "x".repeat(1500);
    await recordKalshiShadowOrder({
      userId: 1,
      triggeredByOpenId: "user:1",
      marketId: "KX-2",
      side: "no",
      quantity: 1,
      limitPrice: 0.9,
      signalConfidence: 0.9,
      signalReasoning: long,
      expectedValue: 0.1,
      availableCapital: 100,
      orderExposure: 0.9,
      maxLossOnTrade: 0.9,
    });
    const details = JSON.parse(dbMocks.logAuditEvent.mock.calls[0][1]);
    expect(details.reasoning.length).toBe(600);
  });
});

describe("getEstimatedUsdCost", () => {
  it("returns 0 for an empty telemetry struct", async () => {
    const { newReviewerTelemetry, getEstimatedUsdCost } = await import("./_core/aiToolbelt");
    const telemetry = newReviewerTelemetry();
    expect(getEstimatedUsdCost(telemetry)).toBe(0);
  });

  it("scales with token counts and uses Sonnet pricing by default", async () => {
    const { newReviewerTelemetry, getEstimatedUsdCost } = await import("./_core/aiToolbelt");
    const telemetry = newReviewerTelemetry();
    telemetry.inputTokens = 1_000_000; // 1M input → $3
    telemetry.outputTokens = 1_000_000; // 1M output → $15
    expect(getEstimatedUsdCost(telemetry)).toBeCloseTo(18, 4);
  });

  it("applies cache_read at 10% of input price", async () => {
    const { newReviewerTelemetry, getEstimatedUsdCost } = await import("./_core/aiToolbelt");
    const telemetry = newReviewerTelemetry();
    telemetry.cacheReadInputTokens = 1_000_000; // 1M cache reads → $3 * 0.1 = $0.30
    expect(getEstimatedUsdCost(telemetry)).toBeCloseTo(0.3, 4);
  });

  it("applies cache_creation at 1.25x input price", async () => {
    const { newReviewerTelemetry, getEstimatedUsdCost } = await import("./_core/aiToolbelt");
    const telemetry = newReviewerTelemetry();
    telemetry.cacheCreationInputTokens = 1_000_000; // 1M cache creates → $3 * 1.25 = $3.75
    expect(getEstimatedUsdCost(telemetry)).toBeCloseTo(3.75, 4);
  });

  it("uses Haiku pricing when model name starts with claude-haiku", async () => {
    const { newReviewerTelemetry, getEstimatedUsdCost } = await import("./_core/aiToolbelt");
    const telemetry = newReviewerTelemetry();
    telemetry.inputTokens = 1_000_000;
    telemetry.outputTokens = 1_000_000;
    // Haiku: $0.80 + $4.00 = $4.80
    expect(getEstimatedUsdCost(telemetry, "claude-haiku-4-5-20251001")).toBeCloseTo(4.8, 4);
  });

  it("uses Opus pricing when model name starts with claude-opus", async () => {
    const { newReviewerTelemetry, getEstimatedUsdCost } = await import("./_core/aiToolbelt");
    const telemetry = newReviewerTelemetry();
    telemetry.inputTokens = 1_000_000;
    telemetry.outputTokens = 1_000_000;
    // Opus: $15 + $75 = $90
    expect(getEstimatedUsdCost(telemetry, "claude-opus-4-7")).toBeCloseTo(90, 4);
  });

  it("falls back to Sonnet pricing for unknown models", async () => {
    const { newReviewerTelemetry, getEstimatedUsdCost } = await import("./_core/aiToolbelt");
    const telemetry = newReviewerTelemetry();
    telemetry.inputTokens = 1_000_000;
    telemetry.outputTokens = 1_000_000;
    expect(getEstimatedUsdCost(telemetry, "claude-mystery-9")).toBeCloseTo(18, 4);
  });
});
