import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { validateServerEnv, ENV } from "./env";
import { getDb, runMigrations, getUsersEligibleForAutomaticScheduledTrading, checkDbHealth } from "../db";
import { authenticateRequest } from "./auth";
import { runScheduledAutonomousTradingBatch } from "./kalshiAutonomy";
import { syncPendingOrders, syncLivePositions } from "./kalshiOrderSync";
import { logger } from "./logger";
import { correlationIdMiddleware } from "./correlationId";
import {
  apiLimiter,
  authLimiter,
  scheduledLimiter,
  tradingLimiter,
} from "./rateLimiter";
import { csrfProtection, issueCsrfToken } from "./csrf";
import { createAutonomousTradingLock, createOrderSyncLock } from "./distributedLock";
import { clearInvalidKalshiCredentials } from "../db.kalshi-credentials";

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
      const acquired = await lock.acquire({ ttlMs: 5 * 60 * 1000 }); // 5 minute timeout

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
      const acquired = await lock.acquire({ ttlMs: 60 * 1000 }); // 1 minute timeout

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

  // Purge any Kalshi credentials that cannot be decrypted with the current
  // CREDENTIAL_ENCRYPTION_SECRET.  This is a no-op when all credentials are
  // valid, and safely removes corrupted/stale rows when the secret has changed.
  // Affected users will be prompted to re-authenticate on their next visit.
  try {
    await clearInvalidKalshiCredentials();
  } catch (cleanupError) {
    // Never let credential cleanup crash the server startup.
    logger.warn({ error: cleanupError }, "[Startup] Kalshi credential cleanup encountered an error");
  }

  const app = express();
  // Trust exactly one proxy hop (Railway/Vercel ingress).  Setting this to
  // `true` (all hops) allows clients to spoof X-Forwarded-For, which would
  // bypass IP-based rate limiting.
  app.set("trust proxy", 1);

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: ENV.isProduction ? undefined : false, // Disable CSP in dev for HMR
    // COEP defaults to require-corp in helmet >= 5.  We keep that strict default
    // because the client does not embed cross-origin iframes (verified via grep).
    // If a future feature needs to embed third-party widgets, scope this to that
    // route only rather than disabling globally.
  }));

  // CORS configuration
  const productionOrigins: (string | RegExp)[] = [
    /^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/,
  ];
  if (ENV.allowedOrigin) {
    productionOrigins.push(ENV.allowedOrigin);
  }
  app.use(cors({
    origin: ENV.isProduction
      ? productionOrigins
      : ["http://localhost:5008", "http://127.0.0.1:5008"],
    credentials: true,
  }));

  // Cookie parser for CSRF tokens and session cookies
  app.use(cookieParser());
  app.use(issueCsrfToken);

  // Correlation ID middleware for request tracing
  app.use(correlationIdMiddleware);

  // Body parsers — keep limits tight for a trading API.
  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ limit: "100kb", extended: true }));

  // Extra protection for high-risk trading mutation endpoints. tRPC batch URLs
  // include the procedure path in the URL, so this also catches batched calls
  // that contain one of these mutation names.
  app.use(
    /\/api\/trpc\/.*(?:kalshi\.placeOrder|kalshi\.cancelOrder|kalshi\.killSwitch|kalshi\.setTradingActivation|polymarket\.placeOrder|polymarket\.runAutonomousTrading)/,
    tradingLimiter
  );

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

  // Liveness probe — used by Railway/Kubernetes healthchecks.  Returns 200
  // as long as the Node process is responding.  Crucially this does NOT
  // touch the database, so a degraded Neon endpoint cannot trigger an
  // infinite restart loop (which manifests to clients as a 502).
  app.get("/api/health/live", (_req: unknown, res: unknown) => {
    (res as AppResponse).status(200).json({
      status: "ok",
      uptimeMs: process.uptime() * 1000,
    });
  });

  // Readiness probe — checks that the database is actually reachable.  Use
  // this from monitoring dashboards / external uptime checks, not from the
  // platform restart policy.
  app.get("/api/health/ready", async (_req: unknown, res: unknown) => {
    const startMs = Date.now();
    const db = await checkDbHealth();
    const overall = db.status === "ok" ? "ok" : "degraded";
    (res as AppResponse).status(overall === "ok" ? 200 : 503).json({
      status: overall,
      checks: { database: { status: db.status, latencyMs: db.latencyMs } },
      responseMs: Date.now() - startMs,
    });
  });

  // Backwards-compatible combined health endpoint.  Always returns 200 so
  // long as the process is up; DB health is reported in the body so
  // observers can still see when the database is degraded without taking
  // the entire deployment down.
  app.get("/api/health", async (_req: unknown, res: unknown) => {
    const startMs = Date.now();
    const db = await checkDbHealth();
    (res as AppResponse).status(200).json({
      status: db.status === "ok" ? "ok" : "degraded",
      runtime: process.env.VERCEL ? "vercel" : "node",
      scheduler: process.env.VERCEL ? "vercel-cron" : "node-interval",
      interval_minutes: 15,
      checks: {
        database: {
          status: db.status,
          latencyMs: db.latencyMs,
        },
      },
      uptimeMs: process.uptime() * 1000,
      responseMs: Date.now() - startMs,
    });
  });

  // Scheduled endpoints: Vercel cron fires GET; manual dashboard triggers use POST.
  // Restrict to these two methods to limit attack surface.
  app.get("/api/scheduled/autonomous-trading", scheduledLimiter, toExpressHandler(autonomousTradingHandler));
  app.post("/api/scheduled/autonomous-trading", scheduledLimiter, toExpressHandler(autonomousTradingHandler));
  app.get("/api/scheduled/order-sync", scheduledLimiter, toExpressHandler(orderSyncHandler));
  app.post("/api/scheduled/order-sync", scheduledLimiter, toExpressHandler(orderSyncHandler));

  // Global error handler
  // Note: express.Request types can resolve inconsistently in some build
  // environments (e.g. Vercel's @vercel/node may surface the global Web
  // `Request` type instead of the express one, causing TS2339 on `req.url`).
  // Reading the URL/method via the underlying Node IncomingMessage avoids
  // any dependency on @types/express resolution at this call site.
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const incoming = req as IncomingMessage;
    logger.error(
      {
        error: err,
        path: incoming.url,
        method: incoming.method,
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
