import { describe, it, expect } from "vitest";
import {
  aggregateSentiment,
  calculateSentimentMomentum,
  detectSentimentAlert,
  SOURCE_WEIGHT_GDELT,
  SOURCE_WEIGHT_REDDIT,
  SOURCE_WEIGHT_TWITTER,
  SOURCE_WEIGHT_EXPERT,
  SOURCE_WEIGHT_CONSENSUS,
  MOMENTUM_ALERT_THRESHOLD,
  type SourceSentiment,
  type SentimentHistoryEntry,
} from "./_core/sentimentAggregator";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSource(
  source: SourceSentiment["source"],
  score: number,
  confidence = 0.8,
  available = true,
): SourceSentiment {
  return { source, score, confidence, timestamp: new Date(), available };
}

function makeHistory(entries: Array<{ hoursAgo: number; score: number }>, now: Date): SentimentHistoryEntry[] {
  return entries.map(({ hoursAgo, score }) => ({
    timestamp: new Date(now.getTime() - hoursAgo * 60 * 60 * 1000),
    compositeScore: score,
  }));
}

// ── aggregateSentiment ────────────────────────────────────────────────────────

describe("aggregateSentiment", () => {
  it("all 5 sources available — effective weights sum to 1.0", () => {
    const sources: SourceSentiment[] = [
      makeSource("gdelt", 0.5),
      makeSource("reddit", 0.3),
      makeSource("twitter", 0.2),
      makeSource("expert", 0.6),
      makeSource("consensus", 0.4),
    ];
    const result = aggregateSentiment(sources);
    const weightSum = Object.values(result.effectiveWeights).reduce((a, b) => a + b, 0);
    expect(weightSum).toBeCloseTo(1.0, 10);
  });

  it("composite score is weighted average of inputs", () => {
    const sources: SourceSentiment[] = [
      makeSource("gdelt", 0.5, 1),
      makeSource("reddit", 0.5, 1),
      makeSource("twitter", 0.5, 1),
      makeSource("expert", 0.5, 1),
      makeSource("consensus", 0.5, 1),
    ];
    const result = aggregateSentiment(sources);
    expect(result.compositeScore).toBeCloseTo(0.5, 10);
  });

  it("1 source unavailable — remaining weights renormalized to 1.0", () => {
    const sources: SourceSentiment[] = [
      makeSource("gdelt", 0.5),
      makeSource("reddit", 0.5, 0.8, false), // unavailable
      makeSource("twitter", 0.5),
      makeSource("expert", 0.5),
      makeSource("consensus", 0.5),
    ];
    const result = aggregateSentiment(sources);
    const weightSum = Object.values(result.effectiveWeights).reduce((a, b) => a + b, 0);
    expect(weightSum).toBeCloseTo(1.0, 10);
    expect(result.effectiveWeights.reddit).toBe(0);
  });

  it("all sources same score — composite equals that score", () => {
    const score = 0.7;
    const sources: SourceSentiment[] = [
      makeSource("gdelt", score),
      makeSource("reddit", score),
      makeSource("twitter", score),
      makeSource("expert", score),
      makeSource("consensus", score),
    ];
    const result = aggregateSentiment(sources);
    expect(result.compositeScore).toBeCloseTo(score, 10);
  });

  it("opposing sources cancel out based on weights", () => {
    // gdelt(0.30) = +1, expert(0.25) = -1, others not included
    const sources: SourceSentiment[] = [
      makeSource("gdelt", 1.0, 1.0, true),
      makeSource("reddit", 0, 1.0, false),
      makeSource("twitter", 0, 1.0, false),
      makeSource("expert", -1.0, 1.0, true),
      makeSource("consensus", 0, 1.0, false),
    ];
    const result = aggregateSentiment(sources);
    // effective: gdelt=0.30/0.55, expert=0.25/0.55
    const expectedScore = (1.0 * 0.30 + -1.0 * 0.25) / (0.30 + 0.25);
    expect(result.compositeScore).toBeCloseTo(expectedScore, 10);
  });

  it("no sources available — compositeScore=0, confidence=0", () => {
    const sources: SourceSentiment[] = [
      makeSource("gdelt", 0.5, 0.8, false),
      makeSource("reddit", 0.5, 0.8, false),
      makeSource("twitter", 0.5, 0.8, false),
      makeSource("expert", 0.5, 0.8, false),
      makeSource("consensus", 0.5, 0.8, false),
    ];
    const result = aggregateSentiment(sources);
    expect(result.compositeScore).toBe(0);
    expect(result.compositeConfidence).toBe(0);
  });
});

// ── calculateSentimentMomentum ────────────────────────────────────────────────

describe("calculateSentimentMomentum", () => {
  it("empty history → 0", () => {
    expect(calculateSentimentMomentum([], 12)).toBe(0);
  });

  it("2-entry history in window → correct slope", () => {
    const now = new Date();
    // 10h ago score=0.2, 1h ago score=0.6 → change=0.4 over 12h window
    const history = makeHistory([{ hoursAgo: 10, score: 0.2 }, { hoursAgo: 1, score: 0.6 }], now);
    const momentum = calculateSentimentMomentum(history, 12, now);
    // momentumRaw = (0.6 - 0.2) / 12 = 0.4/12 ≈ 0.0333
    expect(momentum).toBeCloseTo(0.4 / 12, 5);
  });

  it("entries outside window are excluded", () => {
    const now = new Date();
    // 25h ago is outside the 12h window
    const history = makeHistory([
      { hoursAgo: 25, score: 0.0 },
      { hoursAgo: 6, score: 0.5 },
      { hoursAgo: 1, score: 0.8 },
    ], now);
    const momentum = calculateSentimentMomentum(history, 12, now);
    // Only 6h-ago and 1h-ago entries are in window: (0.8 - 0.5) / 12 ≈ 0.025
    expect(momentum).toBeCloseTo((0.8 - 0.5) / 12, 5);
  });

  it("output clamped to [-1, 1] for extreme values", () => {
    const now = new Date();
    // 1h ago score=-0.9, just now score=+0.9 → raw = 1.8/12 = 0.15 (within [-1,1])
    // To exceed 1: need huge change in short window
    // 11h ago score=0, just now score=12 → raw=12/12=1.0, at boundary
    // 11h ago score=0, just now score=100 → raw=100/12≈8.33, clamped to 1
    const history = makeHistory([
      { hoursAgo: 11, score: 0 },
      { hoursAgo: 0.1, score: 100 },
    ], now);
    const momentum = calculateSentimentMomentum(history, 12, now);
    expect(momentum).toBe(1);

    const historyNeg = makeHistory([
      { hoursAgo: 11, score: 0 },
      { hoursAgo: 0.1, score: -100 },
    ], now);
    const momentumNeg = calculateSentimentMomentum(historyNeg, 12, now);
    expect(momentumNeg).toBe(-1);
  });
});

// ── detectSentimentAlert ──────────────────────────────────────────────────────

describe("detectSentimentAlert", () => {
  it("shift > 0.4 in 6h → alert triggered", () => {
    const now = new Date();
    const current = aggregateSentiment([makeSource("gdelt", 0.9)]);
    // history: 5h ago score was 0.4 → shift = |0.9 - 0.4| = 0.5 > 0.4
    const history = makeHistory([{ hoursAgo: 5, score: 0.4 }], now);
    const result = detectSentimentAlert(current, history, now);
    expect(result.isAlert).toBe(true);
    expect(result.reason).toMatch(/Sentiment shifted/);
  });

  it("shift < 0.4 in 6h → no alert", () => {
    const now = new Date();
    const current = aggregateSentiment([makeSource("gdelt", 0.6)]);
    // history: 5h ago score was 0.4 → shift = |0.6 - 0.4| = 0.2 < 0.4
    const history = makeHistory([{ hoursAgo: 5, score: 0.4 }], now);
    const result = detectSentimentAlert(current, history, now);
    expect(result.isAlert).toBe(false);
  });

  it("empty history → no alert", () => {
    const current = aggregateSentiment([makeSource("gdelt", 0.9)]);
    const result = detectSentimentAlert(current, [], new Date());
    expect(result.isAlert).toBe(false);
    expect(result.reason).toBeUndefined();
  });
});

// ── Weight constants ──────────────────────────────────────────────────────────

describe("weight constants", () => {
  it("GDELT + Reddit + Twitter + Expert + Consensus = 1.0", () => {
    const total =
      SOURCE_WEIGHT_GDELT +
      SOURCE_WEIGHT_REDDIT +
      SOURCE_WEIGHT_TWITTER +
      SOURCE_WEIGHT_EXPERT +
      SOURCE_WEIGHT_CONSENSUS;
    expect(total).toBeCloseTo(1.0, 10);
  });

  it("MOMENTUM_ALERT_THRESHOLD is 0.40", () => {
    expect(MOMENTUM_ALERT_THRESHOLD).toBe(0.40);
  });
});
