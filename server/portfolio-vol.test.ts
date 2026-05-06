/**
 * Tests for Task 2.2: Portfolio-Level Volatility Targeting
 */
import { describe, it, expect } from "vitest";
import {
  stdDev,
  calculateCorrelation,
  calculatePortfolioVol,
  getVolScalingFactor,
  calculatePortfolioVolatility,
  type PositionVolData,
} from "./_core/kalshiAdvancedRisk";

// ── stdDev ────────────────────────────────────────────────────────────────────

describe("stdDev", () => {
  it("returns 0 for empty array", () => {
    expect(stdDev([])).toBe(0);
  });

  it("returns 0 for single-element array", () => {
    expect(stdDev([42])).toBe(0);
  });

  it("returns 0 for constant array", () => {
    expect(stdDev([5, 5, 5])).toBe(0);
  });

  it("returns 0.5 for [0, 1]", () => {
    expect(stdDev([0, 1])).toBeCloseTo(0.5, 10);
  });

  it("returns correct value for [1, 2, 3]", () => {
    // mean = 2, deviations = [-1, 0, 1], variance = 2/3, std = sqrt(2/3)
    expect(stdDev([1, 2, 3])).toBeCloseTo(Math.sqrt(2 / 3), 10);
  });
});

// ── calculateCorrelation ──────────────────────────────────────────────────────

describe("calculateCorrelation", () => {
  it("returns 0 for length-1 series (guard)", () => {
    expect(calculateCorrelation([1], [1])).toBe(0);
  });

  it("returns 0 for empty series", () => {
    expect(calculateCorrelation([], [])).toBe(0);
  });

  it("returns 1.0 for identical series", () => {
    const s = [1, 2, 3, 4, 5];
    expect(calculateCorrelation(s, s)).toBeCloseTo(1.0, 10);
  });

  it("returns -1.0 for perfectly opposite series", () => {
    const s1 = [1, 2, 3, 4, 5];
    const s2 = [5, 4, 3, 2, 1];
    expect(calculateCorrelation(s1, s2)).toBeCloseTo(-1.0, 10);
  });

  it("returns 0 for constant second series (zero std dev)", () => {
    expect(calculateCorrelation([1, 2, 3], [5, 5, 5])).toBe(0);
  });

  it("returns value near 0 for unrelated series", () => {
    // Orthogonal: one has deviations [1, -1, 1, -1], other [1, 1, -1, -1]
    const s1 = [1, -1, 1, -1];
    const s2 = [1, 1, -1, -1];
    const corr = calculateCorrelation(s1, s2);
    // Covariance = (1*1 + (-1)*1 + 1*(-1) + (-1)*(-1)) / 4 = 0
    expect(corr).toBeCloseTo(0, 10);
  });
});

// ── calculatePortfolioVol ─────────────────────────────────────────────────────

describe("calculatePortfolioVol", () => {
  it("returns 0 for empty positions", () => {
    expect(calculatePortfolioVol([])).toBe(0);
  });

  it("single position: portfolio vol = weight * dailyVol (no returns)", () => {
    const pos: PositionVolData = {
      positionId: "p1",
      weight: 0.5,
      dailyVol: 0.02,
      returns: [],
    };
    // With no returns, uses dailyVol; w^2 * sigma^2 = 0.25 * 0.0004 = 0.0001; sqrt = 0.01
    expect(calculatePortfolioVol([pos])).toBeCloseTo(0.5 * 0.02, 10);
  });

  it("single position: uses returns stdDev when available", () => {
    const returns = [0.01, -0.01, 0.02, -0.02];
    const sigma = stdDev(returns);
    const pos: PositionVolData = {
      positionId: "p1",
      weight: 0.8,
      dailyVol: 0.999, // should be overridden
      returns,
    };
    expect(calculatePortfolioVol([pos])).toBeCloseTo(0.8 * sigma, 10);
  });

  it("two uncorrelated positions: vol < sum of individual vols", () => {
    const pos1: PositionVolData = {
      positionId: "p1",
      weight: 0.5,
      dailyVol: 0.02,
      returns: [0.01, -0.01, 0.01, -0.01],   // alternating
    };
    const pos2: PositionVolData = {
      positionId: "p2",
      weight: 0.5,
      dailyVol: 0.02,
      returns: [0.01, 0.01, -0.01, -0.01],   // also alternating but uncorrelated with p1
    };
    const vol = calculatePortfolioVol([pos1, pos2]);
    // Correlation should be ~0, so portfolio vol < 0.5*sigma1 + 0.5*sigma2
    const sigma1 = stdDev(pos1.returns);
    const sigma2 = stdDev(pos2.returns);
    const indivSum = 0.5 * sigma1 + 0.5 * sigma2;
    expect(vol).toBeLessThanOrEqual(indivSum + 1e-10);
    expect(vol).toBeGreaterThan(0);
  });

  it("two perfectly correlated positions (identical returns): vol = sum of weighted vols", () => {
    const returns = [0.01, -0.02, 0.03, -0.01, 0.02];
    const sigma = stdDev(returns);
    const pos1: PositionVolData = { positionId: "p1", weight: 0.4, dailyVol: sigma, returns };
    const pos2: PositionVolData = { positionId: "p2", weight: 0.6, dailyVol: sigma, returns };
    // With corr=1: vol = w1*sigma + w2*sigma = (0.4+0.6)*sigma = sigma
    const vol = calculatePortfolioVol([pos1, pos2]);
    expect(vol).toBeCloseTo((0.4 + 0.6) * sigma, 8);
  });
});

// ── getVolScalingFactor ───────────────────────────────────────────────────────

describe("getVolScalingFactor", () => {
  it("vol=0.08 → scale=1.2 (low vol)", () => {
    const result = getVolScalingFactor(0.08);
    expect(result.volScalingFactor).toBeCloseTo(1.2);
    expect(result.isLowVol).toBe(true);
    expect(result.isHighVol).toBe(false);
    expect(result.isExtremeVol).toBe(false);
    expect(result.isHardBlocked).toBe(false);
    expect(result.shouldBlockHighRiskSignals).toBe(false);
  });

  it("vol=0.15 → scale=1.0 (normal)", () => {
    const result = getVolScalingFactor(0.15);
    expect(result.volScalingFactor).toBeCloseTo(1.0);
    expect(result.isLowVol).toBe(false);
    expect(result.isHighVol).toBe(false);
    expect(result.isHardBlocked).toBe(false);
  });

  it("vol=0.22 → scale=0.70 (high tier 1)", () => {
    const result = getVolScalingFactor(0.22);
    expect(result.volScalingFactor).toBeCloseTo(0.70);
    expect(result.isHighVol).toBe(true);
    expect(result.isExtremeVol).toBe(false);
    expect(result.isHardBlocked).toBe(false);
    expect(result.shouldBlockHighRiskSignals).toBe(false);
  });

  it("vol=0.28 → scale=0.50 (extreme vol)", () => {
    const result = getVolScalingFactor(0.28);
    expect(result.volScalingFactor).toBeCloseTo(0.50);
    expect(result.isHighVol).toBe(true);
    expect(result.isExtremeVol).toBe(true);
    expect(result.isHardBlocked).toBe(false);
    expect(result.shouldBlockHighRiskSignals).toBe(true);
  });

  it("vol=0.35 → isHardBlocked=true, scale=0", () => {
    const result = getVolScalingFactor(0.35);
    expect(result.volScalingFactor).toBe(0);
    expect(result.isHardBlocked).toBe(true);
    expect(result.isExtremeVol).toBe(true);
    expect(result.shouldBlockHighRiskSignals).toBe(true);
  });

  it("vol exactly at hard cap boundary (0.30) → isHardBlocked=false (>0.30 triggers block)", () => {
    const result = getVolScalingFactor(0.30);
    // 0.30 is NOT > 0.30, so should not be hard blocked
    expect(result.isHardBlocked).toBe(false);
    expect(result.volScalingFactor).toBeCloseTo(0.50);
  });
});

// ── calculatePortfolioVolatility ──────────────────────────────────────────────

describe("calculatePortfolioVolatility", () => {
  it("returns all required fields", () => {
    const pos: PositionVolData = {
      positionId: "p1",
      weight: 1.0,
      dailyVol: 0.01,
      returns: [0.01, -0.01, 0.02, -0.02],
    };
    const result = calculatePortfolioVolatility([pos]);
    expect(typeof result.portfolioVolatility).toBe("number");
    expect(typeof result.dailyVol).toBe("number");
    expect(typeof result.volScalingFactor).toBe("number");
    expect(typeof result.isHighVol).toBe("boolean");
    expect(typeof result.isExtremeVol).toBe("boolean");
    expect(typeof result.isHardBlocked).toBe("boolean");
    expect(typeof result.isLowVol).toBe("boolean");
    expect(typeof result.shouldBlockHighRiskSignals).toBe("boolean");
  });

  it("portfolioVolatility = dailyVol * sqrt(252)", () => {
    const pos: PositionVolData = {
      positionId: "p1",
      weight: 1.0,
      dailyVol: 0.01,
      returns: [],
    };
    const result = calculatePortfolioVolatility([pos]);
    expect(result.portfolioVolatility).toBeCloseTo(result.dailyVol * Math.sqrt(252), 10);
  });

  it("empty positions → portfolioVolatility = 0, isLowVol = true", () => {
    const result = calculatePortfolioVolatility([]);
    expect(result.portfolioVolatility).toBe(0);
    expect(result.dailyVol).toBe(0);
    expect(result.isLowVol).toBe(true); // 0 < 10%
  });

  it("high vol position triggers isHighVol flag", () => {
    // dailyVol = 0.20 → portfolioVolatility = 0.20 * sqrt(252) ≈ 3.17 → > 0.25 → extreme
    const pos: PositionVolData = {
      positionId: "p1",
      weight: 1.0,
      dailyVol: 0.20,
      returns: [],
    };
    const result = calculatePortfolioVolatility([pos]);
    expect(result.isHardBlocked).toBe(true); // annualized will be huge
  });
});
