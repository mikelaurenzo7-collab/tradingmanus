/**
 * Tests for the runtime exit monitor that wires exitStrategy.ts into the
 * live position-sync loop.
 *
 * The pure exit-math is covered by exit-strategy.test.ts; this file covers
 * the integration: position fetch → market-price lookup → audit-log emission
 * → optional auto-close gating.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOpenKalshiPositions: vi.fn(),
  getDb: vi.fn(),
  logAuditEvent: vi.fn(),
  closeKalshiPosition: vi.fn(),
}));

vi.mock("./db", () => ({
  getOpenKalshiPositions: mocks.getOpenKalshiPositions,
  getDb: mocks.getDb,
  logAuditEvent: mocks.logAuditEvent,
}));

vi.mock("./_core/kalshiExecution", () => ({
  closeKalshiPosition: mocks.closeKalshiPosition,
}));

function withMarketPrice(yesPrice: number, noPrice: number) {
  // Build a fake Drizzle query chain that returns one row.
  const row = { yesPrice, noPrice };
  const limit = vi.fn().mockResolvedValue([row]);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select } as unknown as Record<string, unknown>;
}

function withNoMarketRow() {
  const limit = vi.fn().mockResolvedValue([]);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select } as unknown as Record<string, unknown>;
}

describe("evaluateExitsForOpenPositions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AUTO_CLOSE_ON_EXIT_SIGNAL;
    vi.resetModules();
  });

  it("emits exit_signal audit when current price hits the stop-loss (yes side)", async () => {
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 11, marketId: "KX-A", side: "yes", entryPrice: 0.6, quantity: 10 },
    ]);
    // Stop = 0.6 * (1 - 0.15) = 0.51 with default vol → currentPrice 0.50 triggers
    mocks.getDb.mockResolvedValue(withMarketPrice(0.5, 0.5));
    mocks.logAuditEvent.mockResolvedValue(true);

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7);

    expect(results).toHaveLength(1);
    expect(results[0].decision.shouldExit).toBe(true);
    expect(results[0].decision.reason).toBe("stop_loss");
    expect(results[0].closed).toBe(false); // auto-close not enabled

    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "kalshi_position_exit_signal",
      expect.stringContaining("\"reason\":\"stop_loss\""),
      "local_scheduler",
    );
    expect(mocks.closeKalshiPosition).not.toHaveBeenCalled();
  });

  it("emits exit_signal when current price hits a profit target (yes side)", async () => {
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 22, marketId: "KX-B", side: "yes", entryPrice: 0.4, quantity: 5 },
    ]);
    // Target1 = 0.4 * (1 + 0.15) = 0.46 → currentPrice 0.46 hits it
    mocks.getDb.mockResolvedValue(withMarketPrice(0.46, 0.54));
    mocks.logAuditEvent.mockResolvedValue(true);

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7);

    expect(results[0].decision.shouldExit).toBe(true);
    expect(results[0].decision.reason).toBe("profit_target_1");
    expect(results[0].decision.targetIndex).toBe(1);
  });

  it("does NOT emit exit signal when current price is between stop and target", async () => {
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 33, marketId: "KX-C", side: "yes", entryPrice: 0.5, quantity: 8 },
    ]);
    mocks.getDb.mockResolvedValue(withMarketPrice(0.51, 0.49)); // ~entry, no exit
    mocks.logAuditEvent.mockResolvedValue(true);

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7);

    expect(results[0].decision.shouldExit).toBe(false);
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
    expect(mocks.closeKalshiPosition).not.toHaveBeenCalled();
  });

  it("calls closeKalshiPosition when AUTO_CLOSE_ON_EXIT_SIGNAL=true and exit triggered", async () => {
    process.env.AUTO_CLOSE_ON_EXIT_SIGNAL = "true";
    vi.resetModules();

    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 44, marketId: "KX-D", side: "yes", entryPrice: 0.6, quantity: 10 },
    ]);
    mocks.getDb.mockResolvedValue(withMarketPrice(0.5, 0.5));
    mocks.logAuditEvent.mockResolvedValue(true);
    mocks.closeKalshiPosition.mockResolvedValue({ success: true, mode: "exchange", orderId: "ord-1" });

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7, "manual-trigger");

    expect(mocks.closeKalshiPosition).toHaveBeenCalledTimes(1);
    expect(mocks.closeKalshiPosition).toHaveBeenCalledWith(
      7, // userId
      44, // positionId
      "KX-D", // marketId
      0.5, // currentPrice
      undefined, // privateKey (resolved internally)
      "manual-trigger", // triggeredByOpenId
    );
    expect(results[0].closed).toBe(true);
  });

  it("captures closeError when auto-close fails but never throws", async () => {
    process.env.AUTO_CLOSE_ON_EXIT_SIGNAL = "true";
    vi.resetModules();

    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 55, marketId: "KX-E", side: "yes", entryPrice: 0.6, quantity: 10 },
    ]);
    mocks.getDb.mockResolvedValue(withMarketPrice(0.5, 0.5));
    mocks.logAuditEvent.mockResolvedValue(true);
    mocks.closeKalshiPosition.mockResolvedValue({ success: false, error: "exchange rejected" });

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7);

    expect(results[0].closed).toBe(false);
    expect(results[0].closeError).toBe("exchange rejected");
  });

  it("skips a position with no fresh market-price row", async () => {
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 66, marketId: "KX-MISSING", side: "yes", entryPrice: 0.6, quantity: 10 },
    ]);
    mocks.getDb.mockResolvedValue(withNoMarketRow());

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7);

    expect(results).toHaveLength(0); // skipped, no evaluation
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });

  it("handles 'no' side stops correctly", async () => {
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 77, marketId: "KX-F", side: "no", entryPrice: 0.4, quantity: 10 },
    ]);
    // No-side stop = 0.4 * (1 + 0.15) = 0.46.  noPrice 0.47 > stop → exit.
    mocks.getDb.mockResolvedValue(withMarketPrice(0.53, 0.47));
    mocks.logAuditEvent.mockResolvedValue(true);

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7);

    expect(results[0].decision.shouldExit).toBe(true);
    expect(results[0].decision.reason).toBe("stop_loss");
  });

  it("skips a position with malformed entry price", async () => {
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 88, marketId: "KX-BAD", side: "yes", entryPrice: 0, quantity: 10 },
      { id: 89, marketId: "KX-BAD2", side: "yes", entryPrice: Number.NaN, quantity: 10 },
    ]);
    mocks.getDb.mockResolvedValue(withMarketPrice(0.5, 0.5));

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7);

    expect(results).toHaveLength(0);
  });
});
