import { describe, expect, it, vi } from "vitest";
import { reviewSignalsWithTrader } from "./_core/tradingReviewer";

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
