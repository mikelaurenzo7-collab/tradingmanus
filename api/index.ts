import "dotenv/config";
import type { Express } from "express";
import { createApp } from "../server/_core/app";

let appPromise: Promise<Express> | null = null;

function getApp() {
  if (!appPromise) {
    appPromise = createApp({ runStartupMigrations: false }).catch((error) => {
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
    return app(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/index] createApp failed:", message);
    res.status(500).json({
      success: false,
      error: "Server initialization failed",
      detail: message,
    });
  }
}
