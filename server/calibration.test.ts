import { describe, expect, it } from "vitest";
import {
  bucketize,
  buildMonotoneCurve,
  calibrateConfidence,
  DEFAULT_BUCKETS,
} from "./_core/signalCalibration";

describe("bucketize", () => {
  it("returns empty buckets when no observations", () => {
    const result = bucketize([]);
    expect(result.totalTrades).toBe(0);
    expect(result.overallWinRate).toBe(0);
    expect(result.buckets.every((b) => b.trades === 0)).toBe(true);
  });

  it("counts trades and wins per bucket", () => {
    const observations = [
      { confidence: 0.45, won: true },
      { confidence: 0.5, won: false },
      { confidence: 0.5, won: true },
      { confidence: 0.7, won: true },
      { confidence: 0.7, won: true },
      { confidence: 0.7, won: false },
    ];
    const result = bucketize(observations);
    const bucket50 = result.buckets.find((b) => b.lo === 0.4)!;
    const bucket65 = result.buckets.find((b) => b.lo === 0.65)!;
    expect(bucket50.trades).toBe(3);
    expect(bucket50.wins).toBe(2);
    expect(bucket50.winRate).toBeCloseTo(2 / 3, 4);
    expect(bucket65.trades).toBe(3);
    expect(bucket65.wins).toBe(2);
    expect(bucket65.winRate).toBeCloseTo(2 / 3, 4);
    expect(result.totalTrades).toBe(6);
    expect(result.overallWinRate).toBeCloseTo(4 / 6, 4);
  });

  it("ignores non-finite confidences", () => {
    const result = bucketize([
      { confidence: NaN, won: true },
      { confidence: 0.7, won: true },
    ]);
    expect(result.totalTrades).toBe(1);
  });
});

describe("buildMonotoneCurve", () => {
  it("forward-fills empty buckets from observed neighbors", () => {
    const curve = bucketize([
      { confidence: 0.5, won: true },
      { confidence: 0.5, won: false },
      // no obs in 0.65-0.85 bucket
    ]);
    const monotone = buildMonotoneCurve(curve);
    const bucket50 = monotone.find((b) => b.lo === 0.4)!;
    const bucket65 = monotone.find((b) => b.lo === 0.65)!;
    // 50% bucket: 1/2 = 0.5
    expect(bucket50.winRate).toBeCloseTo(0.5, 4);
    // Empty 65 bucket forward-fills from 50.
    expect(bucket65.winRate).toBeCloseTo(0.5, 4);
  });

  it("monotonizes — never decreases left-to-right", () => {
    const curve = bucketize([
      // Build a non-monotonic curve: 50%-bucket high, 65%-bucket low.
      { confidence: 0.5, won: true },
      { confidence: 0.5, won: true },
      { confidence: 0.5, won: true },
      { confidence: 0.7, won: false },
      { confidence: 0.7, won: false },
      { confidence: 0.7, won: true },
    ]);
    const monotone = buildMonotoneCurve(curve);
    let prev = 0;
    for (const b of monotone) {
      expect(b.winRate).toBeGreaterThanOrEqual(prev);
      prev = b.winRate;
    }
  });

  it("clamps to (0.01, 0.99)", () => {
    const curve = bucketize([
      // Force a 100% win rate in one bucket.
      { confidence: 0.9, won: true },
      { confidence: 0.9, won: true },
      { confidence: 0.9, won: true },
    ]);
    const monotone = buildMonotoneCurve(curve);
    for (const b of monotone) {
      expect(b.winRate).toBeGreaterThanOrEqual(0.01);
      expect(b.winRate).toBeLessThanOrEqual(0.99);
    }
  });
});

describe("calibrateConfidence", () => {
  it("returns clamped raw value when monotone is empty", () => {
    expect(calibrateConfidence(0.7, [])).toBeCloseTo(0.7, 6);
    expect(calibrateConfidence(0, [])).toBeCloseTo(0.01, 6);
    expect(calibrateConfidence(1, [])).toBeCloseTo(0.99, 6);
  });

  it("looks up the right bucket and returns its win rate", () => {
    const monotone = DEFAULT_BUCKETS.map(([lo, hi], i) => ({
      lo,
      hi,
      trades: 1,
      wins: 0,
      winRate: 0.1 + i * 0.1,
    }));
    expect(calibrateConfidence(0.45, monotone)).toBeCloseTo(0.2, 4);
    expect(calibrateConfidence(0.7, monotone)).toBeCloseTo(0.4, 4);
    expect(calibrateConfidence(0.95, monotone)).toBeCloseTo(0.6, 4);
  });

  it("identity-style curves leave Kelly belief unchanged", () => {
    // Build a curve where each bucket's winRate is its midpoint.
    const monotone = DEFAULT_BUCKETS.map(([lo, hi]) => ({
      lo,
      hi,
      trades: 1,
      wins: 0,
      winRate: Math.max(0.01, Math.min(0.99, (lo + Math.min(hi, 1)) / 2)),
    }));
    // 0.7 confidence falls in [0.65, 0.75) bucket → midpoint 0.7.
    expect(calibrateConfidence(0.7, monotone)).toBeCloseTo(0.7, 2);
  });
});
