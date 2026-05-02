import { describe, expect, it } from "vitest";
import {
  __TEST_ONLY__,
  formatDeskMemoryForPrompt,
  summarizeTradeAsDeskNote,
} from "./db.desk-memory";

const { serializeNotes, safeParseNotes, MAX_NOTES, MAX_NOTES_PAYLOAD_BYTES } = __TEST_ONLY__;

describe("desk-memory serialization", () => {
  it("round-trips through serialize + safeParse", () => {
    const notes = [
      { ts: "2025-01-01T00:00:00Z", outcome: "win" as const, note: "won momentum on NFL" },
      { ts: "2025-01-02T00:00:00Z", outcome: "loss" as const, note: "lost late-game basketball reversal" },
    ];
    const reparsed = safeParseNotes(serializeNotes(notes));
    expect(reparsed).toHaveLength(2);
    expect(reparsed[0].outcome).toBe("win");
    expect(reparsed[1].note).toContain("basketball");
  });

  it("clamps the array to MAX_NOTES", () => {
    const tooMany = Array.from({ length: MAX_NOTES + 20 }, (_, i) => ({
      ts: new Date().toISOString(),
      outcome: "scratch" as const,
      note: `note ${i}`,
    }));
    const reparsed = safeParseNotes(serializeNotes(tooMany));
    expect(reparsed).toHaveLength(MAX_NOTES);
    // The trailing window is what survived.
    expect(reparsed[reparsed.length - 1].note).toBe(`note ${MAX_NOTES + 19}`);
  });

  it("keeps payload size under the byte cap", () => {
    const huge = Array.from({ length: 50 }, (_, i) => ({
      ts: new Date().toISOString(),
      outcome: "loss" as const,
      note: "x".repeat(200) + ` #${i}`,
    }));
    const serialized = serializeNotes(huge);
    expect(serialized.length).toBeLessThanOrEqual(MAX_NOTES_PAYLOAD_BYTES);
  });

  it("safely returns empty for malformed JSON", () => {
    expect(safeParseNotes("not json")).toEqual([]);
    expect(safeParseNotes("[1, 2, 3]")).toEqual([]);
    expect(safeParseNotes(null)).toEqual([]);
  });

  it("filters out notes with empty bodies", () => {
    const reparsed = safeParseNotes(
      JSON.stringify([
        { ts: "2025-01-01T00:00:00Z", outcome: "win", note: "" },
        { ts: "2025-01-01T00:00:00Z", outcome: "win", note: "kept" },
      ]),
    );
    expect(reparsed).toHaveLength(1);
    expect(reparsed[0].note).toBe("kept");
  });
});

describe("formatDeskMemoryForPrompt", () => {
  it("returns null for null record", () => {
    expect(formatDeskMemoryForPrompt(null)).toBeNull();
  });

  it("returns null when there are no notes", () => {
    expect(
      formatDeskMemoryForPrompt({
        userId: 1,
        platform: "kalshi",
        deskId: "kalshi.sports",
        notes: [],
        tradeCount: 0,
        winCount: 0,
        lossCount: 0,
      }),
    ).toBeNull();
  });

  it("summarizeTradeAsDeskNote handles Polymarket-style USDC quantities", () => {
    const note = summarizeTradeAsDeskNote({
      side: "yes",
      entryPrice: 0.42,
      exitPrice: 0.61,
      quantity: 12.5, // USDC notional
      realizedPnl: 5.6,
      marketTitle: "Bitcoin > 100k by year end",
    });
    expect(note.outcome).toBe("win");
    expect(note.note).toContain("qty 12.5");
    expect(note.note).toContain("Bitcoin");
  });

  it("summarizeTradeAsDeskNote produces a compact lesson with derived outcome", () => {
    const win = summarizeTradeAsDeskNote({
      side: "yes",
      entryPrice: 0.42,
      exitPrice: 0.78,
      quantity: 10,
      realizedPnl: 3.6,
      marketTitle: "Lakers win NBA Finals",
    });
    expect(win.outcome).toBe("win");
    expect(win.note).toMatch(/^BUY YES @ 0\.42 → 0\.78/);
    expect(win.note).toContain("+$3.60 (win)");
    expect(win.note).toContain("Lakers");

    const loss = summarizeTradeAsDeskNote({
      side: "no",
      entryPrice: 0.31,
      exitPrice: 0.55,
      quantity: 5,
      realizedPnl: -1.2,
    });
    expect(loss.outcome).toBe("loss");
    expect(loss.note).toContain("-$1.20 (loss)");

    const scratch = summarizeTradeAsDeskNote({
      side: "yes",
      entryPrice: 0.5,
      exitPrice: 0.5,
      quantity: 1,
      realizedPnl: 0,
    });
    expect(scratch.outcome).toBe("scratch");
  });

  it("renders win-rate header and last 12 lessons", () => {
    const formatted = formatDeskMemoryForPrompt({
      userId: 1,
      platform: "kalshi",
      deskId: "kalshi.sports",
      notes: [
        { ts: "2025-01-01T00:00:00Z", outcome: "win", note: "fade momentum on stale market" },
        { ts: "2025-01-02T00:00:00Z", outcome: "loss", note: "do not buy late-cycle nfl unders" },
      ],
      tradeCount: 2,
      winCount: 1,
      lossCount: 1,
    });
    expect(formatted).toContain("2 prior trades");
    expect(formatted).toContain("50% win rate");
    expect(formatted).toContain("[WIN]");
    expect(formatted).toContain("[LOSS]");
    expect(formatted).toContain("fade momentum");
  });
});
