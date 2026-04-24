import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateDiversificationScore,
  optimizePortfolio,
} from "./_core/kalshiPortfolioOptimization";
import {
  calculateBacktestStats,
  calculateEquityCurve,
  comparePerformance,
  monteCarloSimulation,
  walkForwardValidation,
} from "./_core/kalshiBacktest";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("advanced feature helpers", () => {
  describe("portfolio optimization", () => {
    it("limits positions and filters out overly correlated signals when optimizing a portfolio", () => {
      const portfolio = optimizePortfolio(
        [
          { marketId: "FED", side: "yes", confidence: 0.72, expectedValue: 0.22 },
          { marketId: "FED", side: "yes", confidence: 0.68, expectedValue: 0.19 },
          { marketId: "BTC", side: "yes", confidence: 0.66, expectedValue: 0.18 },
          { marketId: "ELECTION", side: "no", confidence: 0.64, expectedValue: 0.17 },
          { marketId: "CPI", side: "yes", confidence: 0.61, expectedValue: 0.14 },
        ],
        5000,
        3
      );

      expect(portfolio.positions.length).toBeLessThanOrEqual(3);
      expect(new Set(portfolio.positions.map((position) => position.marketId)).size).toBe(portfolio.positions.length);
      expect(portfolio.positions.every((position) => position.size <= 250)).toBe(true);
      expect(portfolio.expectedReturn).toBeGreaterThan(0);
      expect(portfolio.diversificationScore).toBeGreaterThanOrEqual(0);
      expect(portfolio.diversificationScore).toBeLessThanOrEqual(1);
    });

    it("rewards diversified signal sets with a better diversification score than concentrated ones", () => {
      const concentrated = calculateDiversificationScore([
        { marketId: "FED", side: "yes", confidence: 0.72, expectedValue: 0.22 },
        { marketId: "FED", side: "yes", confidence: 0.7, expectedValue: 0.18 },
        { marketId: "FED", side: "no", confidence: 0.69, expectedValue: 0.16 },
      ]);

      const diversified = calculateDiversificationScore([
        { marketId: "FED", side: "yes", confidence: 0.72, expectedValue: 0.22 },
        { marketId: "BTC", side: "yes", confidence: 0.58, expectedValue: 0.17 },
        { marketId: "ELECTION", side: "no", confidence: 0.61, expectedValue: 0.15 },
      ]);

      expect(diversified).toBeGreaterThan(concentrated);
    });
  });

  describe("backtesting analytics", () => {
    const trades = [
      {
        marketId: "FED_1",
        entryPrice: 0.42,
        exitPrice: 0.49,
        size: 200,
        entryTime: 1,
        exitTime: 2,
        pnl: 14,
        pnlPercent: 14 / (0.42 * 200),
        side: "yes",
      },
      {
        marketId: "BTC_1",
        entryPrice: 0.55,
        exitPrice: 0.5,
        size: 200,
        entryTime: 3,
        exitTime: 4,
        pnl: -10,
        pnlPercent: -10 / (0.55 * 200),
        side: "yes",
      },
      {
        marketId: "CPI_1",
        entryPrice: 0.48,
        exitPrice: 0.53,
        size: 200,
        entryTime: 5,
        exitTime: 6,
        pnl: 10,
        pnlPercent: 10 / (0.48 * 200),
        side: "yes",
      },
      {
        marketId: "ELECTION_1",
        entryPrice: 0.6,
        exitPrice: 0.54,
        size: 200,
        entryTime: 7,
        exitTime: 8,
        pnl: 12,
        pnlPercent: 12 / (0.6 * 200),
        side: "no",
      },
    ] as const;

    it("calculates stable summary metrics and equity growth for a trade set", () => {
      const stats = calculateBacktestStats([...trades]);
      const equityCurve = calculateEquityCurve([...trades], 1000);

      expect(stats.totalTrades).toBe(4);
      expect(stats.winningTrades).toBe(3);
      expect(stats.losingTrades).toBe(1);
      expect(stats.totalPnL).toBe(26);
      expect(stats.winRate).toBeCloseTo(0.75, 6);
      expect(stats.profitFactor).toBeCloseTo(3.6, 6);
      expect(equityCurve).toEqual([1000, 1014, 1004, 1014, 1026]);
      expect(stats.maxDrawdown).toBeGreaterThanOrEqual(0);
    });

    it("supports deterministic Monte Carlo and walk-forward benchmarking for dashboard summaries", () => {
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.05);
      const monteCarlo = monteCarloSimulation([...trades], 20);
      const walkForward = walkForwardValidation([...trades], 2);
      const comparison = comparePerformance(walkForward);

      expect(randomSpy).toHaveBeenCalled();
      expect(monteCarlo.stdDev).toBeCloseTo(0, 10);
      expect(monteCarlo.bestCase).toBeCloseTo(monteCarlo.worstCase, 10);
      expect(walkForward).toHaveLength(2);
      expect(comparison.avgWinRate).toBeGreaterThan(0);
      expect(comparison.volatility).toBeGreaterThanOrEqual(0);
    });
  });
});
