import { kalshiCredentials } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { encryptCredential, decryptCredential } from "./_core/kalshiAuth";

/**
 * Save Kalshi credentials for a user
 */
export async function saveKalshiCredentials(
  userId: number,
  apiKey: string,
  privateKey: string,
  accountEquity: number
) {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not initialized");
  }

  const encryptedApiKey = encryptCredential(apiKey, userId);
  const encryptedPrivateKey = encryptCredential(privateKey, userId);

  try {
    await database
      .insert(kalshiCredentials)
      .values({
        userId,
        apiKeyEncrypted: encryptedApiKey,
        privateKeyEncrypted: encryptedPrivateKey,
        accountEquity,
        accountStatus: "connected",
        lastSyncedAt: new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          apiKeyEncrypted: encryptedApiKey,
          privateKeyEncrypted: encryptedPrivateKey,
          accountEquity,
          accountStatus: "connected",
          lastSyncedAt: new Date(),
        },
      });

    return { success: true };
  } catch (error) {
    console.error("[Database] Save Kalshi credentials failed:", error);
    throw error;
  }
}

/**
 * Get Kalshi credentials for a user (decrypted)
 */
export async function getKalshiCredentials(userId: number) {
  const database = await getDb();
  if (!database) {
    return null;
  }

  try {
    const result = await database
      .select()
      .from(kalshiCredentials)
      .where(eq(kalshiCredentials.userId, userId))
      .limit(1);

    if (!result || result.length === 0) {
      return null;
    }

    const cred = result[0];
    return {
      id: cred.id,
      userId: cred.userId,
      apiKey: decryptCredential(cred.apiKeyEncrypted, cred.userId),
      privateKey: decryptCredential(cred.privateKeyEncrypted, cred.userId),
      accountEquity: cred.accountEquity,
      accountStatus: cred.accountStatus,
      lastSyncedAt: cred.lastSyncedAt,
    };
  } catch (error) {
    console.error("[Database] Get Kalshi credentials failed:", error);
    return null;
  }
}

/**
 * Update account equity for a user
 */
export async function updateKalshiAccountEquity(userId: number, equity: number) {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not initialized");
  }

  try {
    await database
      .update(kalshiCredentials)
      .set({
        accountEquity: equity,
        lastSyncedAt: new Date(),
      })
      .where(eq(kalshiCredentials.userId, userId));

    return { success: true };
  } catch (error) {
    console.error("[Database] Update account equity failed:", error);
    throw error;
  }
}

/**
 * Update account status
 */
export async function updateKalshiAccountStatus(
  userId: number,
  status: "connected" | "disconnected" | "error"
) {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not initialized");
  }

  try {
    await database
      .update(kalshiCredentials)
      .set({
        accountStatus: status,
        lastSyncedAt: new Date(),
      })
      .where(eq(kalshiCredentials.userId, userId));

    return { success: true };
  } catch (error) {
    console.error("[Database] Update account status failed:", error);
    throw error;
  }
}

/**
 * Delete Kalshi credentials for a user
 */
export async function deleteKalshiCredentials(userId: number) {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not initialized");
  }

  try {
    await database
      .delete(kalshiCredentials)
      .where(eq(kalshiCredentials.userId, userId));

    return { success: true };
  } catch (error) {
    console.error("[Database] Delete Kalshi credentials failed:", error);
    throw error;
  }
}
