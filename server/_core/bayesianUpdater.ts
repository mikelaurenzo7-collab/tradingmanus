/**
 * Bayesian Probability Updater
 * 
 * Implements Bayesian inference for signal probability updates based on new evidence.
 * Uses Bayes theorem: P(outcome|evidence) = P(evidence|outcome) * P(outcome) / P(evidence)
 */

import { logger } from "./logger";
import * as db from "../db";
import { assertPositiveIntegerUserId } from "./userScope";

/**
 * Evidence types that can update signal probabilities
 */
export type EvidenceType = 
  | "price_move"      // Price change >2%
  | "volume_spike"    // Volume increase >3x
  | "sentiment_shift" // Sentiment change >0.3
  | "news_item"       // News event
  | "market_close"    // Market approaching close
  | "fundamental";    // New fundamental data

/**
 * Evidence value structure
 */
export interface Evidence {
  type: EvidenceType;
  value: number;          // Magnitude of the evidence (e.g., price change %, volume multiplier)
  direction: "bullish" | "bearish" | "neutral";
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Bayesian update result tracking the full evidence chain
 */
export interface BayesianUpdate {
  prior: number;              // Probability before this evidence
  likelihood: number;         // P(evidence|outcome)
  evidenceProb: number;       // P(evidence) - normalization constant
  posterior: number;          // Probability after this evidence
  evidence: Evidence;
  confidenceAdjustment: number; // How much this update changed the probability
}

/**
 * Category baseline probabilities (priors)
 * These serve as starting points before any market-specific information
 */
const CATEGORY_BASELINES: Record<string, number> = {
  "politics": 0.50,
  "sports": 0.50,
  "economics": 0.50,
  "weather": 0.50,
  "crypto": 0.50,
  "entertainment": 0.50,
  "default": 0.50,
};

/**
 * Evidence decay half-life in milliseconds (4 hours)
 * Recent evidence is weighted more heavily than older evidence
 */
const EVIDENCE_DECAY_HALF_LIFE_MS = 4 * 60 * 60 * 1000;

/**
 * Tempering factor for log-odds updates (0-1).
 * Prevents runaway posterior convergence when many sequential updates are applied.
 * A value of 0.2 means each step contributes 20% of its raw log-odds change.
 */
const EVIDENCE_TEMPERING_FACTOR = 0.2;

/**
 * Likelihood calculation parameters
 * These determine how strongly different evidence types update probabilities
 */
const LIKELIHOOD_PARAMS = {
  price_move: {
    baseStrength: 0.7,      // Base likelihood when evidence supports outcome
    nullStrength: 0.3,      // Likelihood when evidence opposes outcome
  },
  volume_spike: {
    baseStrength: 0.65,
    nullStrength: 0.35,
  },
  sentiment_shift: {
    baseStrength: 0.6,
    nullStrength: 0.4,
  },
  news_item: {
    baseStrength: 0.75,
    nullStrength: 0.25,
  },
  market_close: {
    baseStrength: 0.8,      // Strong signal near market close
    nullStrength: 0.2,
  },
  fundamental: {
    baseStrength: 0.85,     // Strongest signal for fundamental data
    nullStrength: 0.15,
  },
};

/**
 * BayesianSignalUpdater - Core class for managing Bayesian probability updates
 */
export class BayesianSignalUpdater {
  private userId: number;
  private evidenceChain: BayesianUpdate[];
  
  constructor(userId: number) {
    assertPositiveIntegerUserId(userId);
    this.userId = userId;
    this.evidenceChain = [];
  }

  /**
   * Initialize prior probability from category baseline + fundamental estimate
   */
  static calculatePriorProbability(
    category: string,
    fundamentalEstimate?: number,
    fundamentalWeight = 0.7
  ): number {
    const baseline = CATEGORY_BASELINES[category] ?? CATEGORY_BASELINES.default!;
    
    if (fundamentalEstimate !== undefined && fundamentalEstimate >= 0 && fundamentalEstimate <= 1) {
      // Blend category baseline with fundamental estimate
      return baseline * (1 - fundamentalWeight) + fundamentalEstimate * fundamentalWeight;
    }
    
    return baseline;
  }

  /**
   * Calculate likelihood P(evidence|outcome) based on evidence type and strength
   * 
   * The likelihood represents how probable this evidence is given the outcome we're considering.
   * Higher likelihood means the evidence strongly supports the outcome.
   */
  private calculateLikelihood(evidence: Evidence, outcomeSupported: boolean): number {
    const params = LIKELIHOOD_PARAMS[evidence.type];
    
    if (!params) {
      logger.warn({ evidenceType: evidence.type }, "Unknown evidence type, using neutral likelihood");
      return 0.5;
    }

    // Base likelihood depends on whether evidence supports the outcome
    const baseLikelihood = outcomeSupported ? params.baseStrength : params.nullStrength;
    
    // Scale by evidence magnitude (normalized 0-1)
    const magnitude = Math.min(1, Math.abs(evidence.value));
    
    // For neutral evidence, return 0.5 (no directional signal)
    if (evidence.direction === "neutral") {
      return 0.5;
    }
    
    // Interpolate between base and neutral (0.5) based on magnitude
    return 0.5 + (baseLikelihood - 0.5) * magnitude;
  }

  /**
   * Calculate evidence probability P(evidence) using law of total probability
   * P(evidence) = P(evidence|outcome) * P(outcome) + P(evidence|¬outcome) * P(¬outcome)
   */
  private calculateEvidenceProb(
    likelihoodGivenOutcome: number,
    likelihoodGivenNotOutcome: number,
    priorProb: number
  ): number {
    return likelihoodGivenOutcome * priorProb + likelihoodGivenNotOutcome * (1 - priorProb);
  }

  /**
   * Apply exponential time decay to evidence weight
   * Recent evidence gets higher weight than older evidence
   */
  static calculateEvidenceWeight(evidenceTimestamp: Date, currentTime: Date = new Date()): number {
    const ageMs = currentTime.getTime() - evidenceTimestamp.getTime();
    
    // Exponential decay: weight = 2^(-age / half_life)
    const weight = Math.pow(2, -ageMs / EVIDENCE_DECAY_HALF_LIFE_MS);
    
    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, weight));
  }

  /**
   * Update probability using Bayes theorem
   * P(outcome|evidence) = P(evidence|outcome) * P(outcome) / P(evidence)
   */
  updateProbability(
    priorProb: number,
    evidence: Evidence,
    outcomeDirection: "yes" | "no"
  ): BayesianUpdate {
    // Determine if evidence supports the outcome
    const evidenceSupportsYes = evidence.direction === "bullish";
    const outcomeSupported = (outcomeDirection === "yes" && evidenceSupportsYes) ||
                            (outcomeDirection === "no" && !evidenceSupportsYes);

    // Calculate raw likelihoods: "supported" = evidence aligns with outcome, "opposed" = evidence opposes it
    const likelihoodSupported = this.calculateLikelihood(evidence, true);
    const likelihoodOpposed = this.calculateLikelihood(evidence, false);

    // Assign likelihoods correctly based on whether this evidence supports the outcome
    const likelihoodGivenOutcome = outcomeSupported ? likelihoodSupported : likelihoodOpposed;
    const likelihoodGivenNotOutcome = outcomeSupported ? likelihoodOpposed : likelihoodSupported;
    
    // Calculate P(evidence) using law of total probability
    const evidenceProb = this.calculateEvidenceProb(
      likelihoodGivenOutcome,
      likelihoodGivenNotOutcome,
      priorProb
    );

    // Bayes theorem application
    const rawPosterior = (likelihoodGivenOutcome * priorProb) / evidenceProb;

    // Apply tempering in log-odds space to prevent extreme posterior convergence.
    // Without tempering, sequential updates can drive probabilities to near 0 or 1.
    const priorLogOdds = Math.log(priorProb / (1 - priorProb));
    const rawLogOdds = Math.log(rawPosterior / (1 - rawPosterior));
    const temperedLogOdds = priorLogOdds + (rawLogOdds - priorLogOdds) * EVIDENCE_TEMPERING_FACTOR;
    
    // Clamp to valid probability range
    const posterior = Math.max(0.001, Math.min(0.999, 1 / (1 + Math.exp(-temperedLogOdds))));

    // Calculate time-weighted adjustment
    const weight = BayesianSignalUpdater.calculateEvidenceWeight(evidence.timestamp);
    const confidenceAdjustment = Math.abs(posterior - priorProb) * weight;

    const update: BayesianUpdate = {
      prior: priorProb,
      likelihood: outcomeSupported ? likelihoodGivenOutcome : likelihoodGivenNotOutcome,
      evidenceProb,
      posterior,
      evidence,
      confidenceAdjustment,
    };

    this.evidenceChain.push(update);

    return update;
  }

  /**
   * Apply multiple pieces of evidence sequentially
   * Each posterior becomes the prior for the next update
   */
  updateWithEvidenceChain(
    initialPrior: number,
    evidenceList: Evidence[],
    outcomeDirection: "yes" | "no"
  ): number {
    let currentProb = initialPrior;

    for (const evidence of evidenceList) {
      const update = this.updateProbability(currentProb, evidence, outcomeDirection);
      currentProb = update.posterior;
    }

    return currentProb;
  }

  /**
   * Get the full evidence chain for auditability
   */
  getEvidenceChain(): BayesianUpdate[] {
    return [...this.evidenceChain];
  }

  /**
   * Clear evidence chain (e.g., when starting a new signal)
   */
  clearEvidenceChain(): void {
    this.evidenceChain = [];
  }

  /**
   * Calculate posterior convergence measure
   * Returns the rate at which additional evidence changes the probability
   */
  calculateConvergence(): number {
    if (this.evidenceChain.length < 2) {
      return 1; // No convergence measurement possible
    }

    // Calculate average adjustment magnitude over last 3 updates
    const recentUpdates = this.evidenceChain.slice(-3);
    const avgAdjustment = recentUpdates.reduce((sum, u) => sum + u.confidenceAdjustment, 0) / recentUpdates.length;

    // Convergence is inverse of adjustment magnitude (0 = fully converged, 1 = still volatile)
    return avgAdjustment;
  }
}

/**
 * Update an existing signal with new evidence
 * Persists the Bayesian update to the database and returns the new probability
 */
export async function updateSignalWithEvidence(
  signalId: number,
  evidence: Evidence,
  dbInstance?: Awaited<ReturnType<typeof db.getDb>>
): Promise<{ newProbability: number; update: BayesianUpdate } | null> {
  try {
    const dbInst = dbInstance || await db.getDb();
    if (!dbInst) {
      logger.error("Database unavailable for Bayesian update");
      return null;
    }

    // Fetch the signal
    const signal = await db.getSignalById(signalId, dbInst);
    if (!signal) {
      logger.warn({ signalId }, "Signal not found for Bayesian update");
      return null;
    }

    const updater = new BayesianSignalUpdater(signal.userId);
    
    // Use current Bayesian probability as prior (or confidence if not set)
    const prior = signal.bayesianProbability ?? signal.confidence;
    
    // Apply update
    const update = updater.updateProbability(prior, evidence, signal.side);

    // Persist to database
    await db.insertBayesianUpdate({
      signalId,
      userId: signal.userId,
      prior: update.prior,
      likelihood: update.likelihood,
      evidenceProb: update.evidenceProb,
      posterior: update.posterior,
      evidenceType: evidence.type,
      evidenceValue: evidence.value,
      evidenceDirection: evidence.direction,
      evidenceMetadata: evidence.metadata ? JSON.stringify(evidence.metadata) : null,
      weight: BayesianSignalUpdater.calculateEvidenceWeight(evidence.timestamp),
    }, dbInst);

    // Update signal's Bayesian probability
    await db.updateSignalBayesianProbability(signalId, update.posterior, dbInst);

    logger.info({
      signalId,
      evidenceType: evidence.type,
      prior: update.prior.toFixed(3),
      posterior: update.posterior.toFixed(3),
      adjustment: update.confidenceAdjustment.toFixed(3),
    }, "Bayesian update applied to signal");

    return { newProbability: update.posterior, update };
  } catch (error) {
    logger.error({ error, signalId, evidenceType: evidence.type }, "Failed to update signal with evidence");
    return null;
  }
}

/**
 * Check if market event should trigger auto-update
 */
export function shouldAutoUpdate(
  priceChange: number,
  volumeRatio: number,
  sentimentChange: number
): boolean {
  return (
    Math.abs(priceChange) > 0.02 ||      // Price move >2%
    volumeRatio > 3 ||                    // Volume spike >3x
    Math.abs(sentimentChange) > 0.3       // Sentiment shift >0.3
  );
}

/**
 * Create evidence from market event
 */
export function createEvidenceFromMarketEvent(
  type: EvidenceType,
  value: number,
  direction: "bullish" | "bearish" | "neutral",
  metadata?: Record<string, unknown>
): Evidence {
  return {
    type,
    value,
    direction,
    timestamp: new Date(),
    metadata,
  };
}

/**
 * Initialize Bayesian probability for a new signal
 * Combines category baseline with fundamental estimate and signal confidence
 */
export function initializeBayesianProbability(
  category: string,
  confidence: number,
  fundamentalEstimate?: number,
  impliedProbability?: number
): number {
  // Start with category baseline
  const prior = BayesianSignalUpdater.calculatePriorProbability(
    category,
    fundamentalEstimate
  );
  
  // If we have both fundamental and market implied probability, 
  // use the confidence to blend between them
  if (fundamentalEstimate !== undefined && impliedProbability !== undefined) {
    // Higher confidence means trust fundamental more than market
    const fundamentalWeight = confidence;
    const marketWeight = 1 - confidence;
    
    const blended = fundamentalEstimate * fundamentalWeight + impliedProbability * marketWeight;
    return Math.max(0, Math.min(1, blended));
  }
  
  // Otherwise blend prior with confidence-weighted implied probability
  if (impliedProbability !== undefined) {
    const impliedWeight = 0.7;
    const priorWeight = 1 - impliedWeight;
    const blended = impliedProbability * impliedWeight + prior * priorWeight;
    return Math.max(0, Math.min(1, blended));
  }
  
  // Fallback to prior if no other information
  return prior;
}

