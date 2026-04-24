import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateCompositeSentiment,
  fetchGdeltTopicSignal,
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

  it("returns null when the topic is blank", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchGdeltTopicSignal("   ");

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
