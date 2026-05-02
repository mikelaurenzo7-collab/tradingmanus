import { describe, expect, it, vi } from "vitest";
import { reviewArbitrageOpportunities } from "./_core/arbitrageReviewer";
import type { CrossPlatformArbitrageOpportunity } from "./_core/crossPlatformArbitrage";

const baseOpp: CrossPlatformArbitrageOpportunity = {
  type: "buy_kalshi_yes_sell_polymarket_yes",
  kalshiMarketId: "KX-1",
  kalshiTitle: "Lakers win NBA Finals",
  polymarketMarketId: "PM-1",
  polymarketQuestion: "Will the Lakers win the NBA Finals?",
  kalshiYesPrice: 0.45,
  polymarketYesPrice: 0.58,
  spread: 0.13,
  netEdge: 0.12,
  buyPlatform: "kalshi",
  sellPlatform: "polymarket",
  confidence: 0.78,
  reasoning: "Scanner: large spread, similar question",
  minLiquidity: 5000,
};

function anthropicResponse(content: string) {
  return { content: [{ type: "text", text: content }] };
}

function approvedReviewJson(pairId: string, sizeFraction = 0.4) {
  return JSON.stringify({
    reviews: [
      { pairId, approved: true, sizeFraction, reasoning: "Same event, deep liquidity, edge survives fees." },
    ],
  });
}

describe("arbitrageReviewer", () => {
  it("returns approved opportunities annotated with sizeFraction and reasoning", async () => {
    const create = vi
      .fn()
      .mockResolvedValue(anthropicResponse(approvedReviewJson("KX-1::PM-1", 0.5)));

    const result = await reviewArbitrageOpportunities([baseOpp], {
      skipInTest: false,
      anthropicApiKey: "anthropic-key",
      anthropicClient: { messages: { create } },
    });

    expect(result).toHaveLength(1);
    expect(result[0].pairId).toBe("KX-1::PM-1");
    expect(result[0].sizeFraction).toBe(0.5);
    expect(result[0].reviewerReasoning).toMatch(/Same event/);
  });

  it("vetoes drop the opportunity entirely", async () => {
    const create = vi.fn().mockResolvedValue(
      anthropicResponse(
        JSON.stringify({
          reviews: [{ pairId: "KX-1::PM-1", approved: false, reasoning: "Different resolution criteria" }],
        }),
      ),
    );

    const result = await reviewArbitrageOpportunities([baseOpp], {
      skipInTest: false,
      anthropicApiKey: "anthropic-key",
      anthropicClient: { messages: { create } },
    });

    expect(result).toEqual([]);
  });

  it("zero sizeFraction is treated as a veto even if approved=true", async () => {
    const create = vi
      .fn()
      .mockResolvedValue(anthropicResponse(approvedReviewJson("KX-1::PM-1", 0)));

    const result = await reviewArbitrageOpportunities([baseOpp], {
      skipInTest: false,
      anthropicApiKey: "anthropic-key",
      anthropicClient: { messages: { create } },
    });

    expect(result).toEqual([]);
  });

  it("missing review for a pair drops that pair", async () => {
    const opp2 = { ...baseOpp, kalshiMarketId: "KX-2", polymarketMarketId: "PM-2" };
    const create = vi.fn().mockResolvedValue(
      anthropicResponse(approvedReviewJson("KX-1::PM-1", 0.3)),
    );

    const result = await reviewArbitrageOpportunities([baseOpp, opp2], {
      skipInTest: false,
      anthropicApiKey: "anthropic-key",
      anthropicClient: { messages: { create } },
    });

    expect(result).toHaveLength(1);
    expect(result[0].pairId).toBe("KX-1::PM-1");
  });

  it("drops everything when Claude is not configured", async () => {
    const result = await reviewArbitrageOpportunities([baseOpp], { skipInTest: false });
    expect(result).toEqual([]);
  });

  it("drops everything when the Claude call throws", async () => {
    const create = vi.fn().mockRejectedValue(new Error("503"));
    const result = await reviewArbitrageOpportunities([baseOpp], {
      skipInTest: false,
      anthropicApiKey: "anthropic-key",
      anthropicClient: { messages: { create } },
    });
    expect(result).toEqual([]);
  });

  it("appends [cites: ...] to reasoning when web_search returned citations", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "web_search_tool_result",
          content: [{ url: "https://www.espn.com/nba", title: "ESPN" }],
        },
        { type: "text", text: approvedReviewJson("KX-1::PM-1", 0.4) },
      ],
    });

    const result = await reviewArbitrageOpportunities([baseOpp], {
      skipInTest: false,
      anthropicApiKey: "anthropic-key",
      anthropicClient: { messages: { create } },
    });

    expect(result).toHaveLength(1);
    expect(result[0].reviewerReasoning).toContain("[cites: espn.com]");
    expect(result[0].citations).toHaveLength(1);
  });
});
