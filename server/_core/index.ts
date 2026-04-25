import "dotenv/config";
import { createServer } from "http";
import net from "net";
import { createApp } from "./app";
import { serveStatic, setupVite } from "./vite";
import { getUsersEligibleForAutomaticScheduledTrading } from "../db";
import { runScheduledAutonomousTradingBatch } from "./kalshiAutonomy";
import { syncPendingOrders, syncLivePositions } from "./kalshiOrderSync";

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
    if (eligibleUsers.length > 0) {
      console.log(`[Scheduler] Running autonomous trading for ${eligibleUsers.length} eligible user(s)`);
      await runScheduledAutonomousTradingBatch(eligibleUsers as any, "local_scheduler");
    }
  } catch (error) {
    console.error("[Scheduler] Autonomous trading run failed:", error);
  }
}

async function runOrderSync() {
  try {
    const eligibleUsers = await getUsersEligibleForAutomaticScheduledTrading();
    for (const user of eligibleUsers) {
      try {
        await syncPendingOrders((user as any).id);
        await syncLivePositions((user as any).id);
      } catch (err) {
        console.error(`[OrderSync] Sync failed for user ${(user as any).id}:`, err);
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
