import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/env", () => ({
  ENV: {
    alertWebhookUrl: "https://example.test/webhook",
  },
}));

vi.mock("./_core/logger", () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}));

import { ENV } from "./_core/env";
import {
  alertAiReviewerFailure,
  alertDrawdownApproaching,
  alertEquityDrop,
  alertExchangeRejection,
  alertIfConsecutiveFailures,
  sendAlert,
} from "./_core/alerting";

describe("alerting", () => {
  const fetchMock = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    (ENV as { alertWebhookUrl: string | undefined }).alertWebhookUrl = "https://example.test/webhook";
  });

  afterEach(() => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
  });

  describe("sendAlert", () => {
    it("no-ops when ALERT_WEBHOOK_URL is not configured", async () => {
      (ENV as { alertWebhookUrl: string | undefined }).alertWebhookUrl = undefined;
      await sendAlert({
        severity: "critical",
        event: "test",
        details: {},
        timestamp: new Date().toISOString(),
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("POSTs JSON to the configured webhook", async () => {
      const payload = {
        severity: "warning" as const,
        event: "boom",
        details: { foo: 1 },
        timestamp: "2024-01-01T00:00:00Z",
      };
      await sendAlert(payload);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://example.test/webhook");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(init.body as string)).toEqual(payload);
    });

    it("never throws when fetch rejects (alerting must not break trading)", async () => {
      fetchMock.mockRejectedValueOnce(new Error("network down"));
      await expect(
        sendAlert({
          severity: "critical",
          event: "x",
          details: {},
          timestamp: "t",
        })
      ).resolves.toBeUndefined();
    });

    it("never throws when webhook returns non-2xx", async () => {
      fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
      await expect(
        sendAlert({
          severity: "info",
          event: "x",
          details: {},
          timestamp: "t",
        })
      ).resolves.toBeUndefined();
    });
  });

  describe("alertIfConsecutiveFailures", () => {
    it("does not alert below the threshold", async () => {
      await alertIfConsecutiveFailures(7, [
        { status: "error" },
        { status: "error" },
      ]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("alerts when trailing errors meet the threshold", async () => {
      await alertIfConsecutiveFailures(7, [
        { status: "executed" },
        { status: "error", runId: "r1" },
        { status: "error", runId: "r2" },
        { status: "error", runId: "r3" },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.event).toBe("autonomy_consecutive_failures");
      expect(body.userId).toBe(7);
      expect(body.runId).toBe("r3");
      expect(body.details.consecutiveErrors).toBe(3);
    });

    it("only counts trailing errors — a non-error breaks the streak", async () => {
      await alertIfConsecutiveFailures(7, [
        { status: "error" },
        { status: "error" },
        { status: "executed" },
        { status: "error" },
        { status: "error" },
      ]);
      // Only 2 trailing errors → below default threshold of 3.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("respects a custom threshold", async () => {
      await alertIfConsecutiveFailures(
        7,
        [{ status: "error" }, { status: "error" }],
        2
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("alertEquityDrop", () => {
    it("ignores when previousEquity is non-positive (no baseline)", async () => {
      await alertEquityDrop(7, 0, 50);
      await alertEquityDrop(7, -1, 50);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("ignores when drop is below threshold", async () => {
      await alertEquityDrop(7, 100, 95, 10); // 5% drop, threshold 10
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("alerts when drop meets or exceeds threshold", async () => {
      await alertEquityDrop(7, 100, 80, 10); // 20% drop
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.event).toBe("equity_significant_drop");
      expect(body.details.dropPct).toBeCloseTo(20, 5);
      expect(body.details.previousEquity).toBe(100);
      expect(body.details.currentEquity).toBe(80);
    });
  });

  describe("alertExchangeRejection", () => {
    it("forwards rejection details with severity warning", async () => {
      await alertExchangeRejection(7, "run-1", {
        marketId: "MKT",
        side: "yes",
        quantity: 5,
        limitPrice: 0.42,
        error: "insufficient funds",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.event).toBe("exchange_order_rejected");
      expect(body.severity).toBe("warning");
      expect(body.details.error).toBe("insufficient funds");
    });
  });

  describe("alertAiReviewerFailure", () => {
    it("forwards reviewer telemetry as a warning alert", async () => {
      await alertAiReviewerFailure(7, "run-1", {
        anthropicCalls: 3,
        anthropicFailures: 3,
        signalsApproved: 0,
        signalsCandidate: 5,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.event).toBe("ai_reviewer_failure");
      expect(body.severity).toBe("warning");
      expect(body.details.anthropicFailures).toBe(3);
    });
  });

  describe("alertDrawdownApproaching", () => {
    it("does not alert when there is no loss", async () => {
      await alertDrawdownApproaching(7, 100, 100, 10);
      await alertDrawdownApproaching(7, 100, 110, 10); // gain — no alert
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not alert when loss is below the warning threshold", async () => {
      // 70% of the $10 daily limit = $7 loss; warning threshold is 80% ($8)
      await alertDrawdownApproaching(7, 100, 93, 10, 0.8); // $7 loss < $8 warning
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends a warning alert when loss meets the warning threshold", async () => {
      // $8 loss = exactly 80% of the $10 daily limit
      await alertDrawdownApproaching(7, 100, 92, 10, 0.8);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.event).toBe("drawdown_approaching_limit");
      expect(body.severity).toBe("warning");
      expect(body.userId).toBe(7);
      expect(body.details.lossAmount).toBe(8);
      expect(body.details.dailyLossLimit).toBe(10);
    });

    it("sends a critical alert when loss meets or exceeds the daily limit", async () => {
      // $10 loss = 100% of the $10 daily limit
      await alertDrawdownApproaching(7, 100, 90, 10, 0.8);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.severity).toBe("critical");
    });

    it("no-ops when startingBalance or dailyLossLimit are non-positive", async () => {
      await alertDrawdownApproaching(7, 0, 90, 10);
      await alertDrawdownApproaching(7, 100, 90, 0);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
