/**
 * Tests for Bayesian Probability Updater
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BayesianSignalUpdater,
  type Evidence,
  type EvidenceType,
  updateSignalWithEvidence,
  shouldAutoUpdate,
  createEvidenceFromMarketEvent,
} from "./_core/bayesianUpdater";
import * as db from "./db";

vi.mock("./db");

describe("BayesianSignalUpdater", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("calculatePriorProbability", () => {
    it("should return category baseline when no fundamental estimate provided", () => {
      const prior = BayesianSignalUpdater.calculatePriorProbability("politics");
      expect(prior).toBe(0.50);
    });

    it("should blend category baseline with fundamental estimate", () => {
      const prior = BayesianSignalUpdater.calculatePriorProbability("sports", 0.7, 0.7);
      // 0.5 * 0.3 + 0.7 * 0.7 = 0.15 + 0.49 = 0.64
      expect(prior).toBeCloseTo(0.64, 2);
    });

    it("should use default baseline for unknown category", () => {
      const prior = BayesianSignalUpdater.calculatePriorProbability("unknown_category");
      expect(prior).toBe(0.50);
    });

    it("should ignore invalid fundamental estimates", () => {
      const prior1 = BayesianSignalUpdater.calculatePriorProbability("economics", -0.1);
      expect(prior1).toBe(0.50);

      const prior2 = BayesianSignalUpdater.calculatePriorProbability("economics", 1.5);
      expect(prior2).toBe(0.50);
    });
  });

  describe("updateProbability", () => {
    it("should calculate posterior using Bayes theorem", () => {
      const updater = new BayesianSignalUpdater(1);
      const evidence: Evidence = {
        type: "price_move",
        value: 0.5, // 50% magnitude
        direction: "bullish",
        timestamp: new Date(),
      };

      const result = updater.updateProbability(0.5, evidence, "yes");

      expect(result.prior).toBe(0.5);
      expect(result.posterior).toBeGreaterThan(0.5); // Should increase with bullish evidence
      expect(result.posterior).toBeLessThan(1);
      expect(result.likelihood).toBeGreaterThan(0.5); // Likelihood should support outcome
      expect(result.evidenceProb).toBeGreaterThan(0);
      expect(result.confidenceAdjustment).toBeGreaterThan(0);
    });

    it("should decrease probability with contradictory evidence", () => {
      const updater = new BayesianSignalUpdater(1);
      const evidence: Evidence = {
        type: "price_move",
        value: 0.5,
        direction: "bearish",
        timestamp: new Date(),
      };

      const result = updater.updateProbability(0.7, evidence, "yes");

      expect(result.posterior).toBeLessThan(0.7); // Should decrease with bearish evidence
      expect(result.posterior).toBeGreaterThan(0);
    });

    it("should handle neutral evidence", () => {
      const updater = new BayesianSignalUpdater(1);
      const evidence: Evidence = {
        type: "volume_spike",
        value: 0.5,
        direction: "neutral",
        timestamp: new Date(),
      };

      const result = updater.updateProbability(0.6, evidence, "yes");

      // Neutral evidence should minimally impact probability
      expect(Math.abs(result.posterior - result.prior)).toBeLessThan(0.1);
    });

    it("should handle extreme priors", () => {
      const updater = new BayesianSignalUpdater(1);
      const evidence: Evidence = {
        type: "price_move",
        value: 0.8,
        direction: "bullish",
        timestamp: new Date(),
      };

      const result = updater.updateProbability(0.95, evidence, "yes");

      expect(result.posterior).toBeLessThanOrEqual(1);
      expect(result.posterior).toBeGreaterThan(0);
    });

    it("should clamp posterior to valid probability range", () => {
      const updater = new BayesianSignalUpdater(1);
      const evidence: Evidence = {
        type: "fundamental",
        value: 1.0,
        direction: "bullish",
        timestamp: new Date(),
      };

      const result = updater.updateProbability(0.99, evidence, "yes");

      expect(result.posterior).toBeLessThanOrEqual(1);
      expect(result.posterior).toBeGreaterThanOrEqual(0);
    });
  });

  describe("updateWithEvidenceChain", () => {
    it("should apply multiple evidence sequentially", () => {
      const updater = new BayesianSignalUpdater(1);
      const evidenceList: Evidence[] = [
        {
          type: "price_move",
          value: 0.3,
          direction: "bullish",
          timestamp: new Date(),
        },
        {
          type: "volume_spike",
          value: 0.5,
          direction: "bullish",
          timestamp: new Date(),
        },
        {
          type: "sentiment_shift",
          value: 0.4,
          direction: "bullish",
          timestamp: new Date(),
        },
      ];

      const finalProb = updater.updateWithEvidenceChain(0.5, evidenceList, "yes");

      expect(finalProb).toBeGreaterThan(0.5); // Multiple bullish signals should increase probability
      expect(updater.getEvidenceChain()).toHaveLength(3);
    });

    it("should handle conflicting evidence", () => {
      const updater = new BayesianSignalUpdater(1);
      const evidenceList: Evidence[] = [
        {
          type: "price_move",
          value: 0.5,
          direction: "bullish",
          timestamp: new Date(),
        },
        {
          type: "sentiment_shift",
          value: 0.5,
          direction: "bearish",
          timestamp: new Date(),
        },
      ];

      const finalProb = updater.updateWithEvidenceChain(0.5, evidenceList, "yes");

      // Conflicting evidence should result in moderate change
      expect(Math.abs(finalProb - 0.5)).toBeLessThan(0.2);
    });
  });

  describe("calculateEvidenceWeight", () => {
    it("should give weight 1.0 to recent evidence", () => {
      const now = new Date();
      const weight = BayesianSignalUpdater.calculateEvidenceWeight(now, now);
      expect(weight).toBe(1.0);
    });

    it("should decay evidence weight with time", () => {
      const now = new Date();
      const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
      const weight = BayesianSignalUpdater.calculateEvidenceWeight(fourHoursAgo, now);
      
      // After one half-life (4 hours), weight should be ~0.5
      expect(weight).toBeCloseTo(0.5, 1);
    });

    it("should give very low weight to old evidence", () => {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const weight = BayesianSignalUpdater.calculateEvidenceWeight(oneDayAgo, now);
      
      // After 24 hours (6 half-lives), weight should be very low
      expect(weight).toBeLessThan(0.02);
    });
  });

  describe("calculateConvergence", () => {
    it("should return 1 with insufficient updates", () => {
      const updater = new BayesianSignalUpdater(1);
      expect(updater.calculateConvergence()).toBe(1);
    });

    it("should calculate convergence from recent updates", () => {
      const updater = new BayesianSignalUpdater(1);
      const evidence: Evidence = {
        type: "price_move",
        value: 0.5,
        direction: "bullish",
        timestamp: new Date(),
      };

      // Add several updates
      updater.updateProbability(0.5, evidence, "yes");
      updater.updateProbability(0.6, evidence, "yes");
      updater.updateProbability(0.65, evidence, "yes");

      const convergence = updater.calculateConvergence();
      expect(convergence).toBeGreaterThan(0);
      expect(convergence).toBeLessThan(1);
    });
  });

  describe("getEvidenceChain", () => {
    it("should return full evidence chain", () => {
      const updater = new BayesianSignalUpdater(1);
      const evidence: Evidence = {
        type: "price_move",
        value: 0.5,
        direction: "bullish",
        timestamp: new Date(),
      };

      const first = updater.updateProbability(0.5, evidence, "yes");
      updater.updateProbability(first.posterior, evidence, "yes");

      const chain = updater.getEvidenceChain();
      expect(chain).toHaveLength(2);
      expect(chain[0]?.prior).toBe(0.5);
      expect(chain[1]?.prior).toBe(chain[0]?.posterior);
    });

    it("should preserve evidence metadata", () => {
      const updater = new BayesianSignalUpdater(1);
      const evidence: Evidence = {
        type: "news_item",
        value: 0.7,
        direction: "bullish",
        timestamp: new Date(),
        metadata: { source: "reuters", sentiment: 0.8 },
      };

      updater.updateProbability(0.5, evidence, "yes");
      const chain = updater.getEvidenceChain();
      
      expect(chain[0]?.evidence.metadata).toEqual({ source: "reuters", sentiment: 0.8 });
    });
  });

  describe("clearEvidenceChain", () => {
    it("should clear all evidence", () => {
      const updater = new BayesianSignalUpdater(1);
      const evidence: Evidence = {
        type: "price_move",
        value: 0.5,
        direction: "bullish",
        timestamp: new Date(),
      };

      updater.updateProbability(0.5, evidence, "yes");
      expect(updater.getEvidenceChain()).toHaveLength(1);

      updater.clearEvidenceChain();
      expect(updater.getEvidenceChain()).toHaveLength(0);
    });
  });

  describe("evidence type strength", () => {
    it("should give higher likelihood to fundamental evidence", () => {
      const updater = new BayesianSignalUpdater(1);
      const fundamentalEvidence: Evidence = {
        type: "fundamental",
        value: 0.5,
        direction: "bullish",
        timestamp: new Date(),
      };

      const priceEvidence: Evidence = {
        type: "price_move",
        value: 0.5,
        direction: "bullish",
        timestamp: new Date(),
      };

      const fundamentalResult = updater.updateProbability(0.5, fundamentalEvidence, "yes");
      updater.clearEvidenceChain();
      const priceResult = updater.updateProbability(0.5, priceEvidence, "yes");

      // Fundamental evidence should have stronger impact
      expect(Math.abs(fundamentalResult.posterior - 0.5)).toBeGreaterThan(
        Math.abs(priceResult.posterior - 0.5)
      );
    });
  });
});

describe("updateSignalWithEvidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should update signal and persist to database", async () => {
    const mockSignal = {
      id: 1,
      userId: 1,
      marketId: "test-market",
      side: "yes" as const,
      confidence: 0.6,
      bayesianProbability: null,
    };

    const mockDbInstance = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockSignal]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };

    vi.mocked(db.getDb).mockResolvedValue(mockDbInstance as any);
    vi.mocked(db.getSignalById).mockResolvedValue(mockSignal as any);
    vi.mocked(db.insertBayesianUpdate).mockResolvedValue(undefined as any);
    vi.mocked(db.updateSignalBayesianProbability).mockResolvedValue(undefined as any);

    const evidence: Evidence = {
      type: "price_move",
      value: 0.5,
      direction: "bullish",
      timestamp: new Date(),
    };

    const result = await updateSignalWithEvidence(1, evidence, mockDbInstance as any);

    expect(result).not.toBeNull();
    expect(result!.newProbability).toBeGreaterThan(0.6);
    expect(db.insertBayesianUpdate).toHaveBeenCalled();
    expect(db.updateSignalBayesianProbability).toHaveBeenCalled();
  });

  it("should handle missing signal", async () => {
    const mockDbInstance = {} as any;
    vi.mocked(db.getDb).mockResolvedValue(mockDbInstance);
    vi.mocked(db.getSignalById).mockResolvedValue(null);

    const evidence: Evidence = {
      type: "price_move",
      value: 0.5,
      direction: "bullish",
      timestamp: new Date(),
    };

    const result = await updateSignalWithEvidence(999, evidence, mockDbInstance);

    expect(result).toBeNull();
    expect(db.insertBayesianUpdate).not.toHaveBeenCalled();
  });

  it("should handle database errors gracefully", async () => {
    const mockDbInstance = {} as any;
    vi.mocked(db.getDb).mockResolvedValue(mockDbInstance);
    vi.mocked(db.getSignalById).mockRejectedValue(new Error("Database error"));

    const evidence: Evidence = {
      type: "price_move",
      value: 0.5,
      direction: "bullish",
      timestamp: new Date(),
    };

    const result = await updateSignalWithEvidence(1, evidence, mockDbInstance);

    expect(result).toBeNull();
  });
});

describe("shouldAutoUpdate", () => {
  it("should trigger on price move >2%", () => {
    expect(shouldAutoUpdate(0.025, 1, 0)).toBe(true);
    expect(shouldAutoUpdate(-0.025, 1, 0)).toBe(true);
    expect(shouldAutoUpdate(0.015, 1, 0)).toBe(false);
  });

  it("should trigger on volume spike >3x", () => {
    expect(shouldAutoUpdate(0, 3.5, 0)).toBe(true);
    expect(shouldAutoUpdate(0, 2.5, 0)).toBe(false);
  });

  it("should trigger on sentiment shift >0.3", () => {
    expect(shouldAutoUpdate(0, 1, 0.35)).toBe(true);
    expect(shouldAutoUpdate(0, 1, -0.35)).toBe(true);
    expect(shouldAutoUpdate(0, 1, 0.2)).toBe(false);
  });

  it("should trigger if any threshold is exceeded", () => {
    expect(shouldAutoUpdate(0.025, 1, 0)).toBe(true);
    expect(shouldAutoUpdate(0, 3.5, 0)).toBe(true);
    expect(shouldAutoUpdate(0, 1, 0.35)).toBe(true);
  });
});

describe("createEvidenceFromMarketEvent", () => {
  it("should create evidence with all required fields", () => {
    const evidence = createEvidenceFromMarketEvent(
      "price_move",
      0.05,
      "bullish",
      { source: "market_feed" }
    );

    expect(evidence.type).toBe("price_move");
    expect(evidence.value).toBe(0.05);
    expect(evidence.direction).toBe("bullish");
    expect(evidence.timestamp).toBeInstanceOf(Date);
    expect(evidence.metadata).toEqual({ source: "market_feed" });
  });

  it("should work without metadata", () => {
    const evidence = createEvidenceFromMarketEvent("volume_spike", 4.0, "neutral");

    expect(evidence.type).toBe("volume_spike");
    expect(evidence.metadata).toBeUndefined();
  });
});

describe("Bayesian posterior convergence", () => {
  it("should converge with consistent evidence", () => {
    const updater = new BayesianSignalUpdater(1);
    const consistentEvidence: Evidence[] = Array(10).fill(0).map(() => ({
      type: "price_move" as EvidenceType,
      value: 0.3,
      direction: "bullish" as const,
      timestamp: new Date(),
    }));

    let prob = 0.5;
    const probabilities = [prob];

    for (const evidence of consistentEvidence) {
      const result = updater.updateProbability(prob, evidence, "yes");
      prob = result.posterior;
      probabilities.push(prob);
    }

    // Check convergence: later updates should have smaller impact
    const firstChange = Math.abs(probabilities[1]! - probabilities[0]!);
    const lastChange = Math.abs(probabilities[10]! - probabilities[9]!);
    expect(lastChange).toBeLessThan(firstChange);
  });

  it("should stabilize around true probability with mixed evidence", () => {
    const updater = new BayesianSignalUpdater(1);
    
    // Simulate mixed evidence: 70% bullish, 30% bearish
    const mixedEvidence: Evidence[] = [];
    for (let i = 0; i < 100; i++) {
      mixedEvidence.push({
        type: "price_move" as EvidenceType,
        value: 0.3,
        direction: Math.random() < 0.7 ? "bullish" : "bearish",
        timestamp: new Date(),
      });
    }

    const finalProb = updater.updateWithEvidenceChain(0.5, mixedEvidence, "yes");

    // With 70% bullish evidence, probability should be above 0.5
    expect(finalProb).toBeGreaterThan(0.5);
    expect(finalProb).toBeLessThan(0.95); // But not extreme
  });
});
