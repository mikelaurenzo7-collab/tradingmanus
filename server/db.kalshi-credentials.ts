import { kalshiCredentials } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { encryptCredential, decryptCredential, CredentialDecryptionError } from "./_core/kalshiAuth";
import { logger } from "./_core/logger";

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

  // Verify the round-trip immediately — catches CREDENTIAL_ENCRYPTION_SECRET
  // mismatches at save time so the user sees an error now instead of a
  // phantom success that breaks at the next autonomy run.
  try {
    const rtApiKey = decryptCredential(encryptedApiKey, userId);
    const rtPrivateKey = decryptCredential(encryptedPrivateKey, userId);
    if (rtApiKey !== apiKey || rtPrivateKey !== privateKey) {
      throw new Error("Credential round-trip mismatch after encryption");
    }
  } catch (verifyError) {
    logger.error(
      { err: verifyError, userId },
      "[Database] Kalshi credential encrypt/decrypt round-trip failed — CREDENTIAL_ENCRYPTION_SECRET may be misconfigured"
    );
    throw new Error(
      "Credentials could not be securely stored: the server encryption secret appears misconfigured. " +
        "Verify CREDENTIAL_ENCRYPTION_SECRET is set correctly in Railway and redeploy, then try again."
    );
  }

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
    logger.error({ err: error }, "[Database] Save Kalshi credentials failed");
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
        logger.warn(
          { userId },
          `[Database] Kalshi credentials for user ${userId} cannot be decrypted — CREDENTIAL_ENCRYPTION_SECRET mismatch. User must re-authenticate.`
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
    logger.error({ err: error }, "[Database] Get Kalshi credentials failed");
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
    logger.error({ err: error }, "[Database] Update account equity failed");
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
    logger.error({ err: error }, "[Database] Update account status failed");
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
    logger.error({ err: error }, "[Database] Delete Kalshi credentials failed");
    throw error;
  }
}

/**
 * Scan stored Kalshi credentials at startup and either log a warning for
 * undecryptable rows (default, non-destructive) or actively mark them as
 * disconnected (when CLEAR_INVALID_KALSHI_CREDENTIALS=true is set
 * explicitly).
 *
 * Why this changed: the previous implementation DELETED any row that
 * failed decryption, so a transient decrypt error (or a single
 * inconsistency) on startup forced the user to re-paste their API key
 * + private-key PEM block.  Operators reported having to reconnect on
 * every redeploy.  The new default behaviour preserves the row and
 * surfaces the issue in the audit log so the operator can triage
 * without losing state.
 *
 * Returns { scanned, undecryptable, mutated }.  `mutated` is non-zero
 * only when CLEAR_INVALID_KALSHI_CREDENTIALS=true; in that case rows
 * are marked disconnected (encrypted blobs are NOT deleted, so a future
 * secret-restore can still recover them).
 */
export async function clearInvalidKalshiCredentials(): Promise<{
  scanned: number;
  undecryptable: number;
  mutated: number;
}> {
  const database = await getDb();
  if (!database) {
    return { scanned: 0, undecryptable: 0, mutated: 0 };
  }

  // Hard-disable destructive cleanup unless the operator explicitly
  // opts in.  The env flag only takes effect when set to a truthy
  // string ("1" / "true" / "yes" / "on").  Otherwise we just log.
  const destructiveOptIn = (() => {
    const raw = (process.env.CLEAR_INVALID_KALSHI_CREDENTIALS ?? "")
      .trim()
      .toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  })();

  let rows: Array<{
    id: number;
    userId: number;
    apiKeyEncrypted: string;
    privateKeyEncrypted: string;
  }>;
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
    logger.error(
      { err: error },
      "[Database] clearInvalidKalshiCredentials: failed to fetch rows",
    );
    return { scanned: 0, undecryptable: 0, mutated: 0 };
  }

  let undecryptable = 0;
  let mutated = 0;

  for (const row of rows) {
    let isValid = true;
    try {
      decryptCredential(row.apiKeyEncrypted, row.userId);
      decryptCredential(row.privateKeyEncrypted, row.userId);
    } catch {
      isValid = false;
    }

    if (!isValid) {
      undecryptable++;
      if (destructiveOptIn) {
        // Mark as disconnected — keep the encrypted blob in place so a
        // secret-rotation recovery can still re-decrypt later.  The
        // user will see a "reconnect" prompt because accountStatus is
        // no longer 'connected'.
        try {
          await database
            .update(kalshiCredentials)
            .set({ accountStatus: "disconnected" })
            .where(eq(kalshiCredentials.userId, row.userId));
          mutated++;
          logger.warn(
            { userId: row.userId },
            `[Database] Marked Kalshi credentials as disconnected (undecryptable) for user ${row.userId}. Encrypted blob preserved.`,
          );
        } catch (updateError) {
          logger.error(
            { err: updateError, userId: row.userId },
            `[Database] Failed to mark invalid credentials disconnected for user ${row.userId}`,
          );
        }
      } else {
        // Default: log only.  The credential row stays intact; the user
        // can still attempt to use it on their next API call (and will
        // see a clear "decryption failed" error if it really is broken).
        logger.warn(
          { userId: row.userId },
          `[Database] Kalshi credentials for user ${row.userId} failed decryption at startup.  ` +
            `Row preserved (set CLEAR_INVALID_KALSHI_CREDENTIALS=true to actively disconnect).  ` +
            `If the user reports trade failures, verify CREDENTIAL_ENCRYPTION_SECRET hasn't drifted.`,
        );
      }
    }
  }

  if (undecryptable > 0) {
    logger.warn(
      { scanned: rows.length, undecryptable, mutated, destructiveOptIn },
      destructiveOptIn
        ? `[Database] Credential cleanup: marked ${mutated}/${undecryptable} undecryptable Kalshi rows as disconnected.`
        : `[Database] Credential cleanup: ${undecryptable} row(s) failed decryption.  Preserved (default non-destructive mode).`,
    );
  } else {
    logger.info(
      `[Database] Credential cleanup: all ${rows.length} stored Kalshi credentials decrypted successfully.`,
    );
  }

  return { scanned: rows.length, undecryptable, mutated };
}
