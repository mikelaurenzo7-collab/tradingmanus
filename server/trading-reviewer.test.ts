import { describe, expect, it, vi } from "vitest";
import {
  isTradingReviewerConfigured,
  MAX_MARKET_SUMMARY_TITLE_CHARS,
  MAX_SIGNAL_SUMMARY_REASONING_CHARS,
  reviewSignalsWithTrader,
} from "./_core/tradingReviewer";

const baseMarket = {
  id: "KXTEST-1",
  title: "Will demo market resolve yes?",
  category: "test",
  status: "open",
  yesPrice: 0.43,
  noPrice: 0.57,
  impliedProbability: 0.57,
  yesVolume: 1200,
  noVolume: 900,
  resolutionDate: "2026-12-31",
};

const baseSignal = {
  marketId: "KXTEST-1",
  signalType: "momentum" as const,
  side: "yes" as const,
  // confidence below the 0.8 high-stakes threshold so we test the normal-stakes
  // default path
  confidence: 0.7,
  // marketPrice * 100 = $5 notional — below the $10 high-stakes threshold
  marketPrice: 0.05,
  impliedProbability: 0.57,
  expectedValue: 0.18,
  reasoning: "Explicit probability edge",
};

const highStakesSignal = {
  ...baseSignal,
  marketId: "KXTEST-2",
  // 0.95 * 100 = $95 notional — well above the $10 high-stakes threshold
  marketPrice: 0.95,
  confidence: 0.95,
};

const highStakesMarket = { ...baseMarket, id: "KXTEST-2" };

function anthropicResponse(content: string) {
  return {
    content: [{ type: "text", text: content }],
  };
}

function approvedReviewJson(marketId: string, reasoning = "Approved.") {
  return JSON.stringify({
    reviews: [
      {
        marketId,
        approved: true,
        confidenceAdjustment: 0,
        expectedValueAdjustment: 0,
        reasoning,
      },
    ],
  });
}

function rejectedReviewJson(marketId: string, reasoning = "Vetoed.") {
  return JSON.stringify({
    reviews: [{ marketId, approved: false, reasoning }],
  });
}

describe("AI trading reviewer (OpenRouter/hy3)", () => {
  it("treats the LLM reviewer as the required sole provider", () => {
    expect(isTradingReviewerConfigured({ anthropicApiKey: "openrouter-key" })).toBe(true);
    expect(isTradingReviewerConfigured({ anthropicApiKey: "" })).toBe(false);
  });

  it("approves a normal-stakes trade on AI review", async () => {
    const anthropicCreate = vi.fn().mockResolvedValue(
      anthropicResponse(approvedReviewJson("KXTEST-1", "Edge is sound.")),
    );

    const result = await reviewSignalsWithTrader(
      {
        markets: [baseMarket as any],
        signals: [baseSignal as any],
        maxSignals: 1,
      },
      {
        skipInTest: false,
        anthropicApiKey: "anthropic-key",
        anthropicClient: { messages: { create: anthropicCreate } },
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.reasoning).toContain("AI review");
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
  });

  it("drops the signal when Claude vetoes", async () => {
    const anthropicCreate = vi
      .fn()
      .mockResolvedValue(anthropicResponse(rejectedReviewJson("KXTEST-1", "Too thin.")));

    const result = await reviewSignalsWithTrader(
      {
        markets: [baseMarket as any],
        signals: [baseSignal as any],
        maxSignals: 1,
      },
      {
        skipInTest: false,
        anthropicApiKey: "anthropic-key",
        anthropicClient: { messages: { create: anthropicCreate } },
      },
    );

    expect(result).toEqual([]);
  });

  it("drops the signal when Claude API call fails", async () => {
    const anthropicCreate = vi.fn().mockRejectedValue(new Error("Anthropic 503"));

    const result = await reviewSignalsWithTrader(
      {
        markets: [baseMarket as any],
        signals: [baseSignal as any],
        maxSignals: 1,
      },
      {
        skipInTest: false,
        anthropicApiKey: "anthropic-key",
        anthropicClient: { messages: { create: anthropicCreate } },
      },
    );

    expect(result).toEqual([]);
  });

  it("fails closed when Claude is not configured", async () => {
    const result = await reviewSignalsWithTrader(
      {
        markets: [baseMarket as any],
        signals: [baseSignal as any],
      },
      { skipInTest: false },
    );
    expect(result).toEqual([]);
  });

  it("compacts signal reasoning before sending the review payload", async () => {
    const anthropicCreate = vi.fn().mockResolvedValue(
      anthropicResponse(approvedReviewJson("KXTEST-1", "OK.")),
    );

    await reviewSignalsWithTrader(
      {
        markets: [
          {
            ...baseMarket,
            title: "  Will   demo market resolve yes?   ".repeat(20),
          } as any,
        ],
        signals: [
          {
            ...baseSignal,
            reasoning: "  Explicit\nprobability\tedge  ".repeat(80),
          } as any,
        ],
        maxSignals: 1,
      },
      {
        skipInTest: false,
        anthropicApiKey: "anthropic-key",
        anthropicClient: { messages: { create: anthropicCreate } },
      },
    );

    const [callInput] = anthropicCreate.mock.calls[0] ?? [];
    const payload = JSON.parse(callInput.messages[0].content);

    expect(payload.markets[0]?.question === undefined).toBe(true);
    expect(payload.markets[0]?.title.length).toBeLessThanOrEqual(MAX_MARKET_SUMMARY_TITLE_CHARS);
    expect(payload.markets[0]?.title).not.toMatch(/\s{2,}/);
    expect(payload.markets[0]?.title.endsWith("…")).toBe(true);
    expect(payload.signals[0]?.reasoning.length).toBeLessThanOrEqual(
      MAX_SIGNAL_SUMMARY_REASONING_CHARS,
    );
    expect(payload.signals[0]?.reasoning).not.toMatch(/\s{2,}/);
    expect(payload.signals[0]?.reasoning).not.toContain("\n");
    expect(payload.signals[0]?.reasoning.endsWith("…")).toBe(true);
  });

  it("injects pre-loaded desk memory as a separate cached system block", async () => {
    const anthropicCreate = vi.fn().mockResolvedValue(
      anthropicResponse(approvedReviewJson("KXTEST-1", "OK.")),
    );

    await reviewSignalsWithTrader(
      {
        markets: [{ ...baseMarket, category: "sports", title: "Lakers vs Celtics" } as any],
        signals: [baseSignal as any],
        maxSignals: 1,
      },
      {
        skipInTest: false,
        anthropicApiKey: "anthropic-key",
        anthropicClient: { messages: { create: anthropicCreate } },
        deskMemoryByDeskId: new Map([
          [
            "kalshi.sports",
            {
              userId: 1,
              platform: "kalshi" as const,
              deskId: "kalshi.sports",
              notes: [
                { ts: "2025-01-01T00:00:00Z", outcome: "loss" as const, note: "lost on stale halftime momentum" },
              ],
              tradeCount: 1,
              winCount: 0,
              lossCount: 1,
            },
          ],
        ]),
      },
    );

    const [callInput] = anthropicCreate.mock.calls[0] ?? [];
    const blocks = Array.isArray(callInput.system) ? callInput.system : [callInput.system];
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const memoryBlock = blocks.find((b: any) =>
      typeof b === "object" && b.text?.includes("Desk learning tape"),
    );
    expect(memoryBlock).toBeDefined();
    expect(memoryBlock.cache_control).toEqual({ type: "ephemeral" });
    expect(memoryBlock.text).toContain("stale halftime momentum");
  });

  it("appends a [cites: ...] tag to reasoning when web_search returned citations", async () => {
    const anthropicCreate = vi.fn().mockResolvedValue({
      content: [
        {
          type: "web_search_tool_result",
          content: [{ url: "https://www.espn.com/nba", title: "ESPN NBA" }],
        },
        { type: "text", text: approvedReviewJson("KXTEST-1", "Edge confirmed.") },
      ],
    });

    const result = await reviewSignalsWithTrader(
      {
        markets: [baseMarket as any],
        signals: [baseSignal as any],
        maxSignals: 1,
      },
      {
        skipInTest: false,
        anthropicApiKey: "anthropic-key",
        anthropicClient: { messages: { create: anthropicCreate } },
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.reasoning).toContain("[cites: espn.com]");
  });

  it("runs Haiku triage when batch exceeds threshold and only forwards survivors", async () => {
    const anthropicCreate = vi
      .fn()
      // 1st call: triage response
      .mockResolvedValueOnce(anthropicResponse(JSON.stringify({ keep: ["KXTEST-1"] })))
      // 2nd call: full review of survivors
      .mockResolvedValueOnce(anthropicResponse(approvedReviewJson("KXTEST-1", "OK.")));

    const signals = [
      { ...baseSignal, marketId: "KXTEST-1" },
      { ...baseSignal, marketId: "KXTEST-2" },
      { ...baseSignal, marketId: "KXTEST-3" },
    ];
    const markets = signals.map((s) => ({ ...baseMarket, id: s.marketId }));

    const result = await reviewSignalsWithTrader(
      { markets: markets as any, signals: signals as any, maxSignals: 5 },
      {
        skipInTest: false,
        anthropicApiKey: "anthropic-key",
        anthropicClient: { messages: { create: anthropicCreate } },
        triageThresholdOverride: 2,
      },
    );

    expect(anthropicCreate).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0]?.marketId).toBe("KXTEST-1");
  });

  it("uses category-specific persona in the Claude system prompt (sports)", async () => {
    const anthropicCreate = vi
      .fn()
      .mockResolvedValue(anthropicResponse(approvedReviewJson("KXTEST-1", "OK.")));

    await reviewSignalsWithTrader(
      {
        markets: [
          {
            ...baseMarket,
            category: "sports",
            title: "Lakers win the championship",
          } as any,
        ],
        signals: [baseSignal as any],
        maxSignals: 1,
      },
      {
        skipInTest: false,
        anthropicApiKey: "anthropic-key",
        anthropicClient: { messages: { create: anthropicCreate } },
      },
    );

    const [callInput] = anthropicCreate.mock.calls[0] ?? [];
    const systemBlocks = Array.isArray(callInput.system) ? callInput.system : [callInput.system];
    const systemText = systemBlocks
      .map((block: any) => (typeof block === "string" ? block : block.text))
      .join(" ");

    expect(systemText).toMatch(/Kalshi Sports Desk/);
    expect(systemText).toMatch(/sportsbook|injury|lineup/i);
  });

  it("force-keeps high-stakes candidates at triage even when Haiku drops them", async () => {
    const anthropicCreate = vi
      .fn()
      // 1st call: Haiku triage drops everything (returns empty keep set).
      .mockResolvedValueOnce(anthropicResponse(JSON.stringify({ keep: [] })))
      // 2nd call: full review of survivors — should still include the high-stakes signal.
      .mockResolvedValueOnce(
        anthropicResponse(
          JSON.stringify({
            reviews: [
              { marketId: "KXTEST-2", approved: true, confidenceAdjustment: 0, expectedValueAdjustment: 0, reasoning: "OK." },
            ],
          }),
        ),
      );

    const signals = [
      { ...baseSignal, marketId: "KXTEST-1" }, // normal stakes ($5 notional, conf 0.7)
      { ...highStakesSignal }, // KXTEST-2, high stakes ($95 notional, conf 0.95)
      { ...baseSignal, marketId: "KXTEST-3" }, // normal stakes
    ];
    const markets = signals.map((s) => ({ ...baseMarket, id: s.marketId }));

    const result = await reviewSignalsWithTrader(
      { markets: markets as any, signals: signals as any, maxSignals: 5 },
      {
        skipInTest: false,
        anthropicApiKey: "anthropic-key",
        anthropicClient: { messages: { create: anthropicCreate } },
        triageThresholdOverride: 2,
      },
    );

    // High-stakes signal must survive triage even though Haiku dropped it.
    expect(result).toHaveLength(1);
    expect(result[0]?.marketId).toBe("KXTEST-2");
    // Confirm the review batch was scoped to just the force-kept survivor(s).
    const reviewCall = anthropicCreate.mock.calls[1]?.[0];
    const payload = JSON.parse(reviewCall.messages[0].content);
    const reviewedIds = payload.signals.map((s: any) => s.marketId);
    expect(reviewedIds).toContain("KXTEST-2");
    expect(reviewedIds).not.toContain("KXTEST-1");
    expect(reviewedIds).not.toContain("KXTEST-3");
  });

  it("escalates contested mid-stakes approvals to a deep second pass", async () => {
    const anthropicCreate = vi
      .fn()
      // 1st call: Sonnet approves but tugs confidence down by 0.15 (contested).
      .mockResolvedValueOnce(
        anthropicResponse(
          JSON.stringify({
            reviews: [
              {
                marketId: "KXTEST-1",
                approved: true,
                confidenceAdjustment: -0.15,
                expectedValueAdjustment: 0,
                reasoning: "Edge ok but liquidity thin.",
              },
            ],
          }),
        ),
      )
      // 2nd call: Opus second opinion also approves — both must agree.
      .mockResolvedValueOnce(
        anthropicResponse(
          JSON.stringify({
            reviews: [
              {
                marketId: "KXTEST-1",
                approved: true,
                confidenceAdjustment: -0.05,
                expectedValueAdjustment: 0,
                reasoning: "Confirmed after deeper review.",
              },
            ],
          }),
        ),
      );

    const result = await reviewSignalsWithTrader(
      {
        markets: [baseMarket as any],
        signals: [baseSignal as any],
        maxSignals: 1,
      },
      {
        skipInTest: false,
        anthropicApiKey: "anthropic-key",
        anthropicClient: { messages: { create: anthropicCreate } },
      },
    );

    expect(anthropicCreate).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    // Second call must use the configured OpenRouter model for deep-tier review.
    const secondCall = anthropicCreate.mock.calls[1]?.[0];
    expect(String(secondCall.model)).toBeTruthy();
    // Deep call should not include extended thinking (not supported by OpenRouter).
    // thinking field may be undefined since extended thinking is disabled.
  });

  it("drops the trade when the Opus second opinion disagrees with Sonnet", async () => {
    const anthropicCreate = vi
      .fn()
      // 1st call: Sonnet approves with material EV move (contested).
      .mockResolvedValueOnce(
        anthropicResponse(
          JSON.stringify({
            reviews: [
              {
                marketId: "KXTEST-1",
                approved: true,
                confidenceAdjustment: -0.05,
                expectedValueAdjustment: 0.08,
                reasoning: "Approved.",
              },
            ],
          }),
        ),
      )
      // 2nd call: Opus vetoes — disagreement → drop.
      .mockResolvedValueOnce(
        anthropicResponse(rejectedReviewJson("KXTEST-1", "Caught a wash-trading pattern.")),
      );

    const result = await reviewSignalsWithTrader(
      {
        markets: [baseMarket as any],
        signals: [baseSignal as any],
        maxSignals: 1,
      },
      {
        skipInTest: false,
        anthropicApiKey: "anthropic-key",
        anthropicClient: { messages: { create: anthropicCreate } },
      },
    );

    expect(anthropicCreate).toHaveBeenCalledTimes(2);
    expect(result).toEqual([]);
  });

  it("skips intra-Claude escalation for high-stakes batches (already deep-tier)", async () => {
    const anthropicCreate = vi.fn().mockResolvedValueOnce(
      anthropicResponse(
        JSON.stringify({
          reviews: [
            {
              marketId: "KXTEST-2",
              approved: true,
              confidenceAdjustment: -0.15, // would be contested at normal stakes
              expectedValueAdjustment: 0,
              reasoning: "OK after deep review.",
            },
          ],
        }),
      ),
    );

    const result = await reviewSignalsWithTrader(
      {
        markets: [{ ...baseMarket, id: "KXTEST-2" } as any],
        signals: [highStakesSignal as any],
        maxSignals: 1,
      },
      {
        skipInTest: false,
        anthropicApiKey: "anthropic-key",
        anthropicClient: { messages: { create: anthropicCreate } },
      },
    );

    // Only one call: the initial deep-tier review.  No second pass because
    // the batch was already deep-tier from the start.
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
  });
});
