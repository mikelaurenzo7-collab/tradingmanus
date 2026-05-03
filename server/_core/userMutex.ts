/**
 * Per-user async mutex.
 *
 * Node.js is single-threaded, but `await`-points allow interleaving: two
 * concurrent `placeOrder` calls for the same user can both reach the risk
 * checks before either one has committed a position, then both proceed
 * past those checks simultaneously.  Wrapping the check-and-execute
 * block with `withUserLock(userId, fn)` serialises it per user so the
 * second call only starts its checks once the first call has finished,
 * by which point the updated balances/positions are already visible.
 *
 * Lock granularity is per-user so different users never block each other.
 * The implementation is an in-process promise queue; no external state
 * (Redis, DB advisory locks) is required.
 */

/** Resolves when the current holder releases the lock. */
type Release = () => void;

const locks = new Map<number, Promise<void>>();

/**
 * Acquire a per-user lock, run `fn`, then release.
 * Throws (and always releases) if `fn` throws.
 */
export async function withUserLock<T>(userId: number, fn: () => Promise<T>): Promise<T> {
  // Wait for any in-flight holder to finish before acquiring.
  const previous = locks.get(userId) ?? Promise.resolve();
  let release!: Release;
  const current = previous.then(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  locks.set(userId, current);

  try {
    await previous;
    return await fn();
  } finally {
    release();
    // Clean up the map once all waiters have been notified.
    if (locks.get(userId) === current) {
      locks.delete(userId);
    }
  }
}
