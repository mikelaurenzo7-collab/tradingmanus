import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../server/_core/app";

type ExpressLikeApp = {
  handle(req: IncomingMessage, res: ServerResponse): unknown;
};

let appPromise: Promise<ExpressLikeApp> | null = null;

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
