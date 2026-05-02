/**
 * Operator alerts via webhook.
 *
 * When ALERTS_WEBHOOK_URL is configured, important safety events emit a
 * small JSON POST so a human can react to drawdowns, kill-switches, and
 * shadow-mode flips without polling the audit log.
 *
 * Compatible with Slack and Discord generic webhook formats — both
 * accept `{ text: "..." }`.  We also include a structured `alert`
 * object so a more sophisticated downstream consumer (PagerDuty,
 * homemade dashboard) can route by severity / kind.
 *
 * Failures are caught and logged but never thrown — alerts are
 * advisory; we don't want a webhook outage to break trading.
 */

import { ENV } from "./env";

export type AlertSeverity = "info" | "warn" | "critical";

export type AlertKind =
  | "kill_switch_activated"
  | "daily_loss_circuit_breaker"
  | "ai_reviewer_unavailable"
  | "shadow_mode_active"
  | "shadow_order_recorded"
  | "kelly_veto"
  | "concentration_breach"
  | "stop_loss_triggered"
  | "manual";

export type AlertPayload = {
  kind: AlertKind;
  severity: AlertSeverity;
  message: string;
  /** Structured details. Will be serialized into the webhook JSON. */
  details?: Record<string, unknown>;
  /** User-scoped identifier for routing — auditLog's triggeredByOpenId. */
  triggeredByOpenId?: string;
};

const SEVERITY_PREFIX: Record<AlertSeverity, string> = {
  info: ":information_source:",
  warn: ":warning:",
  critical: ":rotating_light:",
};

function formatText(alert: AlertPayload): string {
  const prefix = SEVERITY_PREFIX[alert.severity];
  const trigger = alert.triggeredByOpenId ? ` _(${alert.triggeredByOpenId})_` : "";
  return `${prefix} *${alert.kind}*${trigger} — ${alert.message}`;
}

/**
 * Send an alert to the configured webhook (if any).  Always async; never
 * throws.  Returns whether the post was attempted.
 */
export async function sendOperatorAlert(
  alert: AlertPayload,
  options: {
    webhookUrl?: string;
    fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  } = {},
): Promise<{ attempted: boolean; ok: boolean; error?: string }> {
  const url = options.webhookUrl ?? ENV.alertsWebhookUrl;
  if (!url) return { attempted: false, ok: false };

  const fetcher = options.fetcher ?? (globalThis.fetch as typeof fetch | undefined);
  if (!fetcher) {
    return { attempted: false, ok: false, error: "fetch not available" };
  }

  const body = {
    text: formatText(alert),
    alert: {
      kind: alert.kind,
      severity: alert.severity,
      message: alert.message,
      details: alert.details ?? {},
      triggeredByOpenId: alert.triggeredByOpenId,
      timestamp: new Date().toISOString(),
    },
  };

  try {
    const res = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { attempted: true, ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
