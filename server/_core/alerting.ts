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

/**
 * Alert when cumulative capital drawdown from the starting balance
 * approaches or exceeds the configured daily-loss limit.  This fires
 * proactively — before the hard daily-loss block in kalshiRisk.ts — so
 * the operator sees the warning while there is still time to intervene.
 *
 * @param startingBalance - Balance at the start of the session / initial deposit.
 * @param currentBalance  - Current live account balance.
 * @param dailyLossLimit  - Hard daily-loss cap in dollars (e.g. $10 for a $100 account).
 * @param warningThresholdPct - Alert when drawdown exceeds this fraction of the
 *   daily-loss limit (default 0.8 = 80 %).
 */
export async function alertDrawdownApproaching(
  userId: number,
  startingBalance: number,
  currentBalance: number,
  dailyLossLimit: number,
  warningThresholdPct = 0.8
): Promise<void> {
  if (startingBalance <= 0 || dailyLossLimit <= 0) {
    return;
  }

  const lossAmount = startingBalance - currentBalance;
  if (lossAmount <= 0) {
    return;
  }

  const warningAmount = dailyLossLimit * warningThresholdPct;
  if (lossAmount < warningAmount) {
    return;
  }

  const severity: AlertSeverity =
    lossAmount >= dailyLossLimit ? "critical" : "warning";

  await sendAlert({
    severity,
    event: "drawdown_approaching_limit",
    userId,
    details: {
      startingBalance,
      currentBalance,
      lossAmount: Math.round(lossAmount * 100) / 100,
      dailyLossLimit,
      warningThresholdPct,
      pctOfLimit: Math.round((lossAmount / dailyLossLimit) * 1000) / 10,
    },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Alert when the AI reviewer (Claude) fails during a scheduled autonomy
 * run.  Without this alert, Claude timeouts/errors are swallowed and the
 * run silently reports `generated_only` with 0 candidates, leaving the
 * operator with no signal that the AI pipeline is broken.
 */
export async function alertAiReviewerFailure(
  userId: number,
  runId: string | undefined,
  details: {
    anthropicCalls: number;
    anthropicFailures: number;
    signalsApproved: number;
    signalsCandidate: number;
  }
): Promise<void> {
  await sendAlert({
    severity: "warning",
    event: "ai_reviewer_failure",
    userId,
    runId,
    details,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Alert when the kill switch fails to close one or more positions on the
 * exchange.  The operator must manually verify and resolve these positions;
 * without an alert they may remain open and continue accumulating risk.
 */
export async function alertKillSwitchPartialFailure(
  userId: number,
  details: {
    totalPositions: number;
    closedPositions: number;
    failedPositions: number;
    failedMarketIds: string[];
  }
): Promise<void> {
  await sendAlert({
    severity: "critical",
    event: "kill_switch_partial_failure",
    userId,
    details,
    timestamp: new Date().toISOString(),
  });
}
