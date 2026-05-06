import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../server/_core/app";
import { logger } from "../server/_core/logger";

type ExpressLikeApp = {
  handle(req: IncomingMessage, res: ServerResponse): unknown;
};

let appPromise: Promise<ExpressLikeApp> | null = null;

// Vercel runs each cold start as a fresh Node process, but Node 18/20 defaults
// to `--unhandled-rejections=throw`, which terminates the process on any stray
// async rejection. When that happens mid-request, Vercel can't deliver our
// Express JSON error response and instead returns its plain-text platform crash
// page ("A server error has occurred / FUNCTION_INVOCATION_FAILED"). Express 4
// in particular does not auto-forward async middleware rejections to its error
// handler, so a single missed `await` anywhere in the request pipeline takes
// down the entire function.
//
// Register process-level guards once per cold start so unexpected rejections
// are logged and surfaced as ordinary 500 responses by Express's global error
// handler instead of crashing the runtime. We intentionally do NOT call
// `process.exit` — keeping the worker alive lets in-flight requests finish and
// subsequent requests reuse the cached app.
type GlobalWithGuards = typeof globalThis & {
  __processGuardsInstalled?: boolean;
};
const globalWithGuards = globalThis as GlobalWithGuards;
if (!globalWithGuards.__processGuardsInstalled) {
  globalWithGuards.__processGuardsInstalled = true;
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "[api/index] unhandledRejection");
  });
  process.on("uncaughtException", (error) => {
    logger.error({ err: error }, "[api/index] uncaughtException");
  });
}

function getApp() {
  if (!appPromise) {
    appPromise = createApp({ runStartupMigrations: false })
      .then((app) => app as unknown as ExpressLikeApp)
      .catch((error) => {
        // Reset the cache so the next invocation can retry instead of being stuck
        // on a permanently-rejected promise within this container's lifetime.
        appPromise = null;
        throw error;
      });
  }
  return appPromise;
}

// Vercel's serverless wrapper considers the invocation complete when the
// returned promise resolves *and* `res.end()` has been called. If our handler
// returns before Express finishes writing the response, the platform may
// surface FUNCTION_INVOCATION_FAILED instead of our intended JSON envelope.
// This helper resolves only after the underlying response stream has actually
// finished (or closed), and it guarantees a JSON response is sent in every
// failure path — including stalled middleware, throws during dispatch, and
// app-bootstrap errors.
//
// A safety timeout (slightly under Vercel's `maxDuration` of 60s) ensures a
// hung middleware chain is converted into a visible JSON 504 instead of a
// platform-level invocation failure.
const RESPONSE_TIMEOUT_MS = 55_000;

function sendJsonError(
  res: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>
) {
  if (res.headersSent || res.writableEnded) {
    return;
  }
  try {
    const helperRes = res as ServerResponse & {
      status?: (code: number) => unknown;
      json?: (body: unknown) => unknown;
    };
    if (typeof helperRes.status === "function" && typeof helperRes.json === "function") {
      helperRes.status(statusCode);
      helperRes.json(payload);
      return;
    }
  } catch {
    // Fall through to raw response below.
  }
  try {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  } catch (writeError) {
    logger.error({ err: writeError }, "[api/index] Failed to send error response");
  }
}

function dispatchToApp(
  app: ExpressLikeApp,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      if (settled) return;
      logger.warn("[api/index] Request exceeded safety timeout; returning JSON 504 instead of letting the function crash.");
      sendJsonError(res, 504, {
        success: false,
        error: "Request timed out",
      });
      finish();
    }, RESPONSE_TIMEOUT_MS);

    res.on("finish", finish);
    res.on("close", finish);
    res.on("error", (err) => {
      logger.error({ err }, "[api/index] Response stream error");
      finish();
    });

    try {
      app.handle(req, res);
    } catch (error) {
      // Express 4 *can* throw synchronously from inside a middleware that
      // doesn't `next(err)`. Translate it into a JSON 500 so the platform
      // never sees an unhandled exception.
      logger.error({ err: error }, "[api/index] Synchronous dispatch error");
      sendJsonError(res, 500, {
        success: false,
        error: "Internal server error",
      });
      finish();
    }
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const app = await getApp();
    await dispatchToApp(app, req, res);
  } catch (error) {
    logger.error({ err: error }, "[api/index] createApp failed");
    sendJsonError(res, 500, {
      success: false,
      error: "Server initialization failed",
    });
  }
}
