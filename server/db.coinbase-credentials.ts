/**
 * Coinbase credentials DB helper — Phase 10 scaffolding.
 *
 * Mirrors db.polymarket-credentials.ts: AES-256-GCM encryption at rest
 * under CREDENTIAL_ENCRYPTION_SECRET, scoped per userId.  The scaffolding
 * lets the operator connect now; live trading remains gated behind
 * ENV.enableCoinbaseLive (see server/_core/coinbaseExecution.ts).
 */

import { coinbaseCredentials } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { encryptCredential, decryptCredential } from "./_core/kalshiAuth";
import { logger } from "./_core/logger";

export async function saveCoinbaseCredentials(
  userId: number,
  apiKey: string,
  apiSecret: string,
  apiPassphrase: string | null,
  sandboxMode = true,
): Promise<void> {
  const database = await getDb();
  if (!database) throw new Error("Database not initialized");

  const encryptedApiKey = encryptCredential(apiKey.trim(), userId);
  const encryptedApiSecret = encryptCredential(apiSecret.trim(), userId);
  const encryptedApiPassphrase =
    apiPassphrase && apiPassphrase.trim().length > 0
      ? encryptCredential(apiPassphrase.trim(), userId)
      : null;

  // Round-trip check — surfaces CREDENTIAL_ENCRYPTION_SECRET issues at
  // save time instead of phantom-success that breaks at first use.
  try {
    if (decryptCredential(encryptedApiKey, userId) !== apiKey.trim()) {
      throw new Error("API key round-trip mismatch");
    }
    if (decryptCredential(encryptedApiSecret, userId) !== apiSecret.trim()) {
      throw new Error("API secret round-trip mismatch");
    }
  } catch (err) {
    logger.error(
      { err, userId },
      "[Database] Coinbase credential round-trip failed",
    );
    throw new Error(
      "Coinbase credentials could not be stored: server encryption secret may be misconfigured.",
    );
  }

  await database
    .insert(coinbaseCredentials)
    .values({
      userId,
      apiKeyEncrypted: encryptedApiKey,
      apiSecretEncrypted: encryptedApiSecret,
      apiPassphraseEncrypted: encryptedApiPassphrase,
      sandboxMode: sandboxMode ? 1 : 0,
      accountStatus: "connected",
      lastSyncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: coinbaseCredentials.userId,
      set: {
        apiKeyEncrypted: encryptedApiKey,
        apiSecretEncrypted: encryptedApiSecret,
        apiPassphraseEncrypted: encryptedApiPassphrase,
        sandboxMode: sandboxMode ? 1 : 0,
        accountStatus: "connected",
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

export async function getCoinbaseCredentials(userId: number): Promise<{
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string | null;
  sandboxMode: boolean;
  accountStatus: "connected" | "disconnected" | "error";
} | null> {
  const database = await getDb();
  if (!database) return null;
  const rows = await database
    .select()
    .from(coinbaseCredentials)
    .where(eq(coinbaseCredentials.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  try {
    return {
      apiKey: decryptCredential(row.apiKeyEncrypted, userId),
      apiSecret: decryptCredential(row.apiSecretEncrypted, userId),
      apiPassphrase: row.apiPassphraseEncrypted
        ? decryptCredential(row.apiPassphraseEncrypted, userId)
        : null,
      sandboxMode: Boolean(row.sandboxMode),
      accountStatus: row.accountStatus as "connected" | "disconnected" | "error",
    };
  } catch (err) {
    logger.error({ err, userId }, "[Database] Coinbase credential decrypt failed");
    return null;
  }
}

export async function isCoinbaseConnected(userId: number): Promise<boolean> {
  const database = await getDb();
  if (!database) return false;
  try {
    const rows = await database
      .select({ accountStatus: coinbaseCredentials.accountStatus })
      .from(coinbaseCredentials)
      .where(eq(coinbaseCredentials.userId, userId))
      .limit(1);
    return rows[0]?.accountStatus === "connected";
  } catch (err) {
    logger.error({ err }, "[Database] isCoinbaseConnected check failed");
    return false;
  }
}

export async function deleteCoinbaseCredentials(userId: number): Promise<void> {
  const database = await getDb();
  if (!database) return;
  await database
    .delete(coinbaseCredentials)
    .where(eq(coinbaseCredentials.userId, userId));
}
