import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { validateServerEnv, ENV } from "./env";
import { getDb, runMigrations, getUsersEligibleForAutomaticScheduledTrading, pingDb } from "../db";
import { authenticateRequest } from "./auth";
import { runScheduledAutonomousTradingBatch } from "./kalshiAutonomy";
import { syncPendingOrders, syncLivePositions } from "./kalshiOrderSync";
import { logger } from "./logger";
import { correlationIdMiddleware } from "./correlationId";
import { apiLimiter, authLimiter, scheduledLimiter } from "./rateLimiter";
import { csrfProtection } from "./csrf";
import { createAutonomousTradingLock, createOrderSyncLock } from "./distributedLock";

type AppRequest = IncomingMessage & {
  headers: IncomingHttpHeaders;
  protocol?: string;
};

type AppResponse = ServerResponse & {
  status(code: number): AppResponse;
  json(body: unknown): AppResponse;
};

type AsyncRouteHandler = (req: AppRequest, res: AppResponse) => Promise<void>;
type EligibleScheduledUser = {
  id: number;
  openId: string;
  email?: string | null;
};

function toExpressHandler(handler: AsyncRouteHandler) {
  return (req: unknown, res: unknown) => {
    void handler(req as AppRequest, res as AppResponse);
  };
}

function readBearerToken(req: AppRequest) {
  const header = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

async function getScheduledTrigger(req: AppRequest) {
  const bearer = readBearerToken(req);
  if (ENV.cronSecret && bearer === ENV.cronSecret) {
    return { authorized: true as const, openId: "vercel_cron" };
  }

  const requester = await authenticateRequest(req);
  if (!requester) {
    return { authorized: false as const, status: 401, error: "Authentication required" };
  }

  if (requester.role !== "user" && requester.role !== "admin") {
    return { authorized: false as const, status: 403, error: "Forbidden" };
  }

  return { authorized: true as const, openId: requester.openId };
}

export function scopeScheduledUsersToTrigger(
  users: EligibleScheduledUser[],
  triggerOpenId: string
) {
  // Both the Vercel cron trigger and the local Node.js scheduler scope
  // execution to the configured owner only.
  if (triggerOpenId === "vercel_cron" || triggerOpenId === "local_scheduler") {
    const ownerEmail = ENV.ownerEmail.trim().toLowerCase();
    if (!ownerEmail) {
      return users;
    }

    const owner = users.find((user) => String(user.email ?? "").trim().toLowerCase() === ownerEmail);
    return owner ? [owner] : [];
  }

  return users.filter((user) => user.openId === triggerOpenId);
}

async function autonomousTradingHandler(req: AppRequest, res: AppResponse) {
  try {
    const trigger = await getScheduledTrigger(req);
    if (!trigger.authorized) {
      res.status(trigger.status).json({ success: false, error: trigger.error });
      return;
    }

    const eligibleUsers = await getUsersEligibleForAutomaticScheduledTrading();
    const scopedUsers = scopeScheduledUsersToTrigger(
      eligibleUsers as EligibleScheduledUser[],
      trigger.openId
    );

    if (scopedUsers.length === 0) {
      res.json({
        success: true,
        mode: "eligible_users_autonomous_trading",
        triggeredByOpenId: trigger.openId,
        eligibleUsers: eligibleUsers.length,
        processedUsers: 0,
        successfulUsers: 0,
        skippedUsers: 0,
        blockedUsers: 0,
        errorUsers: 0,
        results: [],
        reason: "No eligible scheduled users matched trigger scope (owner/requester).",
      });
      return;
    }

    // Use distributed lock to prevent concurrent autonomous trading runs
    const ownerUser = scopedUsers[0];
    if (ownerUser) {
      const lock = createAutonomousTradingLock(ownerUser.id);
      // Cron fires every minute. TTL must be < cron interval so a stuck lock
      // can't block the next cycle, but long enough that a normal review
      // (Claude call + order placement) finishes inside it.
      const acquired = await lock.acquire({ ttlMs: 50 * 1000 });

      if (!acquired) {
        logger.warn(
          { userId: ownerUser.id, triggeredBy: trigger.openId },
          "Autonomous trading already in progress, skipping"
        );
        res.json({
          success: true,
          mode: "eligible_users_autonomous_trading",
          triggeredByOpenId: trigger.openId,
          eligibleUsers: eligibleUsers.length,
          processedUsers: 0,
          successfulUsers: 0,
          skippedUsers: scopedUsers.length,
          blockedUsers: 0,
          errorUsers: 0,
          results: [],
          reason: "Autonomous trading already in progress (distributed lock held).",
        });
        return;
      }

      try {
        const summary = await runScheduledAutonomousTradingBatch(
          scopedUsers as any,
          trigger.openId
        );

        const statusCode = summary.errorUsers > 0 && summary.processedUsers === summary.errorUsers ? 500 : 200;
        res.status(statusCode).json(summary);
      } finally {
        await lock.release();
      }
    } else {
      const summary = await runScheduledAutonomousTradingBatch(
        scopedUsers as any,
        trigger.openId
      );

      const statusCode = summary.errorUsers > 0 && summary.processedUsers === summary.errorUsers ? 500 : 200;
      res.status(statusCode).json(summary);
    }
  } catch (error) {
    logger.error({ error }, "ScheduledAutonomy route error");
    res.status(500).json({
      success: false,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function orderSyncHandler(req: AppRequest, res: AppResponse) {
  try {
    const trigger = await getScheduledTrigger(req);
    if (!trigger.authorized) {
      res.status(trigger.status).json({ success: false, error: trigger.error });
      return;
    }

    const eligibleUsers = await getUsersEligibleForAutomaticScheduledTrading();
    const scopedUsers = scopeScheduledUsersToTrigger(
      eligibleUsers as EligibleScheduledUser[],
      trigger.openId
    );
    const results = [];

    for (const user of scopedUsers as Array<{ id: number; openId: string }>) {
      // Use distributed lock to prevent concurrent order syncs for the same user
      const lock = createOrderSyncLock(user.id);
      // Cron fires every minute; keep TTL just under that so the lock
      // can't outlive its own cycle.
      const acquired = await lock.acquire({ ttlMs: 50 * 1000 });

      if (!acquired) {
        logger.warn(
          { userId: user.id, triggeredBy: trigger.openId },
          "Order sync already in progress, skipping"
        );
        results.push({
          userId: user.id,
          openId: user.openId,
          success: false,
          skipped: true,
          error: "Order sync already in progress",
        });
        continue;
      }

      try {
        await syncPendingOrders(user.id);
        await syncLivePositions(user.id);
        results.push({ userId: user.id, openId: user.openId, success: true });
      } catch (error) {
        logger.error({ error, userId: user.id }, "OrderSync failed for user");
        results.push({
          userId: user.id,
          openId: user.openId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await lock.release();
      }
    }

    res.json({
      success: results.every((result) => result.success),
      mode: "eligible_users_order_sync",
      triggeredByOpenId: trigger.openId,
      eligibleUsers: eligibleUsers.length,
      scopedUsers: scopedUsers.length,
      processedUsers: results.length,
      results,
    });
  } catch (error) {
    logger.error({ error }, "OrderSync route error");
    res.status(500).json({
      success: false,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createApp(options: { runStartupMigrations?: boolean } = {}) {
  validateServerEnv();
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection failed during startup");
  }
  if (options.runStartupMigrations) {
    await runMigrations();
  }

  const app = express();
  app.set("trust proxy", true);

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: ENV.isProduction ? undefined : false, // Disable CSP in dev for HMR
    crossOriginEmbedderPolicy: false, // Allow embedding for iframe support
  }));

  // CORS configuration
  app.use(cors({
    origin: ENV.isProduction
      ? [/^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/, /^https:\/\/(?:[a-zA-Z0-9-]+\.)?tradingmanus\.com$/]
      : ["http://localhost:5008", "http://127.0.0.1:5008"],
    credentials: true,
  }));

  // Cookie parser for CSRF tokens and session cookies
  app.use(cookieParser());

  // Correlation ID middleware for request tracing
  app.use(correlationIdMiddleware);

  // Body parsers — keep limits tight for a trading API.
  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ limit: "100kb", extended: true }));

  // Rate limiting for API endpoints
  app.use("/api/trpc", apiLimiter);

  // Auth endpoints get a stricter limiter to block brute-force credential attacks.
  app.use("/api/trpc/auth.login", authLimiter);
  app.use("/api/trpc/auth.refreshToken", authLimiter);

  // CSRF protection for all state-changing tRPC calls (GET/HEAD/OPTIONS are exempt).
  app.use("/api/trpc", csrfProtection);

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  app.get("/api/health", async (_req: unknown, res: unknown) => {
    const startMs = Date.now();
    let dbStatus: "ok" | "error" = "ok";
    let dbLatencyMs: number | null = null;

    try {
      const t0 = Date.now();
      const alive = await pingDb();
      dbLatencyMs = Date.now() - t0;
      if (!alive) dbStatus = "error";
    } catch {
      dbStatus = "error";
    }

    const overall = dbStatus === "ok" ? "ok" : "degraded";
    const statusCode = overall === "ok" ? 200 : 503;

    (res as AppResponse).status(statusCode).json({
      status: overall,
      runtime: process.env.VERCEL ? "vercel" : "node",
      scheduler: process.env.VERCEL ? "vercel-cron" : "node-interval",
      interval_minutes: 15,
      checks: {
        database: {
          status: dbStatus,
          latencyMs: dbLatencyMs,
        },
      },
      uptimeMs: process.uptime() * 1000,
      responseMs: Date.now() - startMs,
    });
  });

  // Apply rate limiting to scheduled endpoints
  app.all("/api/scheduled/autonomous-trading", scheduledLimiter, toExpressHandler(autonomousTradingHandler));
  app.all("/api/scheduled/order-sync", scheduledLimiter, toExpressHandler(orderSyncHandler));

  // Global error handler
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error(
      {
        error: err,
        path: req.path,
        method: req.method,
      },
      "Unhandled error"
    );
    res.status(500).json({
      error: "Internal server error",
      message: ENV.isProduction ? "An unexpected error occurred" : err.message,
    });
  });

  logger.info(
    {
      nodeEnv: process.env.NODE_ENV,
      runtime: process.env.VERCEL ? "vercel" : "node",
    },
    "Application initialized successfully"
  );

  return app;
}
