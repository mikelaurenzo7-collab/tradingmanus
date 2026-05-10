import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.GROK_REVIEWER_ENABLED = "true";
  process.env.GROK_WEATHER_MAX_HOURS = "72";
  process.env.GROK_SPORTS_MAX_HOURS = "24";
  process.env.GROK_ECONOMICS_MAX_HOURS = "12";
  process.env.GROK_MIN_SIDE_PROBABILITY = "0.75";
  process.env.GROK_MIN_EDGE_FRACTION = "0.10";
  process.env.GROK_MIN_ROI_FRACTION = "0.18";
  process.env.GROK_MIN_CONFIDENCE = "0.70";
});

import { ENV } from "./_core/env";
import { shouldUseGrokReviewer } from "./_core/grokReviewer";

describe("shouldUseGrokReviewer", () => {
  beforeEach(() => {
    (ENV as { grokReviewerEnabled: boolean }).grokReviewerEnabled = true;
    (ENV as { grokWeatherMaxHours: number }).grokWeatherMaxHours = 72;
    (ENV as { grokSportsMaxHours: number }).grokSportsMaxHours = 24;
    (ENV as { grokEconomicsMaxHours: number }).grokEconomicsMaxHours = 12;
    (ENV as { grokMinSideProbability: number }).grokMinSideProbability = 0.75;
    (ENV as { grokMinEdgeFraction: number }).grokMinEdgeFraction = 0.1;
    (ENV as { grokMinRoiFraction: number }).grokMinRoiFraction = 0.18;
    (ENV as { grokMinConfidence: number }).grokMinConfidence = 0.7;
  });

  it("approves only urgent real-time categories that clear the economics thresholds", () => {
    expect(
      shouldUseGrokReviewer({
        category: "weather",
        hoursToResolution: 48,
        sideWinProbability: 0.81,
        edgeFraction: 0.13,
        roiFraction: 0.22,
        confidence: 0.78,
      }),
    ).toBe(true);

    expect(
      shouldUseGrokReviewer({
        category: "weather",
        hoursToResolution: 48,
        sideWinProbability: 0.74,
        edgeFraction: 0.13,
        roiFraction: 0.22,
        confidence: 0.78,
      }),
    ).toBe(false);

    expect(
      shouldUseGrokReviewer({
        category: "weather",
        hoursToResolution: 48,
        sideWinProbability: 0.81,
        edgeFraction: 0.08,
        roiFraction: 0.22,
        confidence: 0.78,
      }),
    ).toBe(false);

    expect(
      shouldUseGrokReviewer({
        category: "weather",
        hoursToResolution: 48,
        sideWinProbability: 0.81,
        edgeFraction: 0.13,
        roiFraction: 0.12,
        confidence: 0.78,
      }),
    ).toBe(false);

    expect(
      shouldUseGrokReviewer({
        category: "weather",
        hoursToResolution: 48,
        sideWinProbability: 0.81,
        edgeFraction: 0.13,
        roiFraction: 0.22,
        confidence: 0.66,
      }),
    ).toBe(false);
  });

  it("applies category-specific urgency windows", () => {
    expect(
      shouldUseGrokReviewer({
        category: "weather",
        hoursToResolution: 72,
        sideWinProbability: 0.8,
        edgeFraction: 0.12,
        roiFraction: 0.2,
        confidence: 0.75,
      }),
    ).toBe(true);
    expect(
      shouldUseGrokReviewer({
        category: "weather",
        hoursToResolution: 72.1,
        sideWinProbability: 0.8,
        edgeFraction: 0.12,
        roiFraction: 0.2,
        confidence: 0.75,
      }),
    ).toBe(false);

    expect(
      shouldUseGrokReviewer({
        category: "sports",
        hoursToResolution: 24,
        sideWinProbability: 0.8,
        edgeFraction: 0.12,
        roiFraction: 0.2,
        confidence: 0.75,
      }),
    ).toBe(true);
    expect(
      shouldUseGrokReviewer({
        category: "sports",
        hoursToResolution: 24.1,
        sideWinProbability: 0.8,
        edgeFraction: 0.12,
        roiFraction: 0.2,
        confidence: 0.75,
      }),
    ).toBe(false);

    expect(
      shouldUseGrokReviewer({
        category: "economics",
        hoursToResolution: 12,
        sideWinProbability: 0.8,
        edgeFraction: 0.12,
        roiFraction: 0.2,
        confidence: 0.75,
      }),
    ).toBe(true);
    expect(
      shouldUseGrokReviewer({
        category: "economics",
        hoursToResolution: 12.1,
        sideWinProbability: 0.8,
        edgeFraction: 0.12,
        roiFraction: 0.2,
        confidence: 0.75,
      }),
    ).toBe(false);
  });

  it("fails closed when Grok is disabled or the category is not real-time", () => {
    (ENV as { grokReviewerEnabled: boolean }).grokReviewerEnabled = false;
    expect(
      shouldUseGrokReviewer({
        category: "weather",
        hoursToResolution: 6,
        sideWinProbability: 0.8,
        edgeFraction: 0.12,
        roiFraction: 0.2,
        confidence: 0.75,
      }),
    ).toBe(false);

    (ENV as { grokReviewerEnabled: boolean }).grokReviewerEnabled = true;
    expect(
      shouldUseGrokReviewer({
        category: "politics",
        hoursToResolution: 6,
        sideWinProbability: 0.8,
        edgeFraction: 0.12,
        roiFraction: 0.2,
        confidence: 0.75,
      }),
    ).toBe(false);
  });
});