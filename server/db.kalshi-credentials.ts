import { kalshiCredentials } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { encryptCredential, decryptCredential, CredentialDecryptionError } from "./_core/kalshiAuth";

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
      .onConflictDoUpdate({
        target: kalshiCredentials.userId,
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
 * Get Kalshi credentials for a user (decrypted).
 *
 * Returns `null` when no credentials exist.
 * Returns `{ needsReauth: true }` when credentials exist but cannot be
 * decrypted with the current CREDENTIAL_ENCRYPTION_SECRET — this happens
 * when the secret was rotated without re-encrypting stored credentials.
 * Callers should surface a re-authentication prompt in this case.
 */
export async function getKalshiCredentials(userId: number): Promise<
  | null
  | { needsReauth: true; userId: number }
  | {
      needsReauth?: false;
      id: number;
      userId: number;
      apiKey: string;
      privateKey: string;
      accountEquity: number;
      accountStatus: string;
      lastSyncedAt: Date | null;
    }
> {
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

    let apiKey: string;
    let privateKey: string;

    try {
      apiKey = decryptCredential(cred.apiKeyEncrypted, cred.userId);
      privateKey = decryptCredential(cred.privateKeyEncrypted, cred.userId);
    } catch (decryptError) {
      if (decryptError instanceof CredentialDecryptionError) {
        console.warn(
          `[Database] Kalshi credentials for user ${userId} cannot be decrypted — ` +
          "CREDENTIAL_ENCRYPTION_SECRET mismatch. User must re-authenticate."
        );
        return { needsReauth: true, userId };
      }
      throw decryptError;
    }

    return {
      id: cred.id,
      userId: cred.userId,
      apiKey,
      privateKey,
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

/**
 * Scan all stored Kalshi credentials and delete any that cannot be decrypted
 * with the current CREDENTIAL_ENCRYPTION_SECRET.
 *
 * This is run once on startup to purge credentials that were encrypted with a
 * different secret (e.g. after a secret rotation or environment mismatch).
 * Affected users will see a "re-authenticate" prompt on their next visit.
 *
 * Returns the number of invalid credential rows that were removed.
 */
export async function clearInvalidKalshiCredentials(): Promise<number> {
  const database = await getDb();
  if (!database) {
    return 0;
  }

  let rows: Array<{ id: number; userId: number; apiKeyEncrypted: string; privateKeyEncrypted: string }>;
  try {
    rows = await database
      .select({
        id: kalshiCredentials.id,
        userId: kalshiCredentials.userId,
        apiKeyEncrypted: kalshiCredentials.apiKeyEncrypted,
        privateKeyEncrypted: kalshiCredentials.privateKeyEncrypted,
      })
      .from(kalshiCredentials);
  } catch (error) {
    console.error("[Database] clearInvalidKalshiCredentials: failed to fetch rows:", error);
    return 0;
  }

  let cleared = 0;

  for (const row of rows) {
    let isValid = true;
    try {
      decryptCredential(row.apiKeyEncrypted, row.userId);
      decryptCredential(row.privateKeyEncrypted, row.userId);
    } catch {
      isValid = false;
    }

    if (!isValid) {
      try {
        await database
          .delete(kalshiCredentials)
          .where(eq(kalshiCredentials.userId, row.userId));
        cleared++;
        console.warn(
          `[Database] Removed undecryptable Kalshi credentials for user ${row.userId}. ` +
          "User must re-authenticate with Kalshi."
        );
      } catch (deleteError) {
        console.error(
          `[Database] Failed to remove invalid credentials for user ${row.userId}:`,
          deleteError
        );
      }
    }
  }

  if (cleared > 0) {
    console.warn(
      `[Database] Credential cleanup complete: removed ${cleared} invalid Kalshi credential row(s). ` +
      "Affected users must re-authenticate with Kalshi."
    );
  } else {
    console.log("[Database] Credential cleanup: all stored Kalshi credentials are valid.");
  }

  return cleared;
}
