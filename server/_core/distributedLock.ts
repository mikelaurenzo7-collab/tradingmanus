import { logger } from "./logger";
import { getDb } from "../db";
import { sql } from "drizzle-orm";

export interface LockOptions {
  ttlMs?: number; // Time to live in milliseconds
  retryCount?: number; // Number of retry attempts
  retryDelayMs?: number; // Delay between retries
}

const DEFAULT_TTL_MS = 60000; // 1 minute
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_DELAY_MS = 100;

/**
 * Database-based distributed locking for autonomous trading
 * Uses PostgreSQL advisory locks for reliable distributed coordination
 */
export class DistributedLock {
  private lockKey: string;
  private lockId: number | null = null;

  constructor(lockKey: string) {
    this.lockKey = lockKey;
  }

  /**
   * Convert lock key string to integer for PostgreSQL advisory locks
   */
  private getLockId(): number {
    // Use simple hash to convert string to integer
    let hash = 0;
    for (let i = 0; i < this.lockKey.length; i++) {
      const char = this.lockKey.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Acquire the lock
   */
  async acquire(options: LockOptions = {}): Promise<boolean> {
    const {
      ttlMs = DEFAULT_TTL_MS,
      retryCount = DEFAULT_RETRY_COUNT,
      retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    } = options;

    this.lockId = this.getLockId();

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        const db = await getDb();
        if (!db) {
          logger.error("Database not available for lock acquisition");
          return false;
        }

        // Try to acquire PostgreSQL advisory lock
        const result = await db.execute(
          sql`SELECT pg_try_advisory_lock(${this.lockId}) as acquired`
        );

        const acquired = result.rows[0]?.acquired === true;

        if (acquired) {
          logger.debug(
            {
              lockKey: this.lockKey,
              lockId: this.lockId,
              attempt: attempt + 1,
            },
            "Lock acquired"
          );

          // Set up auto-release after TTL
          setTimeout(() => {
            this.release().catch((error) => {
              logger.error(
                { error, lockKey: this.lockKey },
                "Failed to auto-release lock after TTL"
              );
            });
          }, ttlMs);

          return true;
        }

        // If not last attempt, wait before retrying
        if (attempt < retryCount) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      } catch (error) {
        logger.error(
          {
            error,
            lockKey: this.lockKey,
            attempt: attempt + 1,
          },
          "Error acquiring lock"
        );
      }
    }

    logger.warn(
      {
        lockKey: this.lockKey,
        retryCount,
      },
      "Failed to acquire lock after retries"
    );
    return false;
  }

  /**
   * Release the lock
   */
  async release(): Promise<void> {
    if (this.lockId === null) {
      return;
    }

    try {
      const db = await getDb();
      if (!db) {
        logger.error("Database not available for lock release");
        return;
      }

      await db.execute(sql`SELECT pg_advisory_unlock(${this.lockId})`);

      logger.debug(
        {
          lockKey: this.lockKey,
          lockId: this.lockId,
        },
        "Lock released"
      );
    } catch (error) {
      logger.error(
        {
          error,
          lockKey: this.lockKey,
        },
        "Error releasing lock"
      );
    } finally {
      this.lockId = null;
    }
  }

  /**
   * Execute a function with the lock
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
