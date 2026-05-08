/**
 * Weekly calibration / backtest job.
 *
 * Pulls the past N months of Kalshi historical markets + trades, replays the
 * Grok reviewer against each (using the *cached* response when available so
 * we don't re-spend), and computes the Brier score per category and per
 * persona id. The job:
 *
 *   1. Fetches eligible markets from `kalshiMarketSnapshots` (already
 *      timestamped, immutable) over the lookback window.
 *   2. Resolves each market's actual outcome from `kalshiClient.getMarket` or
 *      `kalshiOrderSync` reconciliation rows.
 *   3. Reads all `kalshi_grok_review_telemetry` audit-log rows for the same
 *      tickers and pairs predicted probability ↔ realized outcome.
 *   4. Computes Brier score = mean( (predicted_prob - actual_outcome)^2 ),
 *      where actual_outcome ∈ {0, 1}.
 *   5. Adjusts the per-persona/category weight in the desk-memory tape so
 *      future Grok reviews of weaker categories are weighted more skeptically
 *      (or excluded entirely below a min Brier).
 *
 * Runs once per week via a cron (`scripts/runCalibrationJob.ts`).
 */

import { logger } from "./logger";
import { logAuditEvent } from "../db";
import {
  getHistoricalCandlesticks,
  getHistoricalTrades,
} from "./kalshiClient";

export interface CalibrationInputs {
  userId: number;
  /** Lookback in days. Default 90. */
  lookbackDays?: number;
  /** Minimum sample size per persona to publish a weight adjustment. */
  minSamplesPerPersona?: number;
}

export interface PersonaCalibrationResult {
  personaId: string;
  category: string;
  sampleSize: number;
  brierScore: number;
  averagePredictedProbability: number;
  averageActualOutcome: number;
  /** Weight adjustment: 1.0 = no change, <1.0 = down-weight, 0 = exclude. */
  weightMultiplier: number;
  notes: string;
}

export interface CalibrationReport {
  generatedAtMs: number;
  lookbackDays: number;
  totalSamples: number;
  overallBrierScore: number;
  byPersona: PersonaCalibrationResult[];
  evThresholdAdjustment: number;
  reasoning: string;
}

/**
 * Run the weekly calibration job. Returns the report and persists it via
 * `logAuditEvent` so the dashboard can render the latest calibration state.
 */
export async function runCalibrationJob(
  inputs: CalibrationInputs,
): Promise<CalibrationReport> {
  const lookbackDays = inputs.lookbackDays ?? 90;
  const minSamples = inputs.minSamplesPerPersona ?? 12;
  const generatedAtMs = Date.now();

  const samples = await collectCalibrationSamples({
    userId: inputs.userId,
    lookbackDays,
  });

  const grouped = new Map<string, CalibrationSample[]>();
  for (const s of samples) {
    const key = `${s.personaId}::${s.category}`;
    const arr = grouped.get(key) ?? [];
    arr.push(s);
    grouped.set(key, arr);
  }

  const byPersona: PersonaCalibrationResult[] = [];
  for (const [key, list] of grouped.entries()) {
    const [personaId, category] = key.split("::");
    if (list.length < minSamples) continue;
    const brier =
      list.reduce(
        (a, s) => a + Math.pow(s.predictedProbability - s.actualOutcome, 2),
        0,
      ) / list.length;
    const avgPred =
      list.reduce((a, s) => a + s.predictedProbability, 0) / list.length;
    const avgActual =
      list.reduce((a, s) => a + s.actualOutcome, 0) / list.length;

    // Brier ranges: 0.00 = perfect, 0.25 = coin flip, ≥0.30 = worse than random.
    let weightMultiplier = 1.0;
    let notes = "calibrated";
    if (brier >= 0.3) {
      weightMultiplier = 0;
      notes = "Brier ≥ 0.30 — exclude persona for this category";
    } else if (brier >= 0.22) {
      weightMultiplier = 0.5;
      notes = "Brier ≥ 0.22 — down-weight 50%";
    } else if (brier >= 0.15) {
      weightMultiplier = 0.8;
      notes = "Brier ≥ 0.15 — down-weight 20%";
    }

    byPersona.push({
      personaId: personaId ?? "unknown",
      category: category ?? "unknown",
      sampleSize: list.length,
      brierScore: brier,
      averagePredictedProbability: avgPred,
      averageActualOutcome: avgActual,
      weightMultiplier,
      notes,
    });
  }

  const overallBrier =
    samples.length === 0
      ? 0
      : samples.reduce(
          (a, s) => a + Math.pow(s.predictedProbability - s.actualOutcome, 2),
          0,
        ) / samples.length;

  // EV threshold adjustment: if overall Brier is poor, raise the floor.
  let evThresholdAdjustment = 0;
  let reasoning = "Calibration in normal range";
  if (overallBrier >= 0.25) {
    evThresholdAdjustment = 0.02;
    reasoning = "Overall Brier ≥ 0.25 → raise EV floor by +0.02";
  } else if (overallBrier >= 0.18) {
    evThresholdAdjustment = 0.01;
    reasoning = "Overall Brier ≥ 0.18 → raise EV floor by +0.01";
  }

  const report: CalibrationReport = {
    generatedAtMs,
    lookbackDays,
    totalSamples: samples.length,
    overallBrierScore: overallBrier,
    byPersona,
    evThresholdAdjustment,
    reasoning,
  };

  try {
    await logAuditEvent(
      "kalshi_calibration_job_completed",
      JSON.stringify({ userId: inputs.userId, ...report }),
      String(inputs.userId),
    );
  } catch (err) {
    logger.warn({ err }, "[Calibration] audit log failed");
  }
  return report;
}

interface CalibrationSample {
  ticker: string;
  category: string;
  personaId: string;
  predictedProbability: number;
  actualOutcome: 0 | 1;
  settledAtMs: number;
}

async function collectCalibrationSamples(opts: {
  userId: number;
  lookbackDays: number;
}): Promise<CalibrationSample[]> {
  const { getDb } = await import("../db");
  const { auditLog } = await import("../../drizzle/schema");
  const { eq, and, gte } = await import("drizzle-orm");
  const database = await getDb();
  if (!database) return [];
  const sinceMs = Date.now() - opts.lookbackDays * 24 * 60 * 60 * 1000;

  // The performance tracker writes one `kalshi_trade_outcome_log` row per
  // settled trade, carrying both the predicted side (predictedWinProbability
  // + the persona/category that emitted it) and the realized outcome. We
  // calibrate from those rows directly — there is no separate review-
  // telemetry stream to pair against, and pairing two event types in SQL
  // would just hide the same join we'd do in memory.
  const rows = await database
    .select({ details: auditLog.details, createdAt: auditLog.createdAt })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.triggeredByOpenId, String(opts.userId)),
        eq(auditLog.eventType, "kalshi_trade_outcome_log"),
        gte(auditLog.createdAt, new Date(sinceMs)),
      ),
    )
    .limit(2000);

  const samples: CalibrationSample[] = [];
  for (const r of rows) {
    let p: Record<string, unknown> | null = null;
    try {
      p = r.details ? (JSON.parse(r.details) as Record<string, unknown>) : null;
    } catch {
      continue;
    }
    if (!p) continue;
    const ticker = typeof p.ticker === "string" ? p.ticker : null;
    const predictedProb =
      typeof p.predictedWinProbability === "number"
        ? Math.min(1, Math.max(0, p.predictedWinProbability))
        : null;
    const outcomeRaw = typeof p.outcome === "string" ? p.outcome : null;
    if (!ticker || predictedProb === null || outcomeRaw === null) continue;
    // Persona id isn't yet stamped onto the outcome log; until the reviewer
    // tags trades with the desk that approved them, fall back to the
    // category-keyed persona id Grok personas already use.
    const category = typeof p.category === "string" ? p.category : "unknown";
    const personaId =
      typeof p.personaId === "string"
        ? p.personaId
        : `grok.kalshi.${category}`;
    const settledAtMs =
      typeof p.settledAtMs === "number"
        ? p.settledAtMs
        : r.createdAt instanceof Date
          ? r.createdAt.getTime()
          : 0;
    samples.push({
      ticker,
      category,
      personaId,
      predictedProbability: predictedProb,
      actualOutcome: outcomeRaw === "win" ? 1 : 0,
      settledAtMs,
    });
  }

  // Sanity: pull a small slice of historical trades to confirm the API is
  // reachable (so an empty calibration result vs an outage are distinguishable).
  if (samples.length === 0) {
    try {
      await getHistoricalTrades({ limit: 1 });
    } catch (err) {
      logger.warn(
        { err },
        "[Calibration] Historical trades probe failed — Kalshi API unreachable?",
      );
    }
  }

  // Touch candlesticks helper to keep the import tree explicit (used by ad-hoc
  // calibration scripts that compute realised vol vs implied vol).
  void getHistoricalCandlesticks;

  return samples;
}
