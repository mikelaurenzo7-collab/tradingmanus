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
  confidence: 0.83,
  marketPrice: 0.43,
  impliedProbability: 0.57,
  expectedValue: 0.18,
  reasoning: "Explicit probability edge",
};

function okOpenAiResponse(content: string) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content,
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function anthropicResponse(content: string) {
  return {
    content: [
      {
        type: "text",
        text: content,
      },
    ],
  };
}

describe("AI trader duo reviewer", () => {
  it("reports readiness only when both providers are configured", () => {
    expect(
      isTradingReviewerConfigured({
        openaiApiKey: "openai-key",
        anthropicApiKey: "anthropic-key",
      })
    ).toBe(true);
    expect(
      isTradingReviewerConfigured({
        openaiApiKey: "openai-key",
      })
    ).toBe(false);
    expect(
      isTradingReviewerConfigured({
        anthropicApiKey: "anthropic-key",
      })
    ).toBe(false);
  });

  it("blends OpenAI and Claude approvals conservatively", async () => {
    const result = await reviewSignalsWithTrader(
      {
        markets: [baseMarket as any],
        signals: [baseSignal as any],
        maxSignals: 1,
      },
      {
        providers: ["openai", "anthropic"],
        skipInTest: false,
        openaiApiKey: "openai-key",
        anthropicApiKey: "anthropic-key",
        openaiFetchImpl: vi.fn().mockResolvedValue(
          okOpenAiResponse(
            JSON.stringify({
              reviews: [
                {
                  marketId: "KXTEST-1",
                  approved: true,
                  confidenceAdjustment: 0.15,
                  expectedValueAdjustment: 0.08,
                  reasoning: "OpenAI sees a liquid, bounded edge.",
                },
              ],
            })
          )
        ),
        anthropicClient: {
          messages: {
            create: vi.fn().mockResolvedValue(
              anthropicResponse(
                JSON.stringify({
                  reviews: [
                    {
                      marketId: "KXTEST-1",
                      approved: true,
                      confidenceAdjustment: 0.05,
                      expectedValueAdjustment: 0.02,
                      reasoning: "Claude agrees after conservative review.",
                    },
                  ],
                })
              )
            ),
          },
        },
      }
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.confidence).toBeCloseTo(0.93, 6);
    expect(result[0]?.expectedValue).toBeCloseTo(0.23, 6);
    expect(result[0]?.reasoning).toContain("AI trader duo:");
    expect(result[0]?.reasoning).toContain("OpenAI:");
    expect(result[0]?.reasoning).toContain("Claude:");
  });

  it("fails closed before spending tokens when the duo is only partially configured", async () => {
    const openaiFetchImpl = vi.fn();
    const anthropicCreate = vi.fn();

    const result = await reviewSignalsWithTrader(
      {
        markets: [baseMarket as any],
        signals: [baseSignal as any],
      },
      {
        providers: ["openai", "anthropic"],
        skipInTest: false,
        openaiApiKey: "openai-key",
        openaiFetchImpl,
        anthropicClient: {
          messages: {
            create: anthropicCreate,
          },
        },
      }
    );

    expect(result).toEqual([]);
    expect(openaiFetchImpl).not.toHaveBeenCalled();
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("compacts signal reasoning before sending the review payload", async () => {
    const openaiFetchImpl = vi.fn().mockResolvedValue(
      okOpenAiResponse(
        JSON.stringify({
          reviews: [{ marketId: "KXTEST-1", approved: true, reasoning: "Approved." }],
        })
      )
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
        providers: ["openai", "anthropic"],
        skipInTest: false,
        openaiApiKey: "openai-key",
        anthropicApiKey: "anthropic-key",
        openaiFetchImpl,
        anthropicClient: {
          messages: {
            create: vi.fn().mockResolvedValue(
              anthropicResponse(
                JSON.stringify({
                  reviews: [{ marketId: "KXTEST-1", approved: true, reasoning: "Approved." }],
                })
              )
            ),
          },
        },
      }
    );

    const [, requestInit] = openaiFetchImpl.mock.calls[0] ?? [];
    const body = JSON.parse(String(requestInit?.body));
    const payload = JSON.parse(body.messages[1].content);

    expect(payload.markets[0]?.title.length).toBeLessThanOrEqual(MAX_MARKET_SUMMARY_TITLE_CHARS);
    expect(payload.signals[0]?.reasoning.length).toBeLessThanOrEqual(
      MAX_SIGNAL_SUMMARY_REASONING_CHARS
    );
    expect(payload.signals[0]?.reasoning).not.toContain("\n");
  });

  it("drops the signal when either provider vetoes it", async () => {
    const result = await reviewSignalsWithTrader(
      {
        markets: [baseMarket as any],
        signals: [baseSignal as any],
      },
      {
        providers: ["openai", "anthropic"],
        skipInTest: false,
        openaiApiKey: "openai-key",
        anthropicApiKey: "anthropic-key",
        openaiFetchImpl: vi.fn().mockResolvedValue(
          okOpenAiResponse(
            JSON.stringify({
              reviews: [{ marketId: "KXTEST-1", approved: true, reasoning: "Looks good." }],
            })
          )
        ),
        anthropicClient: {
          messages: {
            create: vi.fn().mockResolvedValue(
              anthropicResponse(
                JSON.stringify({
                  reviews: [{ marketId: "KXTEST-1", approved: false, reasoning: "Too thin." }],
                })
              )
            ),
          },
        },
      }
    );

    expect(result).toEqual([]);
  });

  it("fails closed when one provider returns malformed output", async () => {
    const result = await reviewSignalsWithTrader(
      {
        markets: [baseMarket as any],
        signals: [baseSignal as any],
      },
      {
        providers: ["openai", "anthropic"],
        skipInTest: false,
        openaiApiKey: "openai-key",
        anthropicApiKey: "anthropic-key",
        openaiFetchImpl: vi.fn().mockResolvedValue(okOpenAiResponse("not valid json")),
        anthropicClient: {
          messages: {
            create: vi.fn().mockResolvedValue(
              anthropicResponse(
                JSON.stringify({
                  reviews: [{ marketId: "KXTEST-1", approved: true, reasoning: "Approved." }],
                })
              )
            ),
          },
        },
      }
    );

    expect(result).toEqual([]);
  });

  it("fails closed when one provider times out", async () => {
    const result = await reviewSignalsWithTrader(
      {
        markets: [baseMarket as any],
        signals: [baseSignal as any],
      },
      {
        providers: ["openai", "anthropic"],
        skipInTest: false,
        openaiApiKey: "openai-key",
        anthropicApiKey: "anthropic-key",
        anthropicTimeoutMs: 5,
        openaiFetchImpl: vi.fn().mockResolvedValue(
          okOpenAiResponse(
            JSON.stringify({
              reviews: [{ marketId: "KXTEST-1", approved: true, reasoning: "Approved." }],
            })
          )
        ),
        anthropicClient: {
          messages: {
            create: vi.fn().mockImplementation(
              () => new Promise(() => undefined)
            ),
          },
        },
      }
    );

    expect(result).toEqual([]);
  });

  it("fails closed when no providers are configured", async () => {
    const result = await reviewSignalsWithTrader(
      {
        markets: [baseMarket as any],
        signals: [baseSignal as any],
      },
      {
        providers: ["openai", "anthropic"],
        skipInTest: false,
      }
    );

    expect(result).toEqual([]);
  });
});
