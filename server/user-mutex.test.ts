import { describe, expect, it } from "vitest";
import { withUserLock } from "./_core/userMutex";

describe("withUserLock", () => {
  it("runs a single task and returns its value", async () => {
    const result = await withUserLock(1, async () => 42);
    expect(result).toBe(42);
  });

  it("serialises concurrent tasks for the same user", async () => {
    const order: number[] = [];
    // Start two tasks concurrently for the same userId.
    // The second must not start until the first has finished.
    const p1 = withUserLock(1, async () => {
      order.push(1);
      // Yield so the event loop can try to start p2.
      await Promise.resolve();
      order.push(2);
    });
    const p2 = withUserLock(1, async () => {
      order.push(3);
    });
    await Promise.all([p1, p2]);
    // 3 must come after 2 because p2 waits for p1 to finish.
    expect(order).toEqual([1, 2, 3]);
  });

  it("does not serialise tasks for different users", async () => {
    const events: string[] = [];
    const p1 = withUserLock(1, async () => {
      events.push("u1-start");
      await Promise.resolve();
      events.push("u1-end");
    });
    const p2 = withUserLock(2, async () => {
      events.push("u2-start");
      await Promise.resolve();
      events.push("u2-end");
    });
    await Promise.all([p1, p2]);
    // Both tasks interleave: each starts before the other ends.
    expect(events[0]).toBe("u1-start");
    expect(events[1]).toBe("u2-start"); // u2 starts while u1 is yielded
    expect(events).toContain("u1-end");
    expect(events).toContain("u2-end");
  });

  it("releases the lock even when the task throws", async () => {
    await expect(
      withUserLock(1, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    // A subsequent task for the same user must not be blocked.
    const result = await withUserLock(1, async () => "ok");
    expect(result).toBe("ok");
  });

  it("queues more than two waiters correctly", async () => {
    const order: number[] = [];
    const tasks = [1, 2, 3, 4].map((n) =>
      withUserLock(5, async () => {
        order.push(n);
        await Promise.resolve();
      })
    );
    await Promise.all(tasks);
    expect(order).toEqual([1, 2, 3, 4]);
  });
});
