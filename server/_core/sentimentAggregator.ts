/**
 * Multi-Source Sentiment Aggregator
 * Combines GDELT, Reddit, Twitter, Expert, and Market Consensus sentiment
 * with configurable weights, momentum detection, and shift alerts.
 */

// ── Source weights (must sum to 1.0) ─────────────────────────────────────────
export const SOURCE_WEIGHT_GDELT = 0.30;
export const SOURCE_WEIGHT_REDDIT = 0.15;
export const SOURCE_WEIGHT_TWITTER = 0.15;
export const SOURCE_WEIGHT_EXPERT = 0.25;
export const SOURCE_WEIGHT_CONSENSUS = 0.15;

// ── Alert / momentum config ───────────────────────────────────────────────────
export const MOMENTUM_ALERT_THRESHOLD = 0.40;
export const MOMENTUM_ALERT_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours
export const MOMENTUM_WINDOWS_H = [12, 24, 48] as const;

// ── Types ─────────────────────────────────────────────────────────────────────
export type SentimentSource = "gdelt" | "reddit" | "twitter" | "expert" | "consensus";

export interface SourceSentiment {
  source: SentimentSource;
  score: number;       // -1 to +1
  confidence: number;  // 0 to 1
  timestamp: Date;
  available: boolean;  // false = source not available (excluded from weighted avg)
}

export interface AggregatedSentiment {
  compositeScore: number;                              // weighted average [-1, 1]
  compositeConfidence: number;                         // weighted average confidence [0, 1]
  sentimentMomentum: number;                           // rate of change normalized [-1, 1]
  momentumWindows: Record<string, number>;             // e.g. {"12h": 0.1, "24h": -0.2, "48h": 0.05}
  isAlertTriggered: boolean;                           // true when momentum > THRESHOLD in 6h
  alertReason?: string;
  sourceBreakdown: Record<SentimentSource, number | null>; // individual scores or null if unavailable
  effectiveWeights: Record<SentimentSource, number>;  // actual weights after renormalization
}

export type SentimentHistoryEntry = {
  timestamp: Date;
  compositeScore: number;
};

// ── Base weights map ──────────────────────────────────────────────────────────
const BASE_WEIGHTS: Record<SentimentSource, number> = {
  gdelt: SOURCE_WEIGHT_GDELT,
  reddit: SOURCE_WEIGHT_REDDIT,
  twitter: SOURCE_WEIGHT_TWITTER,
  expert: SOURCE_WEIGHT_EXPERT,
  consensus: SOURCE_WEIGHT_CONSENSUS,
};

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Aggregate sentiment from multiple sources using weighted average.
 * Unavailable sources are excluded; remaining weights are renormalized to sum to 1.0.
 */
export function aggregateSentiment(sources: SourceSentiment[]): AggregatedSentiment {
  const availableSources = sources.filter((s) => s.available);

  // Build source breakdown
  const allSourceNames: SentimentSource[] = ["gdelt", "reddit", "twitter", "expert", "consensus"];
  const sourceBreakdown: Record<SentimentSource, number | null> = {
    gdelt: null,
    reddit: null,
    twitter: null,
    expert: null,
    consensus: null,
  };
  for (const s of sources) {
    sourceBreakdown[s.source] = s.available ? s.score : null;
  }

  // If no sources available, return zero sentiment
  if (availableSources.length === 0) {
    const zeroWeights: Record<SentimentSource, number> = {
      gdelt: 0,
      reddit: 0,
      twitter: 0,
      expert: 0,
      consensus: 0,
    };
    return {
      compositeScore: 0,
      compositeConfidence: 0,
      sentimentMomentum: 0,
      momentumWindows: {},
      isAlertTriggered: false,
      sourceBreakdown,
      effectiveWeights: zeroWeights,
    };
  }

  // Compute sum of base weights for available sources
  const weightSum = availableSources.reduce((acc, s) => acc + BASE_WEIGHTS[s.source], 0);

  // Renormalize effective weights
  const effectiveWeights: Record<SentimentSource, number> = {
    gdelt: 0,
    reddit: 0,
    twitter: 0,
    expert: 0,
    consensus: 0,
  };
  for (const s of availableSources) {
    effectiveWeights[s.source] = BASE_WEIGHTS[s.source] / weightSum;
  }

  // Compute weighted composite score and confidence
  let compositeScore = 0;
  let compositeConfidence = 0;
  for (const s of availableSources) {
    compositeScore += s.score * effectiveWeights[s.source];
    compositeConfidence += s.confidence * effectiveWeights[s.source];
  }

  return {
    compositeScore,
    compositeConfidence,
    sentimentMomentum: 0,
    momentumWindows: {},
    isAlertTriggered: false,
    sourceBreakdown,
    effectiveWeights,
  };
}

/**
 * Calculate sentiment momentum (rate of change per hour) over a given window.
 * Returns value clamped to [-1, 1].
 */
export function calculateSentimentMomentum(
  history: SentimentHistoryEntry[],
  windowHours: number,
  now: Date = new Date(),
): number {
  const windowMs = windowHours * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() - windowMs);

  const inWindow = history.filter((e) => e.timestamp >= cutoff);

  if (inWindow.length < 2) return 0;

  const oldScore = inWindow[0].compositeScore;
  const newScore = inWindow[inWindow.length - 1].compositeScore;

  const momentumRaw = (newScore - oldScore) / windowHours;

  return Math.max(-1, Math.min(1, momentumRaw));
}

/**
 * Detect whether sentiment has shifted significantly (>0.4) within the past 6 hours.
 */
export function detectSentimentAlert(
  current: AggregatedSentiment,
  history: SentimentHistoryEntry[],
  now: Date = new Date(),
): { isAlert: boolean; reason?: string } {
  const cutoff = new Date(now.getTime() - MOMENTUM_ALERT_WINDOW_MS);
  const inWindow = history.filter((e) => e.timestamp >= cutoff);

  if (inWindow.length === 0) {
    return { isAlert: false };
  }

  const oldest = inWindow[0].compositeScore;
  const newest = current.compositeScore;
  const shift = Math.abs(newest - oldest);

  if (shift > MOMENTUM_ALERT_THRESHOLD) {
    return {
      isAlert: true,
      reason: `Sentiment shifted ${shift.toFixed(2)} in 6h`,
    };
  }

  return { isAlert: false };
}
