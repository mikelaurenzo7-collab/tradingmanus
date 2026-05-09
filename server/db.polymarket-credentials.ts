import { polymarketCredentials, userPlatformSubscriptions } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { encryptCredential, decryptCredential } from "./_core/kalshiAuth";
import { logger } from "./_core/logger";

/**
 * Save Polymarket CLOB credentials for a user.  All four encrypted columns
 * + funder address + signature type are required for live order placement;
 * legacy 3-arg callers (read-only setups) still work with `walletPrivateKey`
 * / `walletAddress` left undefined — the order-signing path will fail with
 * a clear error in that case rather than silently rejecting at the API.
 */
export async function savePolymarketCredentials(
  userId: number,
  apiKey: string,
  apiSecret: string,
  apiPassphrase: string,
  options: {
    walletPrivateKey?: string;
    walletAddress?: string;
    /** 0=EOA, 1=POLY_PROXY (default — Polymarket UI), 2=POLY_GNOSIS_SAFE. */
    signatureType?: number;
  } = {},
) {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not initialized");
  }

  const encryptedApiKey = encryptCredential(apiKey, userId);
  const encryptedApiSecret = encryptCredential(apiSecret, userId);
  const encryptedApiPassphrase = encryptCredential(apiPassphrase, userId);
  const encryptedWalletPrivateKey = options.walletPrivateKey
    ? encryptCredential(options.walletPrivateKey, userId)
    : null;
  const walletAddress = options.walletAddress?.trim() || null;
  const signatureType = Number.isFinite(options.signatureType)
    ? Number(options.signatureType)
    : 1;

  try {
    await database
      .insert(polymarketCredentials)
      .values({
        userId,
        apiKeyEncrypted: encryptedApiKey,
        apiSecretEncrypted: encryptedApiSecret,
        apiPassphraseEncrypted: encryptedApiPassphrase,
        walletPrivateKeyEncrypted: encryptedWalletPrivateKey,
        walletAddress,
        signatureType,
        accountStatus: "connected",
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: polymarketCredentials.userId,
        set: {
          apiKeyEncrypted: encryptedApiKey,
          apiSecretEncrypted: encryptedApiSecret,
          apiPassphraseEncrypted: encryptedApiPassphrase,
          // Only overwrite wallet fields when the caller actually supplied
          // them.  Lets a credential rotation that only touches API key
          // leave the existing wallet-key untouched.
          ...(encryptedWalletPrivateKey
            ? { walletPrivateKeyEncrypted: encryptedWalletPrivateKey }
            : {}),
          ...(walletAddress ? { walletAddress } : {}),
          ...(Number.isFinite(options.signatureType) ? { signatureType } : {}),
          accountStatus: "connected",
          lastSyncedAt: new Date(),
        },
      });

    return { success: true };
  } catch (error) {
    logger.error({ err: error }, "[Database] Save Polymarket credentials failed");
    throw error;
  }
}

/**
 * Get Polymarket credentials for a user (decrypted)
 */
export async function getPolymarketCredentials(userId: number) {
  const database = await getDb();
  if (!database) {
    return null;
  }

  try {
    const result = await database
      .select()
      .from(polymarketCredentials)
      .where(eq(polymarketCredentials.userId, userId))
      .limit(1);

    if (!result || result.length === 0) {
      return null;
    }

    const cred = result[0];
    return {
      id: cred.id,
      userId: cred.userId,
      apiKey: decryptCredential(cred.apiKeyEncrypted, cred.userId),
      apiSecret: decryptCredential(cred.apiSecretEncrypted, cred.userId),
      apiPassphrase: decryptCredential(cred.apiPassphraseEncrypted, cred.userId),
      // Wallet fields are nullable for backward compat; live order signing
      // will refuse to fire when these are missing and surface a clear
      // error instead of submitting an unsigned (rejectable) order.
      walletPrivateKey: cred.walletPrivateKeyEncrypted
        ? decryptCredential(cred.walletPrivateKeyEncrypted, cred.userId)
        : null,
      walletAddress: cred.walletAddress ?? null,
      signatureType: cred.signatureType ?? 1,
      accountStatus: cred.accountStatus,
      lastSyncedAt: cred.lastSyncedAt,
    };
  } catch (error) {
    logger.error({ err: error }, "[Database] Get Polymarket credentials failed");
    return null;
  }
}

/**
 * Update Polymarket account status
 */
export async function updatePolymarketAccountStatus(
  userId: number,
  status: "connected" | "disconnected" | "error",
) {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not initialized");
  }

  try {
    await database
      .update(polymarketCredentials)
      .set({
        accountStatus: status,
        lastSyncedAt: new Date(),
      })
      .where(eq(polymarketCredentials.userId, userId));

    return { success: true };
  } catch (error) {
    logger.error({ err: error }, "[Database] Update Polymarket account status failed");
    throw error;
  }
}

/**
 * Delete Polymarket credentials for a user
 */
export async function deletePolymarketCredentials(userId: number) {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not initialized");
  }

  try {
    await database
      .delete(polymarketCredentials)
      .where(eq(polymarketCredentials.userId, userId));

    return { success: true };
  } catch (error) {
    logger.error({ err: error }, "[Database] Delete Polymarket credentials failed");
    throw error;
  }
}

/**
 * Get or initialize platform subscriptions for a user
 */
export async function getPlatformSubscriptions(userId: number) {
  const database = await getDb();
  if (!database) {
    return { subscribedPlatforms: "kalshi" as const };
  }

  try {
    const result = await database
      .select()
      .from(userPlatformSubscriptions)
      .where(eq(userPlatformSubscriptions.userId, userId))
      .limit(1);

    if (!result || result.length === 0) {
      return { subscribedPlatforms: "kalshi" as const };
    }

    return { subscribedPlatforms: result[0].subscribedPlatforms };
  } catch (error) {
    logger.error({ err: error }, "[Database] Get platform subscriptions failed");
    return { subscribedPlatforms: "kalshi" as const };
  }
}

/**
 * Single-owner gate for whether the Polymarket pipeline should run.  Returns
 * true iff this user has connected Polymarket credentials with status
 * `connected`.  The previous multi-tenant `userPlatformSubscriptions` table
 * is no longer consulted — at single-owner scale, "connecting Polymarket
 * credentials" IS the subscription.  Name kept for call-site compatibility.
 */
export async function isUserSubscribedToPolymarket(userId: number): Promise<boolean> {
  const database = await getDb();
  if (!database) {
    return false;
  }

  try {
    const result = await database
      .select({ accountStatus: polymarketCredentials.accountStatus })
      .from(polymarketCredentials)
      .where(eq(polymarketCredentials.userId, userId))
      .limit(1);

    if (!result || result.length === 0) return false;
    return result[0].accountStatus === "connected";
  } catch (error) {
    logger.error({ err: error }, "[Database] isUserSubscribedToPolymarket check failed");
    return false;
  }
}

/**
 * Save platform subscriptions for a user
 */
export async function savePlatformSubscriptions(
  userId: number,
  subscribedPlatforms: "kalshi" | "polymarket" | "both",
) {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not initialized");
  }

  try {
    await database
      .insert(userPlatformSubscriptions)
      .values({ userId, subscribedPlatforms })
      .onConflictDoUpdate({
        target: userPlatformSubscriptions.userId,
        set: { subscribedPlatforms },
      });

    return { success: true, subscribedPlatforms };
  } catch (error) {
    logger.error({ err: error }, "[Database] Save platform subscriptions failed");
    throw error;
  }
}
