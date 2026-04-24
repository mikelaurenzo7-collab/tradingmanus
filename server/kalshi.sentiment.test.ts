import { afterEach, describe, expect, it, vi } from "vitest";
const dataApiMocks = vi.hoisted(() => ({
  callDataApi: vi.fn(),
}));

vi.mock("./_core/dataApi", () => ({
  callDataApi: dataApiMocks.callDataApi,
}));

import {
  calculateCompositeSentiment,
  fetchGdeltTopicSignal,
  fetchLiveNewsSummary,
  fetchLiveSocialSummary,
} from "./_core/kalshiSentiment";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("calculateCompositeSentiment", () => {
  it("incorporates the external source into the weighted sentiment and confidence", () => {
    const result = calculateCompositeSentiment({
      newsSentiment: 0.4,
      socialSentiment: 0.2,
      marketSentiment: 0.1,
      externalSentiment: 0.5,
      externalConfidence: 0.8,
    });

    expect(result.overallSentiment).toBeCloseTo(0.33, 6);
    expect(result.weights.external).toBeCloseTo(0.3, 6);
    expect(result.contributions.external).toBeCloseTo(0.15, 6);
    expect(result.confidence).toBeCloseTo(0.4475, 6);
  });

  it("normalizes custom weights before applying them", () => {
    const result = calculateCompositeSentiment({
      newsSentiment: 0.5,
      socialSentiment: 0,
      marketSentiment: 0,
      externalSentiment: 0.5,
      weights: {
        news: 2,
        social: 0,
        market: 0,
        external: 2,
      },
    });

    expect(result.weights.news).toBeCloseTo(0.5, 6);
    expect(result.weights.external).toBeCloseTo(0.5, 6);
    expect(result.overallSentiment).toBeCloseTo(0.5, 6);
  });

  it("falls back safely when non-finite external values are provided", () => {
    const result = calculateCompositeSentiment({
      newsSentiment: 0.2,
      socialSentiment: 0.1,
      marketSentiment: -0.1,
      externalSentiment: Number.NaN,
      externalConfidence: Number.POSITIVE_INFINITY,
    });

    expect(result.inputs.external).toBe(0);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("preserves live social metadata when the composite result includes a crowd-pulse refresh", () => {
    const result = calculateCompositeSentiment({
      newsSentiment: 0.1,
      socialSentiment: 0.25,
      marketSentiment: 0,
      liveSocial: {
        query: "Fed rates",
        subreddit: "economics",
        postCount: 2,
        mentions: 1,
        posts: [],
        derivedSentiment: 0.35,
        fetchedAt: new Date("2026-04-24T00:00:00.000Z"),
      },
    });

    expect(result.liveSocial).toMatchObject({
      subreddit: "economics",
      postCount: 2,
      mentions: 1,
    });
  });
});

describe("fetchLiveNewsSummary", () => {
  it("uses the GNews search endpoint and derives headline sentiment from returned articles", async () => {
    process.env.GNEWS_API_KEY = "test-gnews-key";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        articles: [
          {
            title: "Fed outlook turns bullish after strong jobs report",
            url: "https://example.com/fed-bullish",
            publishedAt: "2026-04-24T12:00:00.000Z",
            source: { name: "Reuters" },
          },
          {
            title: "Analysts warn of crash risk if inflation re-accelerates",
            url: "https://example.com/inflation-risk",
            publishedAt: "2026-04-24T10:00:00.000Z",
            source: { name: "Bloomberg" },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchLiveNewsSummary("Fed rates");

    expect(result).not.toBeNull();
    expect(result?.query).toBe("Fed rates");
    expect(result?.articleCount).toBe(2);
    expect(result?.headlines[0]?.source).toBe("Reuters");
    expect(result?.derivedSentiment).toBeGreaterThanOrEqual(-1);
    expect(result?.derivedSentiment).toBeLessThanOrEqual(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toContain("https://gnews.io/api/v4/search?");
    expect(fetchSpy.mock.calls[0]?.[0]).toContain("apikey=test-gnews-key");
  });

  it("returns null when no GNews key is available", async () => {
    const previous = process.env.GNEWS_API_KEY;
    delete process.env.GNEWS_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchLiveNewsSummary("Fed rates");

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    process.env.GNEWS_API_KEY = previous;
  });
});

describe("fetchLiveSocialSummary", () => {
  it("maps topic-relevant Reddit posts into a live crowd-pulse summary", async () => {
    dataApiMocks.callDataApi.mockResolvedValue({
      posts: [
        {
          data: {
            title: "Fed outlook turns bullish as rate-cut hopes build",
            permalink: "/r/economics/comments/test1/fed_outlook_turns_bullish/",
            subreddit: "economics",
            score: 125,
            num_comments: 24,
            created_utc: 1777000000,
          },
        },
        {
          data: {
            title: "Weekend discussion thread",
            permalink: "/r/economics/comments/test2/weekend_thread/",
            subreddit: "economics",
            score: 40,
            num_comments: 4,
            created_utc: 1777000500,
          },
        },
      ],
    });

    const result = await fetchLiveSocialSummary("Fed rates");

    expect(result).not.toBeNull();
    expect(result?.subreddit).toBe("economics");
    expect(result?.mentions).toBe(1);
    expect(result?.postCount).toBe(1);
    expect(result?.posts[0]?.title).toContain("bullish");
    expect(result?.derivedSentiment).toBeGreaterThan(0);
    expect(dataApiMocks.callDataApi).toHaveBeenCalledWith("Reddit/AccessAPI", {
      query: {
        subreddit: "economics",
        limit: 10,
      },
    });
  });

  it("returns null when the upstream Reddit social fetch fails", async () => {
    dataApiMocks.callDataApi.mockRejectedValue(new Error("reddit unavailable"));

    const result = await fetchLiveSocialSummary("US election");

    expect(result).toBeNull();
  });
});

describe("fetchGdeltTopicSignal", () => {
  it("converts Wikimedia pageview momentum into an external signal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            { views: 100 },
            { views: 120 },
            { views: 140 },
            { views: 160 },
            { views: 200 },
            { views: 220 },
            { views: 240 },
            { views: 260 },
          ],
        }),
      })
    );

    const result = await fetchGdeltTopicSignal("US election");

    expect(result).not.toBeNull();
    expect(result?.source).toBe("wikimedia");
    expect(result?.topic).toBe("US election");
    expect(result?.articleCount).toBe(230);
    expect(result?.averageTone).toBeCloseTo(0.7692307692, 6);
    expect(result?.normalizedSentiment).toBe(1);
    expect(result?.confidence).toBeGreaterThan(0.5);
  });

  it("returns a zeroed signal object when the upstream response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
      })
    );

    const result = await fetchGdeltTopicSignal("US election");

    expect(result).not.toBeNull();
    expect(result?.source).toBe("wikimedia");
    expect(result?.articleCount).toBe(0);
    expect(result?.normalizedSentiment).toBe(0);
    expect(result?.confidence).toBe(0);
  });

  it("returns a zero-confidence signal when there is not enough pageview history yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [{ views: 10 }, { views: 12 }, { views: 11 }],
        }),
      })
    );

    const result = await fetchGdeltTopicSignal("Fresh topic");

    expect(result).not.toBeNull();
    expect(result?.articleCount).toBe(11);
    expect(result?.normalizedSentiment).toBe(0);
    expect(result?.confidence).toBe(0);
  });

  it("returns null when the upstream fetch throws, allowing the UI to surface an error fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );

    const result = await fetchGdeltTopicSignal("US election");

    expect(result).toBeNull();
  });

  it("returns null when the topic is blank", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchGdeltTopicSignal("   ");

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
