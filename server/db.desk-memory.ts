/**
 * Desk-memory data access — persistent learning tape per (user, platform, desk).
 *
 * Each AI reviewer desk (Kalshi Sports, Polymarket Crypto, ...) keeps a small
 * rolling list of short lessons.  The list is appended on trade outcomes and
 * loaded into the cached system prompt before each review run so the desk's
 * reasoning is informed by what already worked or burned the founder's account.
 *
 * The whole tape is intentionally tiny (≤ 32 notes, ≤ 4KB serialized) so it
 * fits in the cached system prompt without inflating token cost.
 */

import { and, eq } from "drizzle-orm";
import { deskMemory } from "../drizzle/schema";
import { getDb } from "./db";
import { assertPositiveIntegerUserId } from "./_core/userScope";

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

const MAX_NOTES = 32;
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
  const recent = record.notes.slice(-12);
  const lines = recent.map((entry) => `- [${entry.outcome.toUpperCase()}] ${entry.note}`);
  return [
    `Desk learning tape (${record.tradeCount} prior trades, ${winRate}% win rate, last 12 lessons):`,
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

// ── Test-only helpers ────────────────────────────────────────────────────────
export const __TEST_ONLY__ = {
  serializeNotes,
  safeParseNotes,
  MAX_NOTES,
  MAX_NOTE_CHARS,
  MAX_NOTES_PAYLOAD_BYTES,
};
