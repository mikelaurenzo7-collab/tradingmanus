import "dotenv/config";
import { createServer } from "http";
import net from "net";
import { createApp, scopeScheduledUsersToTrigger } from "./app";
import { serveStatic, setupVite } from "./vite";
import { getUsersEligibleForAutomaticScheduledTrading } from "../db";
import { runScheduledAutonomousTradingBatch } from "./kalshiAutonomy";
import { syncPendingOrders, syncLivePositions } from "./kalshiOrderSync";
import { createAutonomousTradingLock, createOrderSyncLock } from "./distributedLock";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = await createApp({ runStartupMigrations: false });
  const server = createServer(app);

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

const AUTONOMOUS_TRADING_INTERVAL_MS = 15 * 60 * 1000;
const ORDER_SYNC_INTERVAL_MS = 30 * 1000;

async function runAutonomousScheduler() {
  try {
    const eligibleUsers = await getUsersEligibleForAutomaticScheduledTrading();
    // Mirror the HTTP handler: scope to the configured owner only.
    const scopedUsers = scopeScheduledUsersToTrigger(
      eligibleUsers as Array<{ id: number; openId: string; email?: string | null }>,
      "local_scheduler"
    );

    const ownerUser = scopedUsers[0];
    if (!ownerUser) return;

    const lock = createAutonomousTradingLock(ownerUser.id);
    const acquired = await lock.acquire({ ttlMs: 5 * 60 * 1000 });
    if (!acquired) {
      console.log("[Scheduler] Autonomous trading already in progress, skipping");
      return;
    }

    try {
      console.log(`[Scheduler] Running autonomous trading for ${scopedUsers.length} eligible user(s)`);
      await runScheduledAutonomousTradingBatch(scopedUsers as any, "local_scheduler");
    } finally {
      await lock.release();
    }
  } catch (error) {
    console.error("[Scheduler] Autonomous trading run failed:", error);
  }
}

async function runOrderSync() {
  try {
    const eligibleUsers = await getUsersEligibleForAutomaticScheduledTrading();
    const scopedUsers = scopeScheduledUsersToTrigger(
      eligibleUsers as Array<{ id: number; openId: string; email?: string | null }>,
      "local_scheduler"
    );

    for (const user of scopedUsers as Array<{ id: number; openId: string }>) {
      const lock = createOrderSyncLock(user.id);
      const acquired = await lock.acquire({ ttlMs: 60 * 1000 });
      if (!acquired) {
        console.log(`[OrderSync] Sync already in progress for user ${user.id}, skipping`);
        continue;
      }

      try {
        await syncPendingOrders(user.id);
        await syncLivePositions(user.id);
      } catch (err) {
        console.error(`[OrderSync] Sync failed for user ${user.id}:`, err);
      } finally {
        await lock.release();
      }
    }
  } catch (error) {
    console.error("[OrderSync] Order sync run failed:", error);
  }
}

startServer().then(() => {
  setInterval(runAutonomousScheduler, AUTONOMOUS_TRADING_INTERVAL_MS);
  setInterval(runOrderSync, ORDER_SYNC_INTERVAL_MS);
  setTimeout(runAutonomousScheduler, 2 * 60 * 1000);
  console.log("[Scheduler] Autonomous trading scheduler started (15-min interval)");
  console.log("[OrderSync] Order sync started (30-sec interval)");
}).catch(console.error);
