/**
 * Production alerting module.
 * Sends structured webhook POSTs for critical operational events so that
 * away-from-chat autonomy stays safe even when no human is watching.
 *
 * All public functions are fire-and-forget: they never throw.  A silenced
 * exception or missing webhook URL must never block a trading path.
 *
 * Configure by setting ALERT_WEBHOOK_URL to any service that accepts a JSON
 * HTTP POST (e.g. Slack incoming webhook, PagerDuty Events v2, custom receiver).
 */

import { ENV } from "./env";
import { logger } from "./logger";

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertPayload {
  severity: AlertSeverity;
  event: string;
  userId?: number;
  runId?: string;
  details: Record<string, unknown>;
  timestamp: string;
}

/**
 * Send a structured alert to the configured webhook URL.
 * No-ops silently when ALERT_WEBHOOK_URL is not set.
 */
export async function sendAlert(payload: AlertPayload): Promise<void> {
  if (!ENV.alertWebhookUrl) {
    return;
  }

  try {
    const body = JSON.stringify(payload);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(ENV.alertWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        logger.warn(
          { status: res.status, event: payload.event },
          "[Alerting] Webhook delivery returned non-2xx"
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    // Never propagate — alerting must not break trading paths.
    logger.warn({ err, event: payload.event }, "[Alerting] Webhook delivery failed");
  }
}

/**
 * Alert when an autonomy run for a user ends in error status three or more
 * times in a row.  Pass the most-recent slice of runs (oldest first).
 */
export async function alertIfConsecutiveFailures(
  userId: number,
  recentRuns: Array<{ status: string; runId?: string | null }>,
  consecutiveThreshold = 3
): Promise<void> {
  let consecutiveErrorCount = 0;
  for (let i = recentRuns.length - 1; i >= 0; i--) {
    if (recentRuns[i].status === "error") {
      consecutiveErrorCount++;
    } else {
      break;
    }
  }

  if (consecutiveErrorCount < consecutiveThreshold) {
    return;
  }

  await sendAlert({
    severity: "critical",
    event: "autonomy_consecutive_failures",
    userId,
    runId: recentRuns[recentRuns.length - 1]?.runId ?? undefined,
    details: {
      consecutiveErrors: consecutiveErrorCount,
      threshold: consecutiveThreshold,
    },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Alert when the live equity drops by more than `dropThresholdPct` percent
 * relative to the previous known equity.
 */
export async function alertEquityDrop(
  userId: number,
  previousEquity: number,
  currentEquity: number,
  dropThresholdPct = 10
): Promise<void> {
  if (previousEquity <= 0) {
    return;
  }

  const dropPct = ((previousEquity - currentEquity) / previousEquity) * 100;

  if (dropPct < dropThresholdPct) {
    return;
  }

  await sendAlert({
    severity: "warning",
    event: "equity_significant_drop",
    userId,
    details: {
      previousEquity,
      currentEquity,
      dropPct: Number(dropPct.toFixed(2)),
      threshold: dropThresholdPct,
    },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Alert when a live order is rejected by the exchange.
 */
export async function alertExchangeRejection(
  userId: number,
  runId: string | undefined,
  details: {
    marketId: string;
    side: string;
    quantity: number;
    limitPrice: number;
    error: string;
  }
): Promise<void> {
  await sendAlert({
    severity: "warning",
    event: "exchange_order_rejected",
    userId,
    runId,
    details,
    timestamp: new Date().toISOString(),
  });
}
