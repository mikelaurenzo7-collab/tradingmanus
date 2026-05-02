/**
 * Tests for the time-to-resolution factor added to scoreSignalForExecution.
 * This must be a standalone file because the platform-readiness.test.ts
 * mocks the entire kalshiSignals module for other test suites.
 */

import { describe, expect, it } from "vitest";
import { scoreSignalForExecution } from "./_core/kalshiSignals";

const baseSignal = {
  marketId: "test-market",
  signalType: "value_play" as const,
  side: "yes" as const,
  confidence: 0.75,
  reasoning: "test",
  impliedProbability: 0.45,
  marketPrice: 0.45,
  expectedValue: 0.12,
  metadata: {
    liquidityScore: 0.6,
    strategyProfile: "macro_data" as const,
  },
};

describe("scoreSignalForExecution – time-to-resolution factor", () => {
  it("gives the sweet-spot bonus for markets resolving within 7 days", () => {
    const inFourDays = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();

    const withResolution = scoreSignalForExecution({
      ...baseSignal,
      metadata: { ...baseSignal.metadata, resolutionDate: inFourDays },
    });
    const withoutResolution = scoreSignalForExecution(baseSignal);

    // The 2h–7-day bonus (+0.04) should make the score with resolution higher.
    expect(withResolution).toBeGreaterThan(withoutResolution);
  });

  it("penalises markets resolving imminently (< 2 h)", () => {
    const inOneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const imminent = scoreSignalForExecution({
      ...baseSignal,
      metadata: { ...baseSignal.metadata, resolutionDate: inOneHour },
    });
    const noDate = scoreSignalForExecution(baseSignal);

    // Imminent penalty (-0.1) should lower the score.
    expect(imminent).toBeLessThan(noDate);
  });

  it("penalises markets resolving more than 30 days out", () => {
    const in45Days = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();

    const farOut = scoreSignalForExecution({
      ...baseSignal,
      metadata: { ...baseSignal.metadata, resolutionDate: in45Days },
    });
    const noDate = scoreSignalForExecution(baseSignal);

    // Long-horizon penalty (-0.04) should lower the score.
    expect(farOut).toBeLessThan(noDate);
  });

  it("heavily penalises already-resolved markets (past resolution date)", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const resolved = scoreSignalForExecution({
      ...baseSignal,
      metadata: { ...baseSignal.metadata, resolutionDate: yesterday },
    });
    const noDate = scoreSignalForExecution(baseSignal);

    // Past-resolution penalty (-0.15) should lower the score substantially.
    expect(resolved).toBeLessThan(noDate - 0.10);
  });

  it("does not change the score when resolutionDate is absent", () => {
    const score1 = scoreSignalForExecution(baseSignal);
    const score2 = scoreSignalForExecution({
      ...baseSignal,
      metadata: { ...baseSignal.metadata, resolutionDate: undefined },
    });

    expect(score1).toBeCloseTo(score2, 10);
  });
});
