import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  fetchGdeltTopicSignal: vi.fn(),
  fetchLiveNewsSummary: vi.fn(),
  fetchLiveSocialSummary: vi.fn(),
}));

vi.mock("./_core/kalshiSentiment", async () => {
  const actual = await vi.importActual<typeof import("./_core/kalshiSentiment")>("./_core/kalshiSentiment");
  return {
    ...actual,
    fetchGdeltTopicSignal: mocks.fetchGdeltTopicSignal,
    fetchLiveNewsSummary: mocks.fetchLiveNewsSummary,
    fetchLiveSocialSummary: mocks.fetchLiveSocialSummary,
  };
});

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as TrpcContext["res"],
  };
}

describe("advanced.sentiment.calculateCompositeSentiment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchLiveNewsSummary.mockResolvedValue(null);
    mocks.fetchLiveSocialSummary.mockResolvedValue(null);
  });

  it("returns live external signal data for a successful refresh path", async () => {
    mocks.fetchGdeltTopicSignal.mockResolvedValue({
      source: "wikimedia",
      topic: "US election",
      articleCount: 850,
      averageTone: 0.42,
      normalizedSentiment: 0.7,
      confidence: 0.6,
      queriedAt: new Date("2026-04-24T00:00:00.000Z"),
    });
    mocks.fetchLiveNewsSummary.mockResolvedValue({
      query: "US election",
      articleCount: 2,
      headlines: [],
      derivedSentiment: 0.2,
      fetchedAt: new Date("2026-04-24T00:00:00.000Z"),
    });
    mocks.fetchLiveSocialSummary.mockResolvedValue({
      query: "US election",
      subreddit: "politics",
      postCount: 2,
      mentions: 2,
      posts: [],
      derivedSentiment: 0.4,
      fetchedAt: new Date("2026-04-24T00:00:00.000Z"),
    });

    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.advanced.sentiment.calculateCompositeSentiment({
      newsSentiment: 0.3,
      socialSentiment: 0.1,
      marketSentiment: 0.2,
      topic: "US election",
    });

    expect(result.externalSignal).toMatchObject({
      source: "wikimedia",
      topic: "US election",
      articleCount: 850,
    });
    expect(result.liveNews).toMatchObject({
      query: "US election",
      articleCount: 2,
    });
    expect(result.liveSocial).toMatchObject({
      subreddit: "politics",
      postCount: 2,
      mentions: 2,
    });
    expect(result.inputs.social).toBeGreaterThan(0.1);
    expect(result.overallSentiment).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("falls back to zeroed external contribution when the refresh path returns an empty upstream result", async () => {
    mocks.fetchGdeltTopicSignal.mockResolvedValue({
      source: "wikimedia",
      topic: "Thin topic",
      articleCount: 0,
      averageTone: 0,
      normalizedSentiment: 0,
      confidence: 0,
      queriedAt: new Date("2026-04-24T00:00:00.000Z"),
    });
    mocks.fetchLiveNewsSummary.mockResolvedValue({
      query: "Thin topic",
      articleCount: 0,
      headlines: [],
      derivedSentiment: 0,
      fetchedAt: new Date("2026-04-24T00:00:00.000Z"),
    });
    mocks.fetchLiveSocialSummary.mockResolvedValue({
      query: "Thin topic",
      subreddit: "news",
      postCount: 0,
      mentions: 0,
      posts: [],
      derivedSentiment: 0,
      fetchedAt: new Date("2026-04-24T00:00:00.000Z"),
    });

    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.advanced.sentiment.calculateCompositeSentiment({
      newsSentiment: 0.2,
      socialSentiment: -0.1,
      marketSentiment: 0.05,
      topic: "Thin topic",
    });

    expect(result.externalSignal).toMatchObject({
      articleCount: 0,
      normalizedSentiment: 0,
      confidence: 0,
    });
    expect(result.liveSocial).toMatchObject({
      postCount: 0,
      mentions: 0,
    });
    expect(result.contributions.external).toBe(0);
  });

  it("keeps the procedure responsive when the external fetch fails and the UI needs an error fallback", async () => {
    mocks.fetchGdeltTopicSignal.mockResolvedValue(null);
    mocks.fetchLiveNewsSummary.mockResolvedValue(null);
    mocks.fetchLiveSocialSummary.mockResolvedValue(null);

    const caller = appRouter.createCaller(createPublicContext());
    const result = await caller.advanced.sentiment.calculateCompositeSentiment({
      newsSentiment: -0.2,
      socialSentiment: -0.1,
      marketSentiment: 0,
      topic: "Outage case",
    });

    expect(result.externalSignal).toBeNull();
    expect(result.liveNews).toBeNull();
    expect(result.liveSocial).toBeNull();
    expect(result.inputs.external).toBe(0);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
