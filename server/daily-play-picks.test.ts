import { describe, it, expect } from "vitest";
import { rollupScoreboard } from "./db.daily-play-picks";
import type { DailyPlayPick } from "../drizzle/schema";

const mk = (overrides: Partial<DailyPlayPick>): DailyPlayPick =>
  ({
    id: 1,
    userId: 1,
    platform: "kalshi",
    playType: "sports",
    playDate: "2026-05-09",
    marketId: "m1",
    tokenId: null,
    signalId: null,
    side: "yes",
    stakeUsd: 5,
    entryPrice: 0.5,
    quantity: 10,
    confidence: 0.7,
    expectedValue: 0.1,
    reasoning: null,
    status: "pending",
    exitPrice: null,
    realizedPnl: null,
    closedAt: null,
    linkedPositionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as DailyPlayPick;

describe("rollupScoreboard", () => {
  it("returns empty rollup when no picks", () => {
    const r = rollupScoreboard([], "2026-05-09");
    expect(r.today.kalshi).toBeNull();
    expect(r.today.polymarket).toBeNull();
    expect(r.days).toEqual([]);
    expect(r.lifetime.totalPicks).toBe(0);
    expect(r.lifetime.winRate).toBe(0);
  });

  it("aggregates today's picks per platform", () => {
    const picks: DailyPlayPick[] = [
      mk({ id: 1, platform: "kalshi", playDate: "2026-05-09" }),
      mk({ id: 2, platform: "polymarket", playDate: "2026-05-09", side: "no" }),
    ];
    const r = rollupScoreboard(picks, "2026-05-09");
    expect(r.today.kalshi?.id).toBe(1);
    expect(r.today.polymarket?.id).toBe(2);
  });

  it("buckets by date and computes per-day combined stats", () => {
    const picks: DailyPlayPick[] = [
      mk({ id: 1, platform: "kalshi", playDate: "2026-05-09", status: "won", realizedPnl: 12 }),
      mk({ id: 2, platform: "polymarket", playDate: "2026-05-09", status: "lost", realizedPnl: -4 }),
      mk({ id: 3, platform: "kalshi", playDate: "2026-05-08", status: "won", realizedPnl: 8 }),
    ];
    const r = rollupScoreboard(picks, "2026-05-09");
    expect(r.days).toHaveLength(2);
    const today = r.days.find((d) => d.date === "2026-05-09")!;
    expect(today.kalshi.wins).toBe(1);
    expect(today.polymarket.losses).toBe(1);
    expect(today.combined.totalPnl).toBe(8); // 12 - 4
    const yesterday = r.days.find((d) => d.date === "2026-05-08")!;
    expect(yesterday.combined.wins).toBe(1);
    expect(yesterday.combined.totalPnl).toBe(8);
  });

  it("computes lifetime win rate excluding pending picks", () => {
    const picks: DailyPlayPick[] = [
      mk({ id: 1, status: "won", realizedPnl: 10 }),
      mk({ id: 2, status: "won", realizedPnl: 5 }),
      mk({ id: 3, status: "lost", realizedPnl: -7 }),
      mk({ id: 4, status: "pending" }), // excluded from win rate
    ];
    const r = rollupScoreboard(picks, "2026-05-09");
    expect(r.lifetime.totalPicks).toBe(4);
    expect(r.lifetime.winRate).toBeCloseTo(2 / 3, 5); // 2 wins of 3 resolved
    expect(r.lifetime.totalPnl).toBe(8); // 10 + 5 - 7
  });

  it("splits lifetime totals per platform", () => {
    const picks: DailyPlayPick[] = [
      mk({ id: 1, platform: "kalshi", status: "won", realizedPnl: 10 }),
      mk({ id: 2, platform: "polymarket", status: "lost", realizedPnl: -3 }),
      mk({ id: 3, platform: "polymarket", status: "won", realizedPnl: 6 }),
    ];
    const r = rollupScoreboard(picks, "2026-05-09");
    expect(r.lifetime.byPlatform.kalshi.wins).toBe(1);
    expect(r.lifetime.byPlatform.polymarket.wins).toBe(1);
    expect(r.lifetime.byPlatform.polymarket.losses).toBe(1);
    expect(r.lifetime.byPlatform.kalshi.totalPnl).toBe(10);
    expect(r.lifetime.byPlatform.polymarket.totalPnl).toBe(3);
  });

  it("orders days newest-first", () => {
    const picks: DailyPlayPick[] = [
      mk({ id: 1, playDate: "2026-05-07" }),
      mk({ id: 2, playDate: "2026-05-09" }),
      mk({ id: 3, playDate: "2026-05-08" }),
    ];
    const r = rollupScoreboard(picks, "2026-05-09");
    expect(r.days.map((d) => d.date)).toEqual([
      "2026-05-09",
      "2026-05-08",
      "2026-05-07",
    ]);
  });

  it("treats null realizedPnl as zero contribution", () => {
    const picks: DailyPlayPick[] = [
      mk({ id: 1, status: "pending", realizedPnl: null }),
    ];
    const r = rollupScoreboard(picks, "2026-05-09");
    expect(r.lifetime.totalPnl).toBe(0);
    expect(r.lifetime.byPlatform.kalshi.totalPnl).toBe(0);
  });
});
