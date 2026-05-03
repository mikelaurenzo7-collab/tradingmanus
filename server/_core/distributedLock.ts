import { logger } from "./logger";
import { getDb } from "../db";
import { distributedLocks } from "../../drizzle/schema";
import { and, eq, lt } from "drizzle-orm";
import { nanoid } from "nanoid";

export interface LockOptions {
  ttlMs?: number; // Time to live in milliseconds
  retryCount?: number; // Number of retry attempts
  retryDelayMs?: number; // Delay between retries
}

const DEFAULT_TTL_MS = 60000; // 1 minute
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_DELAY_MS = 100;

/**
 * Table-based distributed locking for autonomous trading coordination.
 *
 * Uses a `distributedLocks` database table instead of PostgreSQL advisory
 * locks.  Advisory locks are session-scoped in PostgreSQL, but the Neon
 * serverless HTTP driver issues each query on a fresh connection, so the lock
 * would be released before the guarded work even starts.  A table row is
 * durable across separate HTTP round-trips and survives connection pool churn.
 *
 * Acquire logic:
 *  1. Delete any expired row for the same key (stale-lock cleanup).
 *  2. INSERT the new lock row; rely on the PRIMARY KEY constraint to reject a
 *     duplicate if the key is already held.  One row in the table == lock held.
 *
 * Release logic:
 *  DELETE the row for the key so the next caller can acquire it.
 */
export class DistributedLock {
  private lockKey: string;
  private acquiredBy: string | null = null;
  // Generation counter prevents a stale TTL timeout from releasing a lock
  // that was already released and re-acquired on the same instance.
  private generation = 0;
  private autoReleaseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(lockKey: string) {
    this.lockKey = lockKey;
  }

  /**
   * Acquire the lock.  Returns true when the lock is held, false otherwise.
   */
  async acquire(options: LockOptions = {}): Promise<boolean> {
    const {
      ttlMs = DEFAULT_TTL_MS,
      retryCount = DEFAULT_RETRY_COUNT,
      retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    } = options;

    const holderId = nanoid(16);

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        const db = await getDb();
        if (!db) {
          logger.error("Database not available for lock acquisition");
          return false;
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + ttlMs);

        // 1. Reap any expired lock row so the INSERT below can succeed.
        await db
          .delete(distributedLocks)
          .where(lt(distributedLocks.expiresAt, now));

        // 2. Attempt to insert; the PRIMARY KEY constraint prevents a second
        //    holder from inserting while a valid row already exists.
        const inserted = await db
          .insert(distributedLocks)
          .values({
            lockKey: this.lockKey,
            acquiredAt: now,
            expiresAt,
            acquiredBy: holderId,
          })
          .onConflictDoNothing()
          .returning({ lockKey: distributedLocks.lockKey });

        const acquired = inserted.length > 0;

        if (acquired) {
          this.acquiredBy = holderId;
          const currentGeneration = ++this.generation;

          logger.debug(
            { lockKey: this.lockKey, holderId, attempt: attempt + 1 },
            "Lock acquired"
          );

          // Auto-release after TTL to avoid permanently stuck locks.
          // The generation check ensures this timer only fires if this
          // acquisition is still the current one.  We unref() so a pending
          // timer never keeps the Node event loop alive past shutdown.
          const timer = setTimeout(() => {
            if (this.generation === currentGeneration) {
              this.release().catch((error) => {
                logger.error(
                  { error, lockKey: this.lockKey },
                  "Failed to auto-release lock after TTL"
                );
              });
            }
          }, ttlMs);
          if (typeof timer.unref === "function") {
            timer.unref();
          }
          this.autoReleaseTimer = timer;

          return true;
        }

        if (attempt < retryCount) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      } catch (error) {
        logger.error(
          { error, lockKey: this.lockKey, attempt: attempt + 1 },
          "Error acquiring lock"
        );
      }
    }

    logger.warn(
      { lockKey: this.lockKey, retryCount },
      "Failed to acquire lock after retries"
    );
    return false;
  }

  /**
   * Release the lock.  Clears the holder state before the async DB call so
   * concurrent calls on the same instance cannot double-delete.  The DELETE
   * is scoped to `acquiredBy = holderId` so a late release from a previous
   * holder (whose TTL had expired and the row has already been re-acquired
   * by someone else) cannot wipe the successor's lock — this is "fencing":
   * each lock acquisition can only ever delete its own row.
   */
  async release(): Promise<void> {
    const holderId = this.acquiredBy;
    if (holderId === null) {
      return;
    }

    // Clear immediately to prevent concurrent release calls and to disarm
    // the auto-release timer.
    this.acquiredBy = null;
    if (this.autoReleaseTimer) {
      clearTimeout(this.autoReleaseTimer);
      this.autoReleaseTimer = null;
    }

    try {
      const db = await getDb();
      if (!db) {
        logger.error("Database not available for lock release");
        return;
      }

      await db
        .delete(distributedLocks)
        .where(
          and(
            eq(distributedLocks.lockKey, this.lockKey),
            eq(distributedLocks.acquiredBy, holderId)
          )
        );

      logger.debug({ lockKey: this.lockKey, holderId }, "Lock released");
    } catch (error) {
      logger.error({ error, lockKey: this.lockKey }, "Error releasing lock");
    }
  }

  /**
   * Execute a function while holding the lock.
   */
  async withLock<T>(
    fn: () => Promise<T>,
    options?: LockOptions
  ): Promise<T | null> {
    const acquired = await this.acquire(options);
    if (!acquired) {
      logger.warn(
        { lockKey: this.lockKey },
        "Could not acquire lock, skipping execution"
      );
      return null;
    }

    try {
      return await fn();
    } finally {
      await this.release();
    }
  }
}

/**
 * Create a distributed lock for autonomous trading per user
 */
export function createAutonomousTradingLock(userId: number): DistributedLock {
  return new DistributedLock(`autonomous_trading_user_${userId}`);
}

/**
 * Create a distributed lock for order synchronization per user
 */
export function createOrderSyncLock(userId: number): DistributedLock {
  return new DistributedLock(`order_sync_user_${userId}`);
}

/**
 * Create a distributed lock for market data updates
 */
export function createMarketDataLock(marketId: string): DistributedLock {
  return new DistributedLock(`market_data_${marketId}`);
}
