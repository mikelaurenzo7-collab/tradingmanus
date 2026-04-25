import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { validateServerEnv } from "./env";
import { getDb, runMigrations, getUsersEligibleForAutomaticScheduledTrading } from "../db";
import { sdk } from "./sdk";
import { runScheduledAutonomousTrading, runScheduledAutonomousTradingBatch } from "./kalshiAutonomy";
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
  validateServerEnv();
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection failed during startup");
  }
  await runMigrations();

  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", scheduler: "running", interval_minutes: 15 });
  });

  app.post("/api/scheduled/autonomous-trading", async (req, res) => {
    try {
      const requester = await sdk.authenticateRequest(req);

      if (!requester) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      if (requester.role !== "user" && requester.role !== "admin") {
        res.status(403).json({ success: false, error: "Forbidden" });
        return;
      }

      const eligibleUsers = await getUsersEligibleForAutomaticScheduledTrading();
      const summary = await runScheduledAutonomousTradingBatch(
        eligibleUsers as any,
        requester.openId
      );

      const statusCode = summary.errorUsers > 0 && summary.processedUsers === summary.errorUsers ? 500 : 200;
      res.status(statusCode).json(summary);
    } catch (error) {
      console.error("[ScheduledAutonomy] Route error:", error);
      res.status(500).json({
        success: false,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  // development mode uses Vite, production mode uses static files
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
      await runScheduledAutonomousTradingBatch(eligibleUsers as any, "system_scheduler");
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
  // Give server 2 minutes to stabilize before first autonomous run
  setTimeout(runAutonomousScheduler, 2 * 60 * 1000);
  console.log("[Scheduler] Autonomous trading scheduler started (15-min interval)");
  console.log("[OrderSync] Order sync started (30-sec interval)");
}).catch(console.error);
