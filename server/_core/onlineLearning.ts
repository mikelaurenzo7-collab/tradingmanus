export type TradeOutcome = "win" | "loss" | "breakeven";

export interface OnlineLearningModel {
  userId: number;
  platform: "kalshi" | "polymarket";
  modelVersion: number;
  updateCount: number;
  emaPnl: number;
  driftScore: number;
  signalWeights: Record<string, number>;
  posteriors: Record<string, { alpha: number; beta: number }>;
}

export interface OnlineLearningUpdateInput {
  signalType: string;
  outcome: TradeOutcome;
  pnl: number;
  observedConfidence?: number;
}

export interface OnlineLearningUpdateResult {
  nextModel: OnlineLearningModel;
  weightBefore: number;
  weightAfter: number;
  driftDetected: boolean;
  explorationTaken: boolean;
  confidenceLower: number;
  confidenceUpper: number;
}

const EMA_ALPHA = 0.1;
const SGD_LEARNING_RATE = 0.08;
const WIN_BOOST = 0.05;
const LOSS_PENALTY = -0.08;
const MIN_WEIGHT = 0.2;
const MAX_WEIGHT = 2;
const DRIFT_THRESHOLD = 0.35;
const VERSION_STEP = 50;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function createInitialOnlineLearningModel(input: {
  userId: number;
  platform: "kalshi" | "polymarket";
}): OnlineLearningModel {
  return {
    userId: input.userId,
    platform: input.platform,
    modelVersion: 1,
    updateCount: 0,
    emaPnl: 0,
    driftScore: 0,
    signalWeights: {},
    posteriors: {},
  };
}

function getPosterior(model: OnlineLearningModel, signalType: string) {
  return model.posteriors[signalType] ?? { alpha: 1, beta: 1 };
}

function confidenceBounds(alpha: number, beta: number): { lower: number; upper: number } {
  const mean = alpha / (alpha + beta);
  const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
  const std = Math.sqrt(Math.max(variance, 0));
  return {
    lower: clamp(mean - 1.96 * std, 0, 1),
    upper: clamp(mean + 1.96 * std, 0, 1),
  };
}

function partialResetWeights(weights: Record<string, number>): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [signalType, weight] of Object.entries(weights)) {
    // Recency-weighted reset toward neutral = 1.
    next[signalType] = clamp(weight * 0.6 + 1 * 0.4, MIN_WEIGHT, MAX_WEIGHT);
  }
  return next;
}

export function applyOnlineLearningUpdate(
  model: OnlineLearningModel,
  input: OnlineLearningUpdateInput,
  random: () => number = Math.random
): OnlineLearningUpdateResult {
  const signalType = input.signalType;
  const weightBefore = model.signalWeights[signalType] ?? 1;

  const target = input.outcome === "win" ? 1 : input.outcome === "loss" ? 0 : 0.5;
  const prediction = clamp(weightBefore / MAX_WEIGHT, 0, 1);
  const gradient = target - prediction;

  const outcomeNudge = input.outcome === "win" ? WIN_BOOST : input.outcome === "loss" ? LOSS_PENALTY : 0;
  let weightAfter = weightBefore + SGD_LEARNING_RATE * gradient + outcomeNudge;
  weightAfter = clamp(weightAfter, MIN_WEIGHT, MAX_WEIGHT);

  const nextEmaPnl = (1 - EMA_ALPHA) * model.emaPnl + EMA_ALPHA * input.pnl;
  const normalizedResidual = Math.abs(input.pnl - nextEmaPnl) / Math.max(Math.abs(nextEmaPnl), 1);
  const nextDriftScore = (1 - EMA_ALPHA) * model.driftScore + EMA_ALPHA * normalizedResidual;
  const driftDetected = nextDriftScore > DRIFT_THRESHOLD;

  const posterior = getPosterior(model, signalType);
  const nextPosterior = {
    alpha: posterior.alpha + (input.outcome === "win" ? 1 : 0),
    beta: posterior.beta + (input.outcome === "loss" ? 1 : 0),
  };

  const nextUpdateCount = model.updateCount + 1;
  const nextModelVersion = Math.floor(nextUpdateCount / VERSION_STEP) + 1;
  const explorationTaken = random() < 0.1;

  const nextWeights = {
    ...model.signalWeights,
    [signalType]: weightAfter,
  };

  const nextModel: OnlineLearningModel = {
    ...model,
    modelVersion: nextModelVersion,
    updateCount: nextUpdateCount,
    emaPnl: nextEmaPnl,
    driftScore: nextDriftScore,
    signalWeights: driftDetected ? partialResetWeights(nextWeights) : nextWeights,
    posteriors: {
      ...model.posteriors,
      [signalType]: nextPosterior,
    },
  };

  const bounds = confidenceBounds(nextPosterior.alpha, nextPosterior.beta);

  return {
    nextModel,
    weightBefore,
    weightAfter: nextModel.signalWeights[signalType] ?? weightAfter,
    driftDetected,
    explorationTaken,
    confidenceLower: bounds.lower,
    confidenceUpper: bounds.upper,
  };
}

export function deriveModelFromUpdates(input: {
  userId: number;
  platform: "kalshi" | "polymarket";
  updates: Array<{
    signalType: string;
    outcome: TradeOutcome;
    pnl: number;
  }>;
}): OnlineLearningModel {
  let model = createInitialOnlineLearningModel({
    userId: input.userId,
    platform: input.platform,
  });

  for (const update of input.updates) {
    model = applyOnlineLearningUpdate(model, update, () => 0.5).nextModel;
  }

  return model;
}

export function selectSignalTypeWithThompsonSampling(input: {
  candidates: string[];
  model: OnlineLearningModel;
  random?: () => number;
}): string | null {
  if (input.candidates.length === 0) return null;
  const random = input.random ?? Math.random;

  if (random() < 0.1) {
    return input.candidates[Math.floor(random() * input.candidates.length)] ?? null;
  }

  let bestCandidate = input.candidates[0] ?? null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of input.candidates) {
    const p = getPosterior(input.model, candidate);
    const mean = p.alpha / (p.alpha + p.beta);
    const uncertainty = 1 / Math.sqrt(p.alpha + p.beta);
    const sample = mean + (random() - 0.5) * uncertainty;
    if (sample > bestScore) {
      bestScore = sample;
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}
