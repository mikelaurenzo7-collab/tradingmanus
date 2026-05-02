import { botConfigs, chatMessages } from "../drizzle/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getDb } from "./db";

type Platform = "kalshi" | "polymarket";

// ── Bot Config ────────────────────────────────────────────────────────────────

export async function getBotConfig(userId: number, platform: Platform) {
  const database = await getDb();
  if (!database) return null;

  const [config] = await database
    .select()
    .from(botConfigs)
    .where(and(eq(botConfigs.userId, userId), eq(botConfigs.platform, platform)));

  return config ?? null;
}

export async function upsertBotConfig(
  userId: number,
  platform: Platform,
  patch: {
    persona?: string | null;
    systemInstructions?: string | null;
    tone?: "professional" | "casual" | "aggressive" | "analytical";
    memorySummary?: string | null;
    triggerSignalsEnabled?: number;
    triggerOrdersEnabled?: number;
  }
) {
  const database = await getDb();
  if (!database) throw new Error("Database not initialized");

  const existing = await getBotConfig(userId, platform);

  if (existing) {
    const [updated] = await database
      .update(botConfigs)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(botConfigs.userId, userId), eq(botConfigs.platform, platform)))
      .returning();
    return updated;
  }

  const [created] = await database
    .insert(botConfigs)
    .values({ userId, platform, ...patch })
    .returning();
  return created;
}

// ── Chat Messages ─────────────────────────────────────────────────────────────

const MAX_HISTORY = 120;

export async function getChatMessages(userId: number, platform: Platform, limit = 60) {
  const database = await getDb();
  if (!database) return [];

  const rows = await database
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.userId, userId), eq(chatMessages.platform, platform)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);

  return rows.reverse();
}

export async function addChatMessage(payload: {
  userId: number;
  platform: Platform;
  role: "user" | "assistant";
  content: string;
  actionType?: string | null;
  actionData?: string | null;
}) {
  const database = await getDb();
  if (!database) throw new Error("Database not initialized");

  const [row] = await database
    .insert(chatMessages)
    .values({
      userId: payload.userId,
      platform: payload.platform,
      role: payload.role,
      content: payload.content,
      actionType: payload.actionType ?? null,
      actionData: payload.actionData ?? null,
    })
    .returning();

  // Prune oldest messages when we exceed the cap
  const allIds = await database
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(and(eq(chatMessages.userId, payload.userId), eq(chatMessages.platform, payload.platform)))
    .orderBy(desc(chatMessages.createdAt));

  if (allIds.length > MAX_HISTORY) {
    const toDelete = allIds.slice(MAX_HISTORY).map((r: { id: number }) => r.id);
    await database.delete(chatMessages).where(inArray(chatMessages.id, toDelete));
  }

  return row;
}

export async function clearChatMessages(userId: number, platform: Platform) {
  const database = await getDb();
  if (!database) throw new Error("Database not initialized");

  await database
    .delete(chatMessages)
    .where(and(eq(chatMessages.userId, userId), eq(chatMessages.platform, platform)));
}
