/**
 * Tests for the runtime exit monitor that wires exitStrategy.ts into the
 * live position-sync loop.
 *
 * The pure exit-math is covered by exit-strategy.test.ts; this file covers
 * the integration:
 *   - position fetch → market-price lookup → audit-log emission
 *   - persisted state resume + ratcheting trailing stop
 *   - time-decay stop tightening near resolution
 *   - optional auto-close gating
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

/**
 * Build a fake Drizzle DB that:
 *   - returns the given market row from the first .select(...).limit() chain
 *   - swallows update() calls (and records what was set, when callers care)
 *
 * We hand back a brand-new builder from each `.select()` so the call counts
 * line up with the production code (one read per position).
 */
function fakeDb(opts: {
  marketRow?: { yesPrice: number | null; noPrice: number | null; resolutionDate: Date | null } | null;
  onUpdate?: (positionId: number, exitState: unknown) => void;
}) {
  const marketRow = opts.marketRow === undefined ? null : opts.marketRow;
  const select = vi.fn(() => {
    const limit = vi.fn().mockResolvedValue(marketRow ? [marketRow] : []);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    return { from };
  });
  const update = vi.fn(() => {
    let pendingState: unknown;
    const where = vi.fn(async () => {
      // We don't have the positionId in the where clause from this mock —
      // callers can pass `onUpdate` and we'll just hand them the state.
      if (opts.onUpdate) opts.onUpdate(-1, pendingState);
      return [];
    });
    const set = vi.fn((values: Record<string, unknown>) => {
      pendingState = values.exitState;
      return { where };
    });
    return { set };
  });
  return { select, update } as unknown as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AUTO_CLOSE_ON_EXIT_SIGNAL;
  vi.resetModules();
});

describe("evaluateExitsForOpenPositions — basic exit detection", () => {
  it("emits exit_signal audit when current price hits the stop-loss (yes side)", async () => {
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 11, marketId: "KX-A", side: "yes", entryPrice: 0.6, quantity: 10, exitState: null },
    ]);
    // Stop = 0.6 * (1 - 0.15) = 0.51 → currentPrice 0.50 triggers
    mocks.getDb.mockResolvedValue(
      fakeDb({ marketRow: { yesPrice: 0.5, noPrice: 0.5, resolutionDate: null } }),
    );
    mocks.logAuditEvent.mockResolvedValue(true);

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7);

    expect(results).toHaveLength(1);
    expect(results[0].decision.shouldExit).toBe(true);
    expect(results[0].decision.reason).toBe("stop_loss");
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "kalshi_position_exit_signal",
      expect.stringContaining('"reason":"stop_loss"'),
      "local_scheduler",
    );
    expect(mocks.closeKalshiPosition).not.toHaveBeenCalled();
  });

  it("does NOT emit exit signal when current price is between stop and target", async () => {
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 33, marketId: "KX-C", side: "yes", entryPrice: 0.5, quantity: 8, exitState: null },
    ]);
    mocks.getDb.mockResolvedValue(
      fakeDb({ marketRow: { yesPrice: 0.51, noPrice: 0.49, resolutionDate: null } }),
    );

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7);

    expect(results[0].decision.shouldExit).toBe(false);
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });

  it("calls closeKalshiPosition when AUTO_CLOSE_ON_EXIT_SIGNAL=true and exit triggered", async () => {
    process.env.AUTO_CLOSE_ON_EXIT_SIGNAL = "true";
    vi.resetModules();

    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 44, marketId: "KX-D", side: "yes", entryPrice: 0.6, quantity: 10, exitState: null },
    ]);
    mocks.getDb.mockResolvedValue(
      fakeDb({ marketRow: { yesPrice: 0.5, noPrice: 0.5, resolutionDate: null } }),
    );
    mocks.logAuditEvent.mockResolvedValue(true);
    mocks.closeKalshiPosition.mockResolvedValue({ success: true, mode: "exchange", orderId: "ord-1" });

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7, "manual-trigger");

    expect(mocks.closeKalshiPosition).toHaveBeenCalledTimes(1);
    expect(mocks.closeKalshiPosition).toHaveBeenCalledWith(7, 44, "KX-D", 0.5, undefined, "manual-trigger");
    expect(results[0].closed).toBe(true);
  });

  it("captures closeError when auto-close fails but never throws", async () => {
    process.env.AUTO_CLOSE_ON_EXIT_SIGNAL = "true";
    vi.resetModules();

    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 55, marketId: "KX-E", side: "yes", entryPrice: 0.6, quantity: 10, exitState: null },
    ]);
    mocks.getDb.mockResolvedValue(
      fakeDb({ marketRow: { yesPrice: 0.5, noPrice: 0.5, resolutionDate: null } }),
    );
    mocks.logAuditEvent.mockResolvedValue(true);
    mocks.closeKalshiPosition.mockResolvedValue({ success: false, error: "exchange rejected" });

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7);

    expect(results[0].closed).toBe(false);
    expect(results[0].closeError).toBe("exchange rejected");
  });

  it("skips a position with no fresh market-price row", async () => {
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 66, marketId: "KX-MISSING", side: "yes", entryPrice: 0.6, quantity: 10, exitState: null },
    ]);
    mocks.getDb.mockResolvedValue(fakeDb({ marketRow: null }));

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7);

    expect(results).toHaveLength(0);
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });

  it("handles 'no' side stops correctly", async () => {
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 77, marketId: "KX-F", side: "no", entryPrice: 0.4, quantity: 10, exitState: null },
    ]);
    mocks.getDb.mockResolvedValue(
      fakeDb({ marketRow: { yesPrice: 0.53, noPrice: 0.47, resolutionDate: null } }),
    );
    mocks.logAuditEvent.mockResolvedValue(true);

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7);

    expect(results[0].decision.shouldExit).toBe(true);
    expect(results[0].decision.reason).toBe("stop_loss");
  });

  it("skips a position with malformed entry price", async () => {
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 88, marketId: "KX-BAD", side: "yes", entryPrice: 0, quantity: 10, exitState: null },
      { id: 89, marketId: "KX-BAD2", side: "yes", entryPrice: Number.NaN, quantity: 10, exitState: null },
    ]);
    mocks.getDb.mockResolvedValue(
      fakeDb({ marketRow: { yesPrice: 0.5, noPrice: 0.5, resolutionDate: null } }),
    );

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7);

    expect(results).toHaveLength(0);
  });
});

describe("evaluateExitsForOpenPositions — stateful trailing stop", () => {
  it("ratchets the trailing stop upward when price makes a new high (yes side)", async () => {
    let capturedState: unknown;
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 100, marketId: "KX-MOM", side: "yes", entryPrice: 0.5, quantity: 10, exitState: null },
    ]);
    mocks.getDb.mockResolvedValue(
      fakeDb({
        marketRow: { yesPrice: 0.7, noPrice: 0.3, resolutionDate: null },
        onUpdate: (_id, state) => {
          capturedState = state;
        },
      }),
    );
    mocks.logAuditEvent.mockResolvedValue(true);

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7);

    expect(results[0].trailingStopRaised).toBe(true);
    // Persisted state should have HWM = current price (we just made a new high)
    expect((capturedState as { highWaterMark: number }).highWaterMark).toBeCloseTo(0.7);
    // Trailing stop should have moved up from initial (which was the stop level, ~0.425)
    expect((capturedState as { trailingStop: number }).trailingStop).toBeGreaterThan(0.425);
  });

  it("does NOT lower the trailing stop when price retraces (yes side)", async () => {
    let capturedState: unknown;
    // Position with persisted state from a previous tick at a higher price
    const previousState = {
      stopLevel: 0.425,
      trailingStop: 0.65,    // raised from a previous high
      highWaterMark: 0.68,
      profitTargets: [0.575, 0.65, 0.725],
      hitTargets: [],
    };
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 101, marketId: "KX-RETRACE", side: "yes", entryPrice: 0.5, quantity: 10, exitState: previousState },
    ]);
    mocks.getDb.mockResolvedValue(
      fakeDb({
        marketRow: { yesPrice: 0.55, noPrice: 0.45, resolutionDate: null }, // retraced from 0.68
        onUpdate: (_id, state) => {
          capturedState = state;
        },
      }),
    );
    mocks.logAuditEvent.mockResolvedValue(true);

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7);

    // HWM and trailing stop must not regress
    expect((capturedState as { highWaterMark: number }).highWaterMark).toBe(0.68);
    expect((capturedState as { trailingStop: number }).trailingStop).toBe(0.65);
    expect(results[0].trailingStopRaised).toBe(false);
  });

  it("triggers trailing_stop exit when price falls below the ratcheted trailing level", async () => {
    // Position whose trailing stop has been raised to 0.62 from a prior high
    const previousState = {
      stopLevel: 0.425,
      trailingStop: 0.62,
      highWaterMark: 0.7,
      profitTargets: [0.575, 0.65, 0.725],
      hitTargets: [],
    };
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 102, marketId: "KX-TS", side: "yes", entryPrice: 0.5, quantity: 10, exitState: previousState },
    ]);
    mocks.getDb.mockResolvedValue(
      fakeDb({ marketRow: { yesPrice: 0.61, noPrice: 0.39, resolutionDate: null } }),
    );
    mocks.logAuditEvent.mockResolvedValue(true);

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7);

    expect(results[0].decision.shouldExit).toBe(true);
    expect(results[0].decision.reason).toBe("trailing_stop");
  });
});

describe("evaluateExitsForOpenPositions — time decay", () => {
  it("tightens the stop level when within 24h of resolution (yes side)", async () => {
    let capturedState: unknown;
    const resolutionIn6h = new Date(Date.now() + 6 * 60 * 60 * 1000);
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 200, marketId: "KX-NEAR", side: "yes", entryPrice: 0.5, quantity: 10, exitState: null },
    ]);
    mocks.getDb.mockResolvedValue(
      fakeDb({
        marketRow: { yesPrice: 0.5, noPrice: 0.5, resolutionDate: resolutionIn6h },
        onUpdate: (_id, state) => {
          capturedState = state;
        },
      }),
    );
    mocks.logAuditEvent.mockResolvedValue(true);

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    await evaluateExitsForOpenPositions(7);

    // Without decay, initial stop would be 0.5 * (1 - 0.15) = 0.425.
    // Within 6h of resolution, applyTimeDecayToStops tightens it.
    const stopAfter = (capturedState as { stopLevel: number }).stopLevel;
    expect(stopAfter).toBeGreaterThan(0.425);
    expect(stopAfter).toBeLessThan(0.5); // still below entry
  });

  it("does NOT tighten the stop when resolution is more than 24h away", async () => {
    let capturedState: unknown;
    const resolutionIn7d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 201, marketId: "KX-FAR", side: "yes", entryPrice: 0.5, quantity: 10, exitState: null },
    ]);
    mocks.getDb.mockResolvedValue(
      fakeDb({
        marketRow: { yesPrice: 0.5, noPrice: 0.5, resolutionDate: resolutionIn7d },
        onUpdate: (_id, state) => {
          capturedState = state;
        },
      }),
    );

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    await evaluateExitsForOpenPositions(7);

    expect((capturedState as { stopLevel: number }).stopLevel).toBeCloseTo(0.425, 3);
  });
});

describe("evaluateExitsForOpenPositions — resolved market guard", () => {
  it("skips evaluation entirely when resolutionDate is in the past", async () => {
    const resolvedYesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 400, marketId: "KX-RESOLVED", side: "yes", entryPrice: 0.6, quantity: 10, exitState: null },
    ]);
    mocks.getDb.mockResolvedValue(
      fakeDb({ marketRow: { yesPrice: 0.5, noPrice: 0.5, resolutionDate: resolvedYesterday } }),
    );

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7);

    // Position is skipped entirely — exchange will settle it
    expect(results).toHaveLength(0);
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });

  it("still evaluates when resolutionDate is in the future", async () => {
    const resolutionTomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    mocks.getOpenKalshiPositions.mockResolvedValue([
      { id: 401, marketId: "KX-ACTIVE", side: "yes", entryPrice: 0.6, quantity: 10, exitState: null },
    ]);
    // Price at stop-loss level to trigger an exit
    mocks.getDb.mockResolvedValue(
      fakeDb({ marketRow: { yesPrice: 0.5, noPrice: 0.5, resolutionDate: resolutionTomorrow } }),
    );
    mocks.logAuditEvent.mockResolvedValue(true);

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    const results = await evaluateExitsForOpenPositions(7);

    expect(results).toHaveLength(1);
    expect(results[0].decision.shouldExit).toBe(true);
  });
});

describe("evaluateExitsForOpenPositions — persisted state parsing", () => {
  it("re-initialises state when the persisted blob is malformed", async () => {
    let capturedState: unknown;
    mocks.getOpenKalshiPositions.mockResolvedValue([
      // exitState is garbage
      { id: 300, marketId: "KX-BAD-STATE", side: "yes", entryPrice: 0.5, quantity: 10, exitState: { foo: "bar" } },
    ]);
    mocks.getDb.mockResolvedValue(
      fakeDb({
        marketRow: { yesPrice: 0.5, noPrice: 0.5, resolutionDate: null },
        onUpdate: (_id, state) => {
          capturedState = state;
        },
      }),
    );

    const { evaluateExitsForOpenPositions } = await import("./_core/exitMonitor");
    await evaluateExitsForOpenPositions(7);

    // Fresh init: stopLevel = entry * (1 - 0.15) = 0.425
    expect((capturedState as { stopLevel: number }).stopLevel).toBeCloseTo(0.425, 3);
    expect((capturedState as { highWaterMark: number }).highWaterMark).toBeCloseTo(0.5, 3);
  });
});
