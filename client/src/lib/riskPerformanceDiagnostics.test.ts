import { describe, expect, it } from "vitest";
import {
  classifyRiskPosture,
  formatPercent,
  summarizeLearningMetrics,
  summarizeRiskBudget,
} from "./riskPerformanceDiagnostics";

describe("riskPerformanceDiagnostics", () => {
  it("summarizes per-trade and daily risk budgets relative to current balance", () => {
    expect(summarizeRiskBudget(2500, 50, 125)).toEqual({
      perTradeUsage: 0.02,
      dailyUsage: 0.05,
    });
  });

  it("classifies posture from alerts and hard-stop counts", () => {
    expect(classifyRiskPosture(0, 0)).toBe("stable");
    expect(classifyRiskPosture(2, 0)).toBe("elevated");
    expect(classifyRiskPosture(1, 1)).toBe("critical");
  });

  it("derives learning diagnostics from average win/loss and recovery metrics", () => {
    expect(formatPercent(0.125)).toBe("12.5%");
    expect(
      summarizeLearningMetrics({
        avgWin: 24,
        avgLoss: 12,
        breakevenTrades: 3,
        profitFactor: 1.8,
        recoveryFactor: 2.2,
      }),
    ).toEqual({
      edgeRatio: 2,
      breakevenTrades: 3,
      profitFactor: 1.8,
      recoveryFactor: 2.2,
    });
  });
});
