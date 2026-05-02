import { describe, expect, it, vi } from "vitest";
import {
  isOpenAiFallbackConfigured,
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
  // confidence below the high-stakes threshold so we test normal-stakes default path
  confidence: 0.7,
  marketPrice: 0.1,
  impliedProbability: 0.57,
  expectedValue: 0.18,
  reasoning: "Explicit probability edge",
};

const highStakesSignal = {
  ...baseSignal,
  marketId: "KXTEST-2",
  // 0.95 * 100 = $95 notional — well above the $25 high-stakes threshold
  marketPrice: 0.95,
  confidence: 0.95,
};

const highStakesMarket = { ...baseMarket, id: "KXTEST-2" };

function okOpenAiResponse(content: string) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

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

describe("AI trader reviewer (Claude-primary)", () => {
  it("treats Claude alone as configured; OpenAI is optional", () => {
    expect(isTradingReviewerConfigured({ anthropicApiKey: "anthropic-key" })).toBe(true);
    expect(
      isTradingReviewerConfigured({
        anthropicApiKey: "anthropic-key",
        openaiApiKey: "openai-key",
      }),
    ).toBe(true);
    expect(isTradingReviewerConfigured({ openaiApiKey: "openai-key" })).toBe(false);
    expect(isTradingReviewerConfigured({})).toBe(false);
  });

  it("reports the OpenAI fallback as configured when its key is present", () => {
    expect(isOpenAiFallbackConfigured({ openaiApiKey: "openai-key" })).toBe(true);
    expect(isOpenAiFallbackConfigured({ anthropicApiKey: "anthropic-key" })).toBe(false);
  });

  it("approves a normal-stakes trade on Claude review alone (OpenAI not invoked)", async () => {
    const openaiFetchImpl = vi.fn();
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
        // OpenAI key intentionally absent — fallback path only fires when key present
        openaiFetchImpl,
        anthropicClient: { messages: { create: anthropicCreate } },
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.reasoning).toContain("Claude solo review");
    expect(result[0]?.reasoning).not.toContain("AI trader duo");
    expect(openaiFetchImpl).not.toHaveBeenCalled();
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
  });

  it("on high-stakes trades, requires both Claude and OpenAI approval", async () => {
    const openaiFetchImpl = vi
      .fn()
      .mockResolvedValue(okOpenAiResponse(approvedReviewJson("KXTEST-2", "Liquid edge.")));
    const anthropicCreate = vi
      .fn()
      .mockResolvedValue(anthropicResponse(approvedReviewJson("KXTEST-2", "Approved.")));

    const result = await reviewSignalsWithTrader(
      {
        markets: [highStakesMarket as any],
        signals: [highStakesSignal as any],
        maxSignals: 1,
      },
      {
        skipInTest: false,
        anthropicApiKey: "anthropic-key",
        openaiApiKey: "openai-key",
        openaiFetchImpl,
        anthropicClient: { messages: { create: anthropicCreate } },
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.reasoning).toContain("AI trader duo");
    expect(result[0]?.reasoning).toContain("Claude:");
    expect(result[0]?.reasoning).toContain("OpenAI:");
    expect(openaiFetchImpl).toHaveBeenCalledTimes(1);
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
  });

  it("on high-stakes trades, vetoes when OpenAI second-opinion disagrees", async () => {
    const openaiFetchImpl = vi
      .fn()
      .mockResolvedValue(okOpenAiResponse(rejectedReviewJson("KXTEST-2", "Too thin.")));
    const anthropicCreate = vi
      .fn()
      .mockResolvedValue(anthropicResponse(approvedReviewJson("KXTEST-2", "Looks fine.")));

    const result = await reviewSignalsWithTrader(
      {
        markets: [highStakesMarket as any],
        signals: [highStakesSignal as any],
        maxSignals: 1,
      },
      {
        skipInTest: false,
        anthropicApiKey: "anthropic-key",
        openaiApiKey: "openai-key",
        openaiFetchImpl,
        anthropicClient: { messages: { create: anthropicCreate } },
      },
    );

    expect(result).toEqual([]);
  });

  it("falls back to OpenAI per-market when Claude omits the review", async () => {
    const openaiFetchImpl = vi
      .fn()
      .mockResolvedValue(okOpenAiResponse(approvedReviewJson("KXTEST-1", "OpenAI fallback OK.")));
    // Claude returns an empty review array — does not cover this market.
    const anthropicCreate = vi
      .fn()
      .mockResolvedValue(anthropicResponse(JSON.stringify({ reviews: [] })));

    const result = await reviewSignalsWithTrader(
      {
        markets: [baseMarket as any],
        signals: [baseSignal as any],
        maxSignals: 1,
      },
      {
        skipInTest: false,
        anthropicApiKey: "anthropic-key",
        openaiApiKey: "openai-key",
        openaiFetchImpl,
        anthropicClient: { messages: { create: anthropicCreate } },
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.reasoning).toContain("OpenAI solo review");
  });

  it("falls back to OpenAI when the Claude API call throws", async () => {
    const openaiFetchImpl = vi
      .fn()
      .mockResolvedValue(okOpenAiResponse(approvedReviewJson("KXTEST-1", "OpenAI fallback OK.")));
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
        openaiApiKey: "openai-key",
        openaiFetchImpl,
        anthropicClient: { messages: { create: anthropicCreate } },
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.reasoning).toContain("OpenAI solo review");
  });

  it("drops the signal when Claude vetoes (normal-stakes — OpenAI second opinion never consulted)", async () => {
    const openaiFetchImpl = vi
      .fn()
      .mockResolvedValue(okOpenAiResponse(approvedReviewJson("KXTEST-1", "Looks fine.")));
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
        openaiApiKey: "openai-key",
        openaiFetchImpl,
        anthropicClient: { messages: { create: anthropicCreate } },
      },
    );

    expect(result).toEqual([]);
  });

  it("drops the signal when both providers fail", async () => {
    const openaiFetchImpl = vi.fn().mockRejectedValue(new Error("OpenAI 503"));
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
        openaiApiKey: "openai-key",
        openaiFetchImpl,
        anthropicClient: { messages: { create: anthropicCreate } },
      },
    );

    expect(result).toEqual([]);
  });

  it("fails closed when no providers are configured at all", async () => {
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
});
