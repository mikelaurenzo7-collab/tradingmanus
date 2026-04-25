import "dotenv/config";
import type { Express } from "express";
import { createApp } from "../server/_core/app";

let appPromise: Promise<Express> | null = null;

function getApp() {
  if (!appPromise) {
    appPromise = createApp({ runStartupMigrations: false });
  }
  return appPromise;
}

export default async function handler(req: any, res: any) {
  const app = await getApp();
  return app(req, res);
}
