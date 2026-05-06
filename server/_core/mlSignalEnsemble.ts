/**
 * ML Signal Ensemble Model — pure TypeScript Random Forest
 *
 * No external ML libraries.  Implements a Random Forest (bagging) for binary
 * classification: given a feature vector extracted from a KalshiSignal, predict
 * win probability [0,1].
 *
 * Integration:
 *   - extractFeatures() — converts a KalshiSignal to a numeric feature vector
 *   - trainEnsemble()   — trains a Random Forest from historical labelled data
 *   - predictEnsemble() — returns a probability for a new feature set
 *   - blendProbabilities() — combines ML and rule-based scores
 */

import type { KalshiSignal, SignalType } from "./kalshiSignals";

// ─── Constants ────────────────────────────────────────────────────────────────

export const N_TREES = 10;
export const MAX_DEPTH = 5;
export const MIN_SAMPLES_SPLIT = 5;
export const ML_WEIGHT = 0.6;
export const RULE_WEIGHT = 0.4;
export const FEATURE_COUNT = 15;

// Bootstrap sample fraction (80 %)
const BOOTSTRAP_FRACTION = 0.8;
// Number of features randomly considered at each split (≈ sqrt(15) ≈ 4)
const FEATURES_PER_SPLIT = 4;
// Threshold candidates per feature
const THRESHOLD_CANDIDATES = 10;

// ─── Feature vector ───────────────────────────────────────────────────────────

export interface SignalFeatures {
  /** one-hot encoded signal type, normalised to [0,1]: 0=value_play … 7=confluence */
  signalTypeEncoded: number;
  /** raw confidence value [0,1] */
  confidence: number;
  /** raw expected-value from signal */
  expectedValue: number;
  /** Bayesian posterior probability (or confidence as fallback) [0,1] */
  bayesianProbability: number;
  /** market implied probability [0,1] */
  impliedProbability: number;
  /** |impliedProbability - 0.5| * 2 — how extreme the market price is [0,1] */
  marketPriceExtremity: number;
  /** liquidity quality score [0,1] */
  liquidityScore: number;
  /** log1p(totalVolume) / 10 clamped [0,1] */
  volumeScore: number;
  /** 1 - spreadPct*10 clamped [0,1] */
  spreadScore: number;
  /** microstructure composite score [0,1] */
  microstructureScore: number;
  /** timeframe-alignment confluence score [0,1] */
  confluenceScore: number;
  /** count of aligned timeframes / 5, clamped [0,1] */
  timeframeCount: number;
  /** time to resolution normalised: log1p(hours) / log1p(8760) clamped [0,1] */
  hoursToResolution: number;
  /** category string hashed to [0,1] */
  categoryEncoded: number;
  /** historical win rate for this signal type/category [0,1]; defaults to 0.5 */
  historicalWinRate: number;
}

// ─── Signal-type → index mapping ─────────────────────────────────────────────

const SIGNAL_TYPE_INDEX: Record<SignalType, number> = {
  value_play: 0,
  momentum: 1,
  contrarian: 2,
  arbitrage: 3,
  sentiment: 4,
  multi_timeframe: 5,
  order_flow: 6,
  confluence: 7,
};

function encodeSignalType(type: SignalType): number {
  const idx = SIGNAL_TYPE_INDEX[type] ?? 0;
  return idx / 7;
}

function hashCategory(str: string): number {
  return Array.from(str).reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 100, 0) / 100;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * Extract a fixed-length feature vector from a KalshiSignal.
 *
 * All features are normalised to [0, 1] so tree splits are on a comparable
 * scale (though CART does not strictly require this).
 */
export function extractFeatures(
  signal: Pick<
    KalshiSignal,
    "signalType" | "confidence" | "expectedValue" | "impliedProbability" | "metadata" | "bayesianProbability"
  >,
  opts?: {
    historicalWinRate?: number;
    resolutionDate?: string;
    volume?: number;
    liquidity?: number;
  }
): SignalFeatures {
  const meta = signal.metadata ?? {};

  // ── Volume/liquidity ────────────────────────────────────────────────────────
  const rawVolume = opts?.volume ?? meta.totalVolume ?? 0;
  const volumeScore = clamp01(Math.log1p(rawVolume) / 10);

  const rawSpreadPct = meta.spreadPct ?? meta.spreadProxy ?? 0;
  const spreadScore = clamp01(1 - rawSpreadPct * 10);

  const liquidityScore = clamp01(opts?.liquidity ?? meta.liquidityScore ?? 0.5);

  // ── Advanced signals ────────────────────────────────────────────────────────
  const microstructureScore = clamp01(meta.microstructureScore ?? 0);
  const confluenceScore = clamp01(meta.confluenceScore ?? 0);
  const timeframeCount = clamp01((meta.timeframeAlignment?.length ?? 0) / 5);

  // ── Time to resolution ──────────────────────────────────────────────────────
  const resDate = opts?.resolutionDate ?? meta.resolutionDate;
  let hoursToResolution = 0.5; // unknown → midpoint
  if (resDate) {
    const msRemaining = new Date(resDate).getTime() - Date.now();
    if (Number.isFinite(msRemaining)) {
      const hours = Math.max(0, msRemaining / 3_600_000);
      // Normalise: log1p(hours) / log1p(8760 hours in 1 year)
      hoursToResolution = clamp01(Math.log1p(hours) / Math.log1p(8760));
    }
  }

  // ── Category ────────────────────────────────────────────────────────────────
  const categoryStr = meta.marketCategory ?? "";
  const categoryEncoded = hashCategory(categoryStr);

  // ── EV normalisation: clamp raw EV to [-1, 1] then rescale to [0,1] ────────
  const evNorm = clamp01((clamp01(signal.expectedValue + 1) ) / 2);

  return {
    signalTypeEncoded: encodeSignalType(signal.signalType),
    confidence: clamp01(signal.confidence),
    expectedValue: evNorm,
    bayesianProbability: clamp01(signal.bayesianProbability ?? signal.confidence),
    impliedProbability: clamp01(signal.impliedProbability),
    marketPriceExtremity: clamp01(Math.abs(signal.impliedProbability - 0.5) * 2),
    liquidityScore,
    volumeScore,
    spreadScore,
    microstructureScore,
    confluenceScore,
    timeframeCount,
    hoursToResolution,
    categoryEncoded,
    historicalWinRate: clamp01(opts?.historicalWinRate ?? 0.5),
  };
}

/** Flatten a SignalFeatures object to an ordered numeric array (length = FEATURE_COUNT). */
export function featuresToArray(f: SignalFeatures): number[] {
  return [
    f.signalTypeEncoded,
    f.confidence,
    f.expectedValue,
    f.bayesianProbability,
    f.impliedProbability,
    f.marketPriceExtremity,
    f.liquidityScore,
    f.volumeScore,
    f.spreadScore,
    f.microstructureScore,
    f.confluenceScore,
    f.timeframeCount,
    f.hoursToResolution,
    f.categoryEncoded,
    f.historicalWinRate,
  ];
}

// ─── Tree data structures ─────────────────────────────────────────────────────

export interface TreeNode {
  isLeaf: boolean;
  prediction?: number;   // leaf: mean outcome probability
  featureIndex?: number; // split: which feature
  threshold?: number;    // split: split point
  left?: TreeNode;       // feature value <= threshold
  right?: TreeNode;      // feature value >  threshold
  samples?: number;      // count of training examples at this node
}

interface TrainingExample {
  features: number[];
  outcome: 0 | 1;
  weight: number;
}

// ─── CART tree building ───────────────────────────────────────────────────────

function weightedMean(examples: TrainingExample[]): number {
  let sumW = 0;
  let sumWY = 0;
  for (const e of examples) {
    sumW += e.weight;
    sumWY += e.weight * e.outcome;
  }
  return sumW === 0 ? 0.5 : sumWY / sumW;
}

function giniImpurity(examples: TrainingExample[]): number {
  const totalWeight = examples.reduce((s, e) => s + e.weight, 0);
  if (totalWeight === 0) return 0;
  const p1 = examples.reduce((s, e) => s + e.weight * e.outcome, 0) / totalWeight;
  return 2 * p1 * (1 - p1);
}

function allSameOutcome(examples: TrainingExample[]): boolean {
  if (examples.length === 0) return true;
  const first = examples[0]!.outcome;
  return examples.every((e) => e.outcome === first);
}

/** Percentile value of a sorted array. */
function percentile(sorted: number[], p: number): number {
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]!;
}

/**
 * Build a single CART classification tree with bootstrap-sampled feature
 * subspace at each split node.
 *
 * @param examples - training examples for this subtree
 * @param depth    - current recursion depth
 * @param featureSubset - indices of features available at this depth level
 */
function buildTree(
  examples: TrainingExample[],
  depth: number,
  featureSubset?: number[]
): TreeNode {
  // Leaf conditions
  if (
    depth >= MAX_DEPTH ||
    examples.length < MIN_SAMPLES_SPLIT ||
    allSameOutcome(examples)
  ) {
    return { isLeaf: true, prediction: weightedMean(examples), samples: examples.length };
  }

  // Select feature subset for this node (random forest: sqrt(features))
  const availableFeatures =
    featureSubset ?? Array.from({ length: FEATURE_COUNT }, (_, i) => i);

  // Randomly sample FEATURES_PER_SPLIT features without replacement
  const shuffled = [...availableFeatures].sort(() => Math.random() - 0.5);
  const splitFeatures = shuffled.slice(0, Math.min(FEATURES_PER_SPLIT, shuffled.length));

  const parentGini = giniImpurity(examples);
  let bestGain = 0;
  let bestFeature = -1;
  let bestThreshold = 0;

  for (const fi of splitFeatures) {
    const values = examples.map((e) => e.features[fi]!).sort((a, b) => a - b);
    if (values[0] === values[values.length - 1]) continue; // constant feature

    for (let p = 1; p <= THRESHOLD_CANDIDATES; p++) {
      const threshold = percentile(values, p * (100 / (THRESHOLD_CANDIDATES + 1)));

      const left  = examples.filter((e) => e.features[fi]! <= threshold);
      const right = examples.filter((e) => e.features[fi]! > threshold);

      if (left.length === 0 || right.length === 0) continue;

      const n = examples.length;
      const gain =
        parentGini -
        (left.length / n) * giniImpurity(left) -
        (right.length / n) * giniImpurity(right);

      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = fi;
        bestThreshold = threshold;
      }
    }
  }

  // No useful split found → leaf
  if (bestFeature === -1 || bestGain <= 0) {
    return { isLeaf: true, prediction: weightedMean(examples), samples: examples.length };
  }

  const leftExamples  = examples.filter((e) => e.features[bestFeature]! <= bestThreshold);
  const rightExamples = examples.filter((e) => e.features[bestFeature]! > bestThreshold);

  return {
    isLeaf: false,
    featureIndex: bestFeature,
    threshold: bestThreshold,
    samples: examples.length,
    left:  buildTree(leftExamples,  depth + 1),
    right: buildTree(rightExamples, depth + 1),
  };
}

/** Traverse a single tree and return a leaf prediction. */
function predictTree(node: TreeNode, features: number[]): number {
  if (node.isLeaf) return node.prediction ?? 0.5;
  const val = features[node.featureIndex!]!;
  if (val <= node.threshold!) {
    return predictTree(node.left!, features);
  }
  return predictTree(node.right!, features);
}

// ─── Ensemble model ───────────────────────────────────────────────────────────

export interface EnsembleModel {
  trees: TreeNode[];
  learningRate: number;        // kept for interface compatibility; RF uses 1.0
  initialPrediction: number;   // mean of training outcomes (base rate)
  version: number;
  trainedAt: string;           // ISO date string
  trainingSamples: number;
}

/**
 * Train a Random Forest ensemble classifier.
 *
 * @param trainingData - array of { features, outcome } pairs
 * @param opts         - optional overrides for nTrees / maxDepth
 */
export function trainEnsemble(
  trainingData: Array<{ features: SignalFeatures; outcome: 0 | 1 }>,
  opts?: { nTrees?: number; maxDepth?: number }
): EnsembleModel {
  const nTrees = opts?.nTrees ?? N_TREES;
  const n = trainingData.length;

  // Convert to internal format
  const examples: TrainingExample[] = trainingData.map((d) => ({
    features: featuresToArray(d.features),
    outcome: d.outcome,
    weight: 1,
  }));

  // Base rate
  const initialPrediction =
    n === 0 ? 0.5 : examples.reduce((s, e) => s + e.outcome, 0) / n;

  const trees: TreeNode[] = [];
  const bootstrapSize = Math.max(1, Math.floor(n * BOOTSTRAP_FRACTION));

  for (let t = 0; t < nTrees; t++) {
    // Bootstrap sample with replacement
    const sample: TrainingExample[] = [];
    for (let i = 0; i < bootstrapSize; i++) {
      const idx = Math.floor(Math.random() * n);
      sample.push(examples[idx]!);
    }
    trees.push(buildTree(sample, 0));
  }

  return {
    trees,
    learningRate: 1.0,
    initialPrediction,
    version: 1,
    trainedAt: new Date().toISOString(),
    trainingSamples: n,
  };
}

/**
 * Predict win probability for a set of features.
 * Returns the average leaf prediction across all trees, clamped to [0,1].
 */
export function predictEnsemble(model: EnsembleModel, features: SignalFeatures): number {
  if (model.trees.length === 0) return model.initialPrediction;
  const featArr = featuresToArray(features);
  const sum = model.trees.reduce((s, tree) => s + predictTree(tree, featArr), 0);
  const avg = sum / model.trees.length;
  return Math.max(0, Math.min(1, avg));
}

/**
 * Blend ML probability and rule-based probability.
 * final = ML_WEIGHT * mlProbability + RULE_WEIGHT * ruleProbability
 * Result clamped to [0,1].
 */
export function blendProbabilities(mlProbability: number, ruleProbability: number): number {
  const blended = ML_WEIGHT * mlProbability + RULE_WEIGHT * ruleProbability;
  return Math.max(0, Math.min(1, blended));
}

// ─── Serialization ────────────────────────────────────────────────────────────

export function serializeModel(model: EnsembleModel): string {
  return JSON.stringify(model);
}

export function deserializeModel(json: string): EnsembleModel {
  const parsed: unknown = JSON.parse(json);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as EnsembleModel).trees) ||
    typeof (parsed as EnsembleModel).initialPrediction !== "number" ||
    typeof (parsed as EnsembleModel).trainingSamples !== "number"
  ) {
    throw new Error("deserializeModel: invalid model JSON");
  }
  return parsed as EnsembleModel;
}
