import { describe, expect, it } from "vitest";
import {
  calculateAttributionBreakdown,
  calculateSharpeBySource,
  identifyLosingPatterns,
} from "./_core/performanceAttribution";

describe("performance attribution", () => {
  it("decomposes pnl into four sources with full reconciliation", () => {
    const breakdown = calculateAttributionBreakdown({
      side: "yes",
      entryPrice: 0.4,
      exitPrice: 0.6,
      quantity: 10,
      signalConfidence: 0.75,
      benchmarkWinRate: 0.5,
      expectedSlippagePct: 0.01,
    });

    const reconstructed =
      breakdown.signalAlpha + breakdown.execution + breakdown.timing + breakdown.luck;

    expect(breakdown.totalPnl).toBeCloseTo(2, 6);
    expect(reconstructed).toBeCloseTo(breakdown.totalPnl, 6);
  });

  it("calculates sharpe by source", () => {
    const sharpe = calculateSharpeBySource([
      { totalPnl: 1, signalAlpha: 0.4, execution: -0.05, timing: 0.2, luck: 0.45 },
      { totalPnl: 1.2, signalAlpha: 0.5, execution: -0.05, timing: 0.25, luck: 0.5 },
      { totalPnl: 0.8, signalAlpha: 0.3, execution: -0.05, timing: 0.15, luck: 0.4 },
    ]);

    expect(Number.isFinite(sharpe.signalAlpha)).toBe(true);
    expect(Number.isFinite(sharpe.execution)).toBe(true);
    expect(Number.isFinite(sharpe.timing)).toBe(true);
    expect(Number.isFinite(sharpe.luck)).toBe(true);
  });

  it("flags losing patterns by signal type and category", () => {
    const patterns = identifyLosingPatterns([
      { signalType: "momentum", category: "crypto", totalPnl: -1.2 },
      { signalType: "momentum", category: "crypto", totalPnl: -0.8 },
      { signalType: "momentum", category: "crypto", totalPnl: -1.1 },
      { signalType: "value_play", category: "macro", totalPnl: 0.9 },
    ]);

    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.signalType).toBe("momentum");
    expect(patterns[0]?.category).toBe("crypto");
    expect(patterns[0]?.avgPnl).toBeLessThan(0);
  });
});
