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
import { getDb } from "../db";
import { sdk } from "./sdk";
import { runScheduledAutonomousTrading } from "./kalshiAutonomy";

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
    res.json({ status: "ok" });
  });

  app.post("/api/scheduled/autonomous-trading", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);

      if (!user) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      if (user.role !== "user" && user.role !== "admin") {
        res.status(403).json({ success: false, error: "Forbidden" });
        return;
      }

      const result = await runScheduledAutonomousTrading(user);
      const statusCode = result.status === "error" ? 500 : 200;
      res.status(statusCode).json(result);
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

startServer().catch(console.error);
