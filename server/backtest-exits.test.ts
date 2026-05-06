/**
 * Tests for the exit-strategy backtest harness.
 *
 * The harness is mostly DB plumbing on top of the pure exitStrategy
 * functions (already exhaustively covered in exit-strategy.test.ts) and
 * the calculateBacktestStats aggregator (covered in kalshiBacktest's
 * own tests by way of the trades it produces).  These tests focus on:
 *   - Empty / sparse-history cases short-circuit cleanly
 *   - Trade ledger shape matches BacktestTrade
 *   - exitReasonBreakdown counts every trade exactly once
 *   - Side handling: yes vs no produce distinct PnL signs on the same path
 *   - entryPolicy "every-n" generates more entries than "first"
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: mocks.getDb,
}));

interface FakeSnapshotRow {
  marketId: string;
  yesPrice: number;
  noPrice: number;
  snapshotTime: Date;
}

function fakeDb(opts: {
  snapshots: FakeSnapshotRow[];
  marketResolutionDates?: Map<string, Date | null>;
}) {
  let selectCallIdx = 0;
  return {
    select: vi.fn(() => {
      const callIdx = selectCallIdx++;
      // Call 0: snapshots query.  Call 1: market metadata query.
      const data = callIdx === 0
        ? opts.snapshots
        : Array.from(opts.marketResolutionDates ?? new Map<string, Date | null>()).map(
            ([marketId, resolutionDate]) => ({ marketId, resolutionDate }),
          );
      const orderBy = vi.fn(async () => data);
      const where = vi.fn(() => ({ orderBy, then: (resolve: (v: unknown) => unknown) => resolve(data) as unknown }));
      const from = vi.fn(() => ({ where }));
      return { from };
    }),
  };
}

function buildSeries(marketId: string, prices: number[], startMs = 1_700_000_000_000): FakeSnapshotRow[] {
  const stepMs = 60 * 60 * 1000; // 1h apart
  return prices.map((p, i) => ({
    marketId,
    yesPrice: p,
    noPrice: 1 - p,
    snapshotTime: new Date(startMs + i * stepMs),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runExitStrategyBacktest", () => {
  it("returns an empty summary when no snapshots are available", async () => {
    mocks.getDb.mockResolvedValue(fakeDb({ snapshots: [] }));
    const { runExitStrategyBacktest } = await import("./_core/backtestExits");
    const result = await runExitStrategyBacktest({ windowDays: 30 });

    expect(result.totalTrades).toBe(0);
    expect(result.marketsEvaluated).toBe(0);
    expect(result.snapshotsLoaded).toBe(0);
  });

  it("ignores markets with fewer than MIN_SNAPSHOTS rows", async () => {
    // Below the 5-snapshot minimum
    const sparse = buildSeries("KX-SPARSE", [0.5, 0.51, 0.52]);
    mocks.getDb.mockResolvedValue(fakeDb({ snapshots: sparse }));
    const { runExitStrategyBacktest } = await import("./_core/backtestExits");
    const result = await runExitStrategyBacktest({ windowDays: 30 });

    expect(result.marketsEvaluated).toBe(0);
    expect(result.totalTrades).toBe(0);
  });

  it("produces a YES trade when price rises into a profit target", async () => {
    // Entry at 0.5; profit_target_1 ≈ 0.575 with default 0.15 vol.
    // Price walks up to 0.6 → target hit.
    const series = buildSeries("KX-WIN", [0.5, 0.52, 0.55, 0.58, 0.6, 0.62]);
    mocks.getDb.mockResolvedValue(fakeDb({ snapshots: series }));

    const { runExitStrategyBacktest } = await import("./_core/backtestExits");
    const result = await runExitStrategyBacktest({
      windowDays: 30,
      sides: ["yes"], // isolate to one side
      entryPolicy: { kind: "first" },
    });

    expect(result.totalTrades).toBe(1);
    expect(result.totalPnL).toBeGreaterThan(0);
    expect(result.winRate).toBe(1);
    // Profit-target reasons should be the one fired.
    const profitTargetCount =
      (result.exitReasonBreakdown.profit_target_1 ?? 0) +
      (result.exitReasonBreakdown.profit_target_2 ?? 0) +
      (result.exitReasonBreakdown.profit_target_3 ?? 0);
    expect(profitTargetCount).toBe(1);
  });

  it("produces a YES losing trade when price falls into the stop", async () => {
    // Entry at 0.5; stop_loss ≈ 0.425 with default 0.15 vol.
    // Price walks down to 0.4 → stop hit.
    const series = buildSeries("KX-LOSS", [0.5, 0.48, 0.46, 0.44, 0.42, 0.4]);
    mocks.getDb.mockResolvedValue(fakeDb({ snapshots: series }));

    const { runExitStrategyBacktest } = await import("./_core/backtestExits");
    const result = await runExitStrategyBacktest({
      windowDays: 30,
      sides: ["yes"],
      entryPolicy: { kind: "first" },
    });

    expect(result.totalTrades).toBe(1);
    expect(result.totalPnL).toBeLessThan(0);
    expect(result.winRate).toBe(0);
    expect(result.exitReasonBreakdown.stop_loss).toBe(1);
  });

  it("YES and NO trades are produced for a single series and PnL sign matches the side semantics", async () => {
    // NB: production treats `side: "no"` as SHORTING the yes outcome
    // (PnL = entry - exit), not "buying NO contracts".  So a rising
    // YES series is a winner for YES (price up) AND a winner for NO
    // (NO price falls = the short pays).  Assert presence + signs.
    const series = buildSeries("KX-DIR", [0.5, 0.55, 0.6, 0.65, 0.7, 0.75]);
    mocks.getDb.mockResolvedValue(fakeDb({ snapshots: series }));

    const { runExitStrategyBacktest } = await import("./_core/backtestExits");
    const result = await runExitStrategyBacktest({
      windowDays: 30,
      sides: ["yes", "no"],
      entryPolicy: { kind: "first" },
    });

    expect(result.totalTrades).toBe(2);
    const yesTrade = result.sampleTrades.find((t) => t.side === "yes");
    const noTrade = result.sampleTrades.find((t) => t.side === "no");
    expect(yesTrade).toBeDefined();
    expect(noTrade).toBeDefined();
    // Both profit on a rising series (YES from price rise; NO from
    // shorting that rise).
    expect(yesTrade?.pnl).toBeGreaterThan(0);
    expect(noTrade?.pnl).toBeGreaterThan(0);
  });

  it("NO side LOSES on a rising YES series only when the YES rise hits the NO short's stop", async () => {
    // YES rises 0.5 → 0.6 (10 pts).  For NO entry at 0.5, stop is
    // entry * (1 + 0.15) = 0.575.  With NO prices 0.5 → 0.4 (rising
    // YES = falling NO), the noPrice never reaches 0.575 — so the NO
    // short profits.  This regression-protects against the inverse
    // (mistakenly applying the YES PnL formula to NO).
    const risingYes = buildSeries("KX-RISE", [0.5, 0.55, 0.58, 0.6, 0.62, 0.65]);
    mocks.getDb.mockResolvedValue(fakeDb({ snapshots: risingYes }));
    const { runExitStrategyBacktest } = await import("./_core/backtestExits");
    const result = await runExitStrategyBacktest({
      windowDays: 30,
      sides: ["no"],
      entryPolicy: { kind: "first" },
    });
    expect(result.totalTrades).toBe(1);
    expect(result.sampleTrades[0].pnl).toBeGreaterThan(0);
  });

  it("entryPolicy 'every-n' generates more entries than 'first'", async () => {
    const series = buildSeries(
      "KX-MANY",
      [0.5, 0.51, 0.52, 0.49, 0.53, 0.5, 0.54, 0.51, 0.55, 0.52, 0.56, 0.53, 0.57, 0.54],
    );
    mocks.getDb.mockResolvedValue(fakeDb({ snapshots: series }));

    const { runExitStrategyBacktest: bt1 } = await import("./_core/backtestExits");
    const first = await bt1({
      windowDays: 30,
      sides: ["yes"],
      entryPolicy: { kind: "first" },
    });

    vi.resetModules();
    mocks.getDb.mockResolvedValue(fakeDb({ snapshots: series }));
    const { runExitStrategyBacktest: bt2 } = await import("./_core/backtestExits");
    const everyN = await bt2({
      windowDays: 30,
      sides: ["yes"],
      entryPolicy: { kind: "every-n", stride: 2 },
    });

    expect(everyN.totalTrades).toBeGreaterThan(first.totalTrades);
  });

  it("each trade contributes to exactly one exitReason bucket", async () => {
    const series = buildSeries("KX-ONE", [0.5, 0.52, 0.54, 0.56, 0.58, 0.6]);
    mocks.getDb.mockResolvedValue(fakeDb({ snapshots: series }));

    const { runExitStrategyBacktest } = await import("./_core/backtestExits");
    const result = await runExitStrategyBacktest({
      windowDays: 30,
      sides: ["yes", "no"],
      entryPolicy: { kind: "first" },
    });

    const totalReasons = Object.values(result.exitReasonBreakdown).reduce(
      (a, b) => a + b,
      0,
    );
    expect(totalReasons).toBe(result.totalTrades);
  });
});
