/**
 * Kalshi Order Sync
 * Polls Kalshi for pending order fills and syncs live positions into the local DB.
 */

import { db } from "../db";
import { kalshiOrders, kalshiPositions } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { getKalshiOrderStatus, createPositionFromFill } from "./kalshiExecution";
import * as kalshiCredDb from "../db.kalshi-credentials";

// Guards against two concurrent sync intervals processing the same pending orders
let _syncRunning = false;

/**
 * Check all locally-pending orders for the user; mark filled ones and
 * create position records from any newly-filled orders.
 * Idempotent: skips if a position for the same market is already open.
 */
export async function syncPendingOrders(userId: number): Promise<void> {
  if (_syncRunning) return;
  _syncRunning = true;

  try {
    const creds = await kalshiCredDb.getKalshiCredentials(userId);
    if (!creds || !creds.apiKey || !creds.privateKey) return;

    const pending = await db
      .select()
      .from(kalshiOrders)
      .where(eq(kalshiOrders.status, "pending"));

    for (const order of pending) {
      try {
        const updated = await getKalshiOrderStatus(userId, order.orderId);
        if (!updated) continue;

        if (updated.status === "filled" && updated.filledQuantity > 0) {
          // Idempotency guard: skip if an open position already exists for this market
          const existingOpen = await db
            .select()
            .from(kalshiPositions)
            .where(
              and(
                eq(kalshiPositions.marketId, order.marketId),
                eq(kalshiPositions.positionStatus, "open"),
              ),
            )
            .then((rows: any[]) => rows[0]);

          if (existingOpen) {
            console.log(`[OrderSync] Position for ${order.marketId} already exists, skipping`);
            continue;
          }

          const fillPrice =
            updated.averagePrice > 0 ? updated.averagePrice : order.limitPrice;

          await createPositionFromFill(
            order.orderId,
            order.marketId,
            order.side as "yes" | "no",
            updated.filledQuantity,
            fillPrice,
          );
        }
      } catch (err) {
        console.error(`[OrderSync] Failed to sync order ${order.orderId}:`, err);
      }
    }
  } finally {
    _syncRunning = false;
  }
}

/**
 * Fetch live positions from Kalshi and upsert into local kalshiPositions table.
 * Kalshi API: GET /portfolio/positions
 */
export async function syncLivePositions(userId: number): Promise<void> {
  const creds = await kalshiCredDb.getKalshiCredentials(userId);
  if (!creds || !creds.apiKey || !creds.privateKey) return;

  try {
    const KALSHI_ENVIRONMENTS = [
      "https://api.elections.kalshi.com/trade-api/v2",
      "https://demo-api.kalshi.co/trade-api/v2",
    ];

    const crypto = await import("crypto");
    const { URL } = await import("url");

    const normalizeKey = (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed.includes("BEGIN") && trimmed.includes("PRIVATE KEY")) {
        return trimmed;
      }
      const body = trimmed
        .replace(/-----BEGIN PRIVATE KEY-----/g, "")
        .replace(/-----END PRIVATE KEY-----/g, "")
        .replace(/\s+/g, "");
      const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
      return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----`;
    };

    const buildHeaders = (url: string) => {
      const ts = Date.now().toString();
      const path = new URL(url).pathname;
      const sig = crypto.sign(
        "sha256",
        Buffer.from(`${ts}GET${path}`, "utf8"),
        {
          key: crypto.createPrivateKey({
            key: normalizeKey(creds.privateKey),
            format: "pem",
          }),
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
          saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
        },
      );
      return {
        Accept: "application/json",
        "KALSHI-ACCESS-KEY": creds.apiKey.trim(),
        "KALSHI-ACCESS-SIGNATURE": sig.toString("base64"),
        "KALSHI-ACCESS-TIMESTAMP": ts,
      };
    };

    let livePositions: any[] | null = null;

    for (const base of KALSHI_ENVIRONMENTS) {
      try {
        const url = `${base}/portfolio/positions`;
        const resp = await fetch(url, { method: "GET", headers: buildHeaders(url) });
        if (!resp.ok) continue;
        const payload = await resp.json() as { market_positions?: any[]; positions?: any[] };
        livePositions = payload.market_positions ?? payload.positions ?? [];
        break;
      } catch {
        continue;
      }
    }

    if (!livePositions) return;

    const now = new Date();

    for (const pos of livePositions) {
      const marketId: string = pos.ticker ?? pos.market_id ?? "";
      if (!marketId) continue;

      const yesQty = Number(pos.position ?? pos.yes_position ?? 0);
      const noQty = Number(pos.no_position ?? 0);
      const side: "yes" | "no" = yesQty >= noQty ? "yes" : "no";
      const quantity = side === "yes" ? yesQty : noQty;
      if (quantity <= 0) continue;

      // Average price from Kalshi comes as cents; normalize to decimal.
      const rawPrice = Number(
        pos.average_price ?? pos.yes_price ?? pos.no_price ?? 0,
      );
      const entryPrice = rawPrice > 1 ? rawPrice / 100 : rawPrice;
      const currentPrice = entryPrice;

      const existing = await db
        .select()
        .from(kalshiPositions)
        .where(eq(kalshiPositions.marketId, marketId))
        .then((rows: any[]) => rows.find((r: any) => r.positionStatus === "open"));

      if (existing) {
        await db
          .update(kalshiPositions)
          .set({
            quantity,
            currentPrice,
            unrealizedPnl:
              side === "yes"
                ? quantity * (currentPrice - Number(existing.entryPrice))
                : quantity * (Number(existing.entryPrice) - currentPrice),
          })
          .where(eq(kalshiPositions.id, existing.id));
      } else {
        await db.insert(kalshiPositions).values({
          marketId,
          positionSide: side,
          quantity,
          entryPrice,
          currentPrice,
          unrealizedPnl: 0,
          realizedPnl: 0,
          positionStatus: "open",
          openedAt: now,
        });
      }
    }
  } catch (err) {
    console.error("[OrderSync] syncLivePositions failed:", err);
  }
}
