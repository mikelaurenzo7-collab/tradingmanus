import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../server/_core/app";

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
  __tradingmanusProcessGuardsInstalled?: boolean;
};
const globalWithGuards = globalThis as GlobalWithGuards;
if (!globalWithGuards.__tradingmanusProcessGuardsInstalled) {
  globalWithGuards.__tradingmanusProcessGuardsInstalled = true;
  process.on("unhandledRejection", (reason) => {
    console.error("[api/index] unhandledRejection:", reason);
  });
  process.on("uncaughtException", (error) => {
    console.error("[api/index] uncaughtException:", error);
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

export default async function handler(req: any, res: any) {
  try {
    const app = await getApp();
    return app.handle(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/index] createApp failed:", message);
    const errorPayload = { success: false, error: "Server initialization failed", detail: message };
    const body = JSON.stringify(errorPayload);
    try {
      // Prefer Express/Vercel helper methods when available.
      if (typeof res.status === "function" && typeof res.json === "function") {
        res.status(500).json(errorPayload);
        return;
      }
    } catch (helperMethodError) {
      // Fall through to raw Node.js response.
    }
    try {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(body);
    } catch (writeError) {
      console.error("[api/index] Failed to send error response:", writeError);
    }
  }
}
