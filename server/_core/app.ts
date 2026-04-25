import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { validateServerEnv, ENV } from "./env";
import { getDb, runMigrations, getUsersEligibleForAutomaticScheduledTrading } from "../db";
import { authenticateRequest } from "./auth";
import { runScheduledAutonomousTradingBatch } from "./kalshiAutonomy";
import { syncPendingOrders, syncLivePositions } from "./kalshiOrderSync";

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
  if (triggerOpenId === "vercel_cron") {
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

    const summary = await runScheduledAutonomousTradingBatch(
      scopedUsers as any,
      trigger.openId
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
      try {
        await syncPendingOrders(user.id);
        await syncLivePositions(user.id);
        results.push({ userId: user.id, openId: user.openId, success: true });
      } catch (error) {
        console.error(`[OrderSync] Sync failed for user ${user.id}:`, error);
        results.push({
          userId: user.id,
          openId: user.openId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
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
    console.error("[OrderSync] Route error:", error);
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
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  app.get("/api/health", (_req: unknown, res: unknown) => {
    (res as AppResponse).json({
      status: "ok",
      runtime: process.env.VERCEL ? "vercel" : "node",
      scheduler: process.env.VERCEL ? "vercel-cron" : "node-interval",
      interval_minutes: 15,
    });
  });

  app.all("/api/scheduled/autonomous-trading", toExpressHandler(autonomousTradingHandler));
  app.all("/api/scheduled/order-sync", toExpressHandler(orderSyncHandler));

  return app;
}
