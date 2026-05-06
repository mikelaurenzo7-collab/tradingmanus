/**
 * Tests for the ML Signal Ensemble module.
 * All tests are pure — no mocks required because the module has no external dependencies.
 */

import { describe, it, expect } from "vitest";
import {
  extractFeatures,
  trainEnsemble,
  predictEnsemble,
  blendProbabilities,
  serializeModel,
  deserializeModel,
  featuresToArray,
  N_TREES,
  ML_WEIGHT,
  RULE_WEIGHT,
  FEATURE_COUNT,
  type SignalFeatures,
} from "./_core/mlSignalEnsemble";
import type { SignalType } from "./_core/kalshiSignals";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSignal(overrides?: {
  signalType?: SignalType;
  confidence?: number;
  expectedValue?: number;
  impliedProbability?: number;
  bayesianProbability?: number;
  metadata?: Record<string, unknown>;
}) {
  return {
    signalType: (overrides?.signalType ?? "value_play") as SignalType,
    confidence: overrides?.confidence ?? 0.7,
    expectedValue: overrides?.expectedValue ?? 0.15,
    impliedProbability: overrides?.impliedProbability ?? 0.45,
    bayesianProbability: overrides?.bayesianProbability,
    metadata: overrides?.metadata as any,
  };
}

function allInRange(f: SignalFeatures): boolean {
  return featuresToArray(f).every((v) => v >= 0 && v <= 1);
}

function makeSyntheticData(n: number, positiveRate = 0.6) {
  return Array.from({ length: n }, (_, i) => {
    const outcome = (i / n < positiveRate ? 1 : 0) as 0 | 1;
    const features = extractFeatures(
      makeSignal({ confidence: 0.5 + Math.random() * 0.4 }),
    );
    return { features, outcome };
  });
}

// ─── Feature extraction ───────────────────────────────────────────────────────

describe("extractFeatures", () => {
  it("produces all features in [0,1] for a basic signal", () => {
    const features = extractFeatures(makeSignal());
    expect(allInRange(features)).toBe(true);
  });

  it("handles completely undefined metadata gracefully", () => {
    const features = extractFeatures(makeSignal({ metadata: undefined }));
    expect(allInRange(features)).toBe(true);
    // liquidityScore defaults to 0.5 when unknown
    expect(features.liquidityScore).toBe(0.5);
    // hoursToResolution defaults to 0.5 when no date
    expect(features.hoursToResolution).toBe(0.5);
  });

  it("encodes signalType=value_play as 0/7", () => {
    const f = extractFeatures(makeSignal({ signalType: "value_play" }));
    expect(f.signalTypeEncoded).toBeCloseTo(0 / 7, 10);
  });

  it("encodes signalType=momentum as 1/7", () => {
    const f = extractFeatures(makeSignal({ signalType: "momentum" }));
    expect(f.signalTypeEncoded).toBeCloseTo(1 / 7, 10);
  });

  it("encodes signalType=confluence as 7/7 = 1", () => {
    const f = extractFeatures(makeSignal({ signalType: "confluence" }));
    expect(f.signalTypeEncoded).toBeCloseTo(7 / 7, 10);
  });

  it("marketPriceExtremity = |price - 0.5| * 2", () => {
    const f30 = extractFeatures(makeSignal({ impliedProbability: 0.3 }));
    expect(f30.marketPriceExtremity).toBeCloseTo(Math.abs(0.3 - 0.5) * 2, 10);

    const f80 = extractFeatures(makeSignal({ impliedProbability: 0.8 }));
    expect(f80.marketPriceExtremity).toBeCloseTo(Math.abs(0.8 - 0.5) * 2, 10);

    const f50 = extractFeatures(makeSignal({ impliedProbability: 0.5 }));
    expect(f50.marketPriceExtremity).toBe(0);
  });

  it("categoryEncoded is always in [0,1]", () => {
    const cats = ["crypto", "politics", "sports", "weather", "", "very long category string"];
    for (const cat of cats) {
      const f = extractFeatures(makeSignal({ metadata: { marketCategory: cat } }));
      expect(f.categoryEncoded).toBeGreaterThanOrEqual(0);
      expect(f.categoryEncoded).toBeLessThanOrEqual(1);
    }
  });

  it("uses bayesianProbability when provided, falls back to confidence", () => {
    const withBayes = extractFeatures(makeSignal({ confidence: 0.6, bayesianProbability: 0.75 }));
    expect(withBayes.bayesianProbability).toBeCloseTo(0.75, 5);

    const withoutBayes = extractFeatures(makeSignal({ confidence: 0.6, bayesianProbability: undefined }));
    expect(withoutBayes.bayesianProbability).toBeCloseTo(0.6, 5);
  });

  it("derives hoursToResolution from opts.resolutionDate", () => {
    const future = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
    const f = extractFeatures(makeSignal(), { resolutionDate: future });
    expect(f.hoursToResolution).toBeGreaterThan(0);
    expect(f.hoursToResolution).toBeLessThanOrEqual(1);
  });

  it("metadata.spreadPct contributes to spreadScore", () => {
    const tight = extractFeatures(makeSignal({ metadata: { spreadPct: 0.01 } }));
    const wide  = extractFeatures(makeSignal({ metadata: { spreadPct: 0.15 } }));
    expect(tight.spreadScore).toBeGreaterThan(wide.spreadScore);
  });

  it("metadata.microstructureScore and confluenceScore are forwarded", () => {
    const f = extractFeatures(makeSignal({ metadata: { microstructureScore: 0.8, confluenceScore: 0.6 } }));
    expect(f.microstructureScore).toBeCloseTo(0.8, 5);
    expect(f.confluenceScore).toBeCloseTo(0.6, 5);
  });

  it("feature vector length equals FEATURE_COUNT", () => {
    const f = extractFeatures(makeSignal());
    expect(featuresToArray(f)).toHaveLength(FEATURE_COUNT);
  });
});

// ─── Training ─────────────────────────────────────────────────────────────────

describe("trainEnsemble", () => {
  it("trains on 20 examples without error", () => {
    const data = makeSyntheticData(20);
    const model = trainEnsemble(data);
    expect(model).toBeDefined();
    expect(model.trees.length).toBeGreaterThan(0);
  });

  it("returns a model with exactly N_TREES trees by default", () => {
    const model = trainEnsemble(makeSyntheticData(30));
    expect(model.trees).toHaveLength(N_TREES);
  });

  it("respects nTrees override", () => {
    const model = trainEnsemble(makeSyntheticData(30), { nTrees: 5 });
    expect(model.trees).toHaveLength(5);
  });

  it("initialPrediction equals fraction of positive outcomes", () => {
    const data = [
      { features: extractFeatures(makeSignal()), outcome: 1 as const },
      { features: extractFeatures(makeSignal()), outcome: 1 as const },
      { features: extractFeatures(makeSignal()), outcome: 0 as const },
      { features: extractFeatures(makeSignal()), outcome: 0 as const },
    ];
    const model = trainEnsemble(data);
    expect(model.initialPrediction).toBeCloseTo(0.5, 5);
  });

  it("sets trainingSamples correctly", () => {
    const n = 25;
    const model = trainEnsemble(makeSyntheticData(n));
    expect(model.trainingSamples).toBe(n);
  });

  it("produces predictions > 0.5 when all training outcomes are positive", () => {
    const allWin = Array.from({ length: 20 }, () => ({
      features: extractFeatures(makeSignal({ confidence: 0.8 })),
      outcome: 1 as const,
    }));
    const model = trainEnsemble(allWin);
    const pred = predictEnsemble(model, extractFeatures(makeSignal({ confidence: 0.8 })));
    expect(pred).toBeGreaterThan(0.5);
  });

  it("produces predictions < 0.5 when all training outcomes are negative", () => {
    const allLose = Array.from({ length: 20 }, () => ({
      features: extractFeatures(makeSignal({ confidence: 0.2 })),
      outcome: 0 as const,
    }));
    const model = trainEnsemble(allLose);
    const pred = predictEnsemble(model, extractFeatures(makeSignal({ confidence: 0.2 })));
    expect(pred).toBeLessThan(0.5);
  });
});

// ─── Prediction ───────────────────────────────────────────────────────────────

describe("predictEnsemble", () => {
  it("always returns value in [0, 1]", () => {
    const model = trainEnsemble(makeSyntheticData(30));
    for (let i = 0; i < 20; i++) {
      const pred = predictEnsemble(model, extractFeatures(makeSignal()));
      expect(pred).toBeGreaterThanOrEqual(0);
      expect(pred).toBeLessThanOrEqual(1);
    }
  });

  it("returns initialPrediction when model has no trees", () => {
    const model = trainEnsemble(makeSyntheticData(30));
    const emptyModel = { ...model, trees: [] };
    const pred = predictEnsemble(emptyModel, extractFeatures(makeSignal()));
    expect(pred).toBeCloseTo(model.initialPrediction, 5);
  });
});

// ─── blendProbabilities ───────────────────────────────────────────────────────

describe("blendProbabilities", () => {
  it("computes 0.6*ML + 0.4*rule correctly", () => {
    const result = blendProbabilities(0.8, 0.6);
    expect(result).toBeCloseTo(ML_WEIGHT * 0.8 + RULE_WEIGHT * 0.6, 10);
    expect(result).toBeCloseTo(0.72, 10);
  });

  it("clamps result to [0,1] at extremes", () => {
    expect(blendProbabilities(0, 0)).toBe(0);
    expect(blendProbabilities(1, 1)).toBe(1);
    expect(blendProbabilities(0, 1)).toBeCloseTo(RULE_WEIGHT, 10);
    expect(blendProbabilities(1, 0)).toBeCloseTo(ML_WEIGHT, 10);
  });

  it("ML_WEIGHT + RULE_WEIGHT = 1.0", () => {
    expect(ML_WEIGHT + RULE_WEIGHT).toBeCloseTo(1.0, 10);
  });
});

// ─── Serialization ────────────────────────────────────────────────────────────

describe("serializeModel / deserializeModel", () => {
  it("round-trips a trained model without loss", () => {
    const data = makeSyntheticData(40);
    const model = trainEnsemble(data);
    const json = serializeModel(model);
    const restored = deserializeModel(json);

    expect(restored.trainingSamples).toBe(model.trainingSamples);
    expect(restored.initialPrediction).toBeCloseTo(model.initialPrediction, 10);
    expect(restored.trees).toHaveLength(model.trees.length);
    expect(restored.version).toBe(model.version);
    expect(restored.trainedAt).toBe(model.trainedAt);
  });

  it("restored model produces identical predictions to original", () => {
    const data = makeSyntheticData(40);
    const model = trainEnsemble(data);
    const restored = deserializeModel(serializeModel(model));
    const features = extractFeatures(makeSignal({ confidence: 0.75 }));

    expect(predictEnsemble(restored, features)).toBeCloseTo(predictEnsemble(model, features), 10);
  });

  it("throws on invalid JSON", () => {
    expect(() => deserializeModel("not json")).toThrow();
  });

  it("throws on JSON missing required fields", () => {
    expect(() => deserializeModel(JSON.stringify({ foo: "bar" }))).toThrow("deserializeModel: invalid model JSON");
  });
});

// ─── Performance ─────────────────────────────────────────────────────────────

describe("performance", () => {
  it("trains on 100 examples in <500ms", () => {
    const data = makeSyntheticData(100);
    const start = Date.now();
    trainEnsemble(data);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("predicts 1000 signals in <100ms after training", () => {
    const model = trainEnsemble(makeSyntheticData(50));
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      predictEnsemble(model, extractFeatures(makeSignal()));
    }
    expect(Date.now() - start).toBeLessThan(100);
  });
});
