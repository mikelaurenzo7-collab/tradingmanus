/**
 * Desk-memory data access — persistent learning tape per (user, platform, desk).
 *
 * Each AI reviewer desk (Kalshi Sports, Polymarket Crypto, ...) keeps a small
 * rolling list of short lessons.  The list is appended on trade outcomes and
 * loaded into the cached system prompt before each review run so the desk's
 * reasoning is informed by what already worked or burned the founder's account.
 *
 * The whole tape is intentionally tiny (≤ 12 notes, ≤ 4KB serialized) so it
 * fits in the cached system prompt without inflating token cost.
 */

import { and, eq } from "drizzle-orm";
import { deskMemory } from "../drizzle/schema";
import { getDb } from "./db";
import { assertPositiveIntegerUserId } from "./_core/userScope";
import { logger } from "./_core/logger";

export type DeskPlatform = "kalshi" | "polymarket";
export type DeskOutcome = "win" | "loss" | "scratch";

export type DeskMemoryNote = {
  ts: string;
  outcome: DeskOutcome;
  note: string;
};

export type DeskMemoryRecord = {
  userId: number;
  platform: DeskPlatform;
  deskId: string;
  notes: DeskMemoryNote[];
  tradeCount: number;
  winCount: number;
  lossCount: number;
};

const MAX_NOTES = 12;
const MAX_NOTE_CHARS = 240;
const MAX_NOTES_PAYLOAD_BYTES = 4096;

function safeParseNotes(raw: string | null | undefined): DeskMemoryNote[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => ({
        ts: typeof entry.ts === "string" ? entry.ts : new Date().toISOString(),
        outcome: (entry.outcome === "win" || entry.outcome === "loss" ? entry.outcome : "scratch") as DeskOutcome,
        note: typeof entry.note === "string" ? entry.note.slice(0, MAX_NOTE_CHARS) : "",
      }))
      .filter((entry) => entry.note.length > 0)
      .slice(-MAX_NOTES);
  } catch {
    return [];
  }
}

function serializeNotes(notes: DeskMemoryNote[]): string {
  // Greedy trim from the head until the serialized payload fits.
  let pruned = notes.slice(-MAX_NOTES);
  let serialized = JSON.stringify(pruned);
  while (serialized.length > MAX_NOTES_PAYLOAD_BYTES && pruned.length > 1) {
    pruned = pruned.slice(1);
    serialized = JSON.stringify(pruned);
  }
  return serialized;
}

export async function getDeskMemory(
  userId: number,
  platform: DeskPlatform,
  deskId: string,
): Promise<DeskMemoryRecord | null> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "getDeskMemory userId");
  const database = await getDb();
  if (!database) return null;

  const rows = await database
    .select()
    .from(deskMemory)
    .where(
      and(
        eq(deskMemory.userId, scopedUserId),
        eq(deskMemory.platform, platform),
        eq(deskMemory.deskId, deskId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  return {
    userId: scopedUserId,
    platform,
    deskId,
    notes: safeParseNotes(row.notes),
    tradeCount: row.tradeCount,
    winCount: row.winCount,
    lossCount: row.lossCount,
  };
}

export async function getDeskMemoryBatch(
  userId: number,
  platform: DeskPlatform,
  deskIds: string[],
): Promise<Map<string, DeskMemoryRecord>> {
  const result = new Map<string, DeskMemoryRecord>();
  if (deskIds.length === 0) return result;

  await Promise.all(
    deskIds.map(async (deskId) => {
      const record = await getDeskMemory(userId, platform, deskId);
      if (record) result.set(deskId, record);
    }),
  );

  return result;
}

export async function appendDeskMemoryNote(
  userId: number,
  platform: DeskPlatform,
  deskId: string,
  outcome: DeskOutcome,
  note: string,
): Promise<void> {
  const scopedUserId = assertPositiveIntegerUserId(userId, "appendDeskMemoryNote userId");
  const trimmedNote = note.trim().slice(0, MAX_NOTE_CHARS);
  if (trimmedNote.length === 0) return;

  const database = await getDb();
  if (!database) return;

  const existing = await getDeskMemory(scopedUserId, platform, deskId);
  const nextNotes: DeskMemoryNote[] = [
    ...(existing?.notes ?? []),
    { ts: new Date().toISOString(), outcome, note: trimmedNote },
  ];

  if (nextNotes.length > MAX_NOTES) {
    logger.warn(
      {
        desk: deskId,
        totalNotes: nextNotes.length,
        maxNotes: MAX_NOTES,
        droppedCount: nextNotes.length - MAX_NOTES,
      },
      "Desk memory capacity exceeded",
    );
  }

  const serialized = serializeNotes(nextNotes);

  const winInc = outcome === "win" ? 1 : 0;
  const lossInc = outcome === "loss" ? 1 : 0;

  if (existing) {
    await database
      .update(deskMemory)
      .set({
        notes: serialized,
        tradeCount: existing.tradeCount + 1,
        winCount: existing.winCount + winInc,
        lossCount: existing.lossCount + lossInc,
      })
      .where(
        and(
          eq(deskMemory.userId, scopedUserId),
          eq(deskMemory.platform, platform),
          eq(deskMemory.deskId, deskId),
        ),
      );
  } else {
    await database.insert(deskMemory).values({
      userId: scopedUserId,
      platform,
      deskId,
      notes: serialized,
      tradeCount: 1,
      winCount: winInc,
      lossCount: lossInc,
    });
  }
}

/**
 * Format the desk memory as a short cached-system-prompt snippet.  Returns
 * null when the desk has no useful prior tape so callers can skip injecting
 * an empty block.
 */
export function formatDeskMemoryForPrompt(record: DeskMemoryRecord | null): string | null {
  if (!record || record.notes.length === 0) return null;
  const winRate = record.tradeCount > 0 ? Math.round((record.winCount / record.tradeCount) * 100) : 0;
  if (record.notes.length > MAX_NOTES) {
    logger.warn(
      {
        desk: record.deskId,
        totalNotes: record.notes.length,
        maxNotes: MAX_NOTES,
        droppedCount: record.notes.length - MAX_NOTES,
      },
      "Desk memory capacity exceeded",
    );
  }
  const recent = record.notes.slice(-MAX_NOTES);
  const lines = recent.map((entry) => `- [${entry.outcome.toUpperCase()}] ${entry.note}`);
  return [
    `Desk learning tape (${record.tradeCount} prior trades, ${winRate}% win rate, last ${MAX_NOTES} lessons):`,
    ...lines,
    "Apply these prior lessons when reviewing today's candidates; weight your own veto more heavily on patterns previously associated with losses.",
  ].join("\n");
}

/**
 * High-level primitive — call after a trade closes to record what the desk
 * learned from it.  `platform` and `marketCategory` together determine the
 * desk; `note` should be a short imperative sentence ("Faded a momentum
 * bait on stale NBA market — won").  Caller is responsible for not leaking
 * PII or anything beyond market metadata.
 */
export async function recordDeskTradeOutcome(input: {
  userId: number;
  platform: DeskPlatform;
  marketCategory: import("./_core/marketCategoryRouter").MarketCategory;
  outcome: DeskOutcome;
  note: string;
}): Promise<void> {
  const { getCategoryPersona } = await import("./_core/categoryPersonas");
  const persona = getCategoryPersona(input.platform, input.marketCategory);
  await appendDeskMemoryNote(
    input.userId,
    input.platform,
    persona.id,
    input.outcome,
    input.note,
  );
}

/**
 * Build a one-line lesson note from a closed-position summary.  Kept short
 * to fit the per-note cap and be useful when read back inside the cached
 * system prompt.
 *
 *   "BUY YES @ 0.42 → 0.78 | qty 10 | +$3.60 (win)"
 *   "BUY NO @ 0.31 → 0.10 | qty 5  | +$1.05 (win)"
 *   "BUY YES @ 0.65 → 0.40 | qty 8  | -$2.00 (loss)"
 */
export function summarizeTradeAsDeskNote(input: {
  side: "yes" | "no";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  realizedPnl: number;
  marketTitle?: string | null;
}): { outcome: DeskOutcome; note: string } {
  const outcome: DeskOutcome =
    input.realizedPnl > 0 ? "win" : input.realizedPnl < 0 ? "loss" : "scratch";
  const sign = input.realizedPnl >= 0 ? "+" : "-";
  const absPnl = Math.abs(input.realizedPnl).toFixed(2);
  const tail = input.marketTitle ? ` :: ${input.marketTitle.slice(0, 80)}` : "";
  const note = `BUY ${input.side.toUpperCase()} @ ${input.entryPrice.toFixed(
    2,
  )} → ${input.exitPrice.toFixed(2)} | qty ${input.quantity} | ${sign}$${absPnl} (${outcome})${tail}`;
  return { outcome, note };
}

/**
 * Side-effect-free wrapper used by the trade-close path.  Classifies the
 * market into a desk and appends the lesson.  Swallows + logs errors so
 * memory write never blocks or fails a trade close.
 */
export async function tryRecordKalshiCloseToDeskMemory(input: {
  userId: number;
  marketId: string;
  side: "yes" | "no";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  realizedPnl: number;
  logger?: Pick<Console, "warn">;
}): Promise<void> {
  try {
    const [{ getKalshiMarket }, { classifyMarketCategory }] = await Promise.all([
      import("./db"),
      import("./_core/marketCategoryRouter"),
    ]);

    const market = await getKalshiMarket(input.marketId);
    const category = classifyMarketCategory({
      category: (market as any)?.category,
      title: (market as any)?.title,
    });
    const { outcome, note } = summarizeTradeAsDeskNote({
      side: input.side,
      entryPrice: input.entryPrice,
      exitPrice: input.exitPrice,
      quantity: input.quantity,
      realizedPnl: input.realizedPnl,
      marketTitle: (market as any)?.title,
    });
    await recordDeskTradeOutcome({
      userId: input.userId,
      platform: "kalshi",
      marketCategory: category,
      outcome,
      note,
    });
  } catch (error) {
    (input.logger ?? console).warn(
      `[deskMemory] Kalshi close memory write failed for marketId=${input.marketId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Polymarket equivalent of tryRecordKalshiCloseToDeskMemory.  Polymarket
 * doesn't have a per-market table to look up like Kalshi does, so the caller
 * passes the market title + category tag inline.  Same fail-soft semantics:
 * memory writes never block or fail a trade close.
 */
export async function tryRecordPolymarketCloseToDeskMemory(input: {
  userId: number;
  marketId: string;
  marketTitle?: string | null;
  marketCategoryTag?: string | null;
  side: "yes" | "no";
  entryPrice: number;
  exitPrice: number;
  sizeUsdc: number;
  realizedPnl: number;
  logger?: Pick<Console, "warn">;
}): Promise<void> {
  try {
    const { classifyMarketCategory } = await import("./_core/marketCategoryRouter");
    const category = classifyMarketCategory({
      category: input.marketCategoryTag ?? undefined,
      title: input.marketTitle ?? undefined,
    });
    const { outcome, note } = summarizeTradeAsDeskNote({
      side: input.side,
      entryPrice: input.entryPrice,
      exitPrice: input.exitPrice,
      quantity: input.sizeUsdc,
      realizedPnl: input.realizedPnl,
      marketTitle: input.marketTitle ?? undefined,
    });
    await recordDeskTradeOutcome({
      userId: input.userId,
      platform: "polymarket",
      marketCategory: category,
      outcome,
      note,
    });
  } catch (error) {
    (input.logger ?? console).warn(
      `[deskMemory] Polymarket close memory write failed for marketId=${input.marketId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ── Test-only helpers ────────────────────────────────────────────────────────
export const __TEST_ONLY__ = {
  serializeNotes,
  safeParseNotes,
  MAX_NOTES,
  MAX_NOTE_CHARS,
  MAX_NOTES_PAYLOAD_BYTES,
};
