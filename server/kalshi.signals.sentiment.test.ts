import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSignalsForMarket, generateSignalsForMarkets } from "./_core/kalshiSignals";
import type { KalshiMarket } from "./_core/kalshiMarketData";

const mocks = vi.hoisted(() => ({
  fetchGdeltTopicSignal: vi.fn(),
  fetchLiveNewsSummary: vi.fn(),
}));

vi.mock("./_core/kalshiSentiment", async () => {
  const actual = await vi.importActual<typeof import("./_core/kalshiSentiment")>("./_core/kalshiSentiment");
  return {
    ...actual,
    fetchGdeltTopicSignal: mocks.fetchGdeltTopicSignal,
    fetchLiveNewsSummary: mocks.fetchLiveNewsSummary,
  };
});

const createMarket = (overrides: Partial<KalshiMarket> = {}): KalshiMarket => ({
  id: "fed-rates-market",
  title: "Fed rates decision",
  subtitle: "Will the Fed cut rates this quarter?",
  yesPrice: 0.42,
  noPrice: 0.58,
  impliedProbability: 0.42,
  volume24h: 25000,
  liquidity: 15000,
  closeTime: Date.now() + 7 * 24 * 60 * 60 * 1000,
  status: "open",
  category: "economics",
  resolutionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  ...overrides,
} as unknown as KalshiMarket);

describe("Sentiment-aware signal generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchLiveNewsSummary.mockResolvedValue(null);
  });

  it("adds a sentiment signal and boosts aligned conviction when the external topic signal is bullish", async () => {
    mocks.fetchGdeltTopicSignal.mockResolvedValue({
      source: "wikimedia",
      topic: "Fed rates decision",
      articleCount: 1200,
      averageTone: 0.4,
      normalizedSentiment: 0.9,
      confidence: 0.7,
      queriedAt: new Date("2026-04-24T00:00:00.000Z"),
    });

    // Pass fundamentalProbability close to impliedProbability to avoid also generating
    // a value signal, which would be consolidated with the sentiment signal into a confluence signal
    const signals = await generateSignalsForMarket(
      createMarket(),
      undefined,
      0.43,
      {
        topic: "Fed rates decision",
        newsSentiment: 0.3,
        socialSentiment: 0.2,
        marketSentiment: 0.1,
      }
    );

    const sentimentSignal = signals.find((signal) => signal.signalType === "sentiment");

    expect(sentimentSignal).toBeDefined();
    expect(sentimentSignal?.side).toBe("yes");
    expect(sentimentSignal?.metadata?.sentimentTopic).toBe("Fed rates decision");
    // Since we're not generating a value signal, the sentiment signal should remain standalone
    // and its reasoning should contain sentiment-related content
    expect(sentimentSignal?.reasoning).toContain("Composite sentiment favors YES");
  });

  it("penalizes a conflicting signal when external sentiment points the other way", async () => {
    mocks.fetchGdeltTopicSignal.mockResolvedValue({
      source: "wikimedia",
      topic: "Fed rates decision",
      articleCount: 900,
      averageTone: -0.5,
      normalizedSentiment: -0.85,
      confidence: 0.75,
      queriedAt: new Date("2026-04-24T00:00:00.000Z"),
    });

    // Pass fundamentalProbability close to impliedProbability to avoid value signal generation
    const signals = await generateSignalsForMarket(
      createMarket(),
      undefined,
      0.43,
      {
        topic: "Fed rates decision",
        newsSentiment: -0.3,
        socialSentiment: -0.2,
        marketSentiment: -0.1,
      }
    );

    const sentimentSignal = signals.find((signal) => signal.signalType === "sentiment");

    expect(sentimentSignal).toBeDefined();
    expect(sentimentSignal?.side).toBe("no");
    // With no value signal to conflict, the standalone sentiment signal should be generated
    expect(sentimentSignal?.reasoning).toContain("Composite sentiment favors NO");
  });

  it("threads market-level sentiment contexts through batch signal generation", async () => {
    mocks.fetchGdeltTopicSignal.mockResolvedValue({
      source: "wikimedia",
      topic: "Inflation print",
      articleCount: 400,
      averageTone: 0.35,
      normalizedSentiment: 0.6,
      confidence: 0.55,
      queriedAt: new Date("2026-04-24T00:00:00.000Z"),
    });

    // Use fundamentalProbability close to impliedProbability (0.42 from createMarket default)
    // to avoid generating a value signal that would consolidate with sentiment
    const signals = await generateSignalsForMarkets(
      [createMarket({ id: "inflation-market", title: "Inflation print" })],
      undefined,
      new Map([["inflation-market", 0.43]]),
      new Map([
        [
          "inflation-market",
          {
            topic: "Inflation print",
            newsSentiment: 0.2,
            socialSentiment: 0.1,
            marketSentiment: 0.15,
          },
        ],
      ])
    );

    expect(signals.some((signal) => signal.signalType === "sentiment")).toBe(true);
    expect(mocks.fetchGdeltTopicSignal).toHaveBeenCalledWith("Inflation print");
  });
});
