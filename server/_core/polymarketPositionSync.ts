/**
 * Polymarket position sync.
 *
 * Reconciles the local polymarketPositions table against the Polymarket
 * data-api `/positions?user=<address>` endpoint so that:
 *   1. Manual closes done on the Polymarket UI mark the local row as
 *      `closed` (otherwise the exit monitor would re-attempt to close
 *      a position that no longer exists, getting "insufficient balance"
 *      errors every cycle).
 *   2. Live currentPrice + size + realisedPnl on local rows reflect what
 *      Polymarket actually holds, not the snapshot from the order place.
 *   3. Positions opened outside the bot (e.g. operator manually placed a
 *      trade in the Polymarket UI) appear in the dashboard so the
 *      operator sees their full Polymarket book.
 *
 * Polymarket's data API is keyed by the EOA proxy wallet (NOT the L2 API
 * key), so this requires `POLYMARKET_OWNER_ADDRESS` env to be set.  With
 * the env unset the sync silently no-ops; the startup self-test surfaces
 * a WARN so the operator knows to set it before going live.
 *
 * Endpoint reference (verified 2026-05):
 *   GET https://data-api.polymarket.com/positions?user=<0x-addr>
 *   Response: array of objects per active position, including:
 *     - asset (token id)            string (decimal)
 *     - conditionId / market        string
 *     - size                        number   (token quantity)
 *     - avgPrice                    number   (entry)
 *     - curPrice                    number   (mark)
 *     - cashPnl                     number   (unrealised USD)
 *     - outcome                     "Yes"|"No"
 *
 * Some response fields are optional / vary across Polymarket changelog
 * revisions, so we read defensively (Number coercion + finite checks)
 * and skip any entry that fails validation rather than throwing.
 */

import * as db from "../db";
import * as polymarketCredDb from "../db.polymarket-credentials";
import { polymarketPositions } from "../../drizzle/schema";
import { and, eq, inArray } from "drizzle-orm";
import { ENV } from "./env";
import { logger } from "./logger";
import { fetchWithRetry } from "./fetchWithRetry";
import { polymarketBreaker } from "./polymarketAuth";

const DATA_API_BASE = "https://data-api.polymarket.com";

interface RemotePosition {
  marketId: string;
  tokenId: string;
  side: "yes" | "no";
  sizeUsdc: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
}

export interface PolymarketSyncResult {
  walletAddress: string;
  remoteCount: number;
  upsertedCount: number;
  closedDriftCount: number;
  closedDriftPositionIds: number[];
  skippedReason?: string;
}

const NOOP_RESULT_NO_ADDRESS: PolymarketSyncResult = {
  walletAddress: "",
  remoteCount: 0,
  upsertedCount: 0,
  closedDriftCount: 0,
  closedDriftPositionIds: [],
  skippedReason: "POLYMARKET_OWNER_ADDRESS not set",
};

function parseRemoteSide(raw: unknown): "yes" | "no" | null {
  if (typeof raw !== "string") return null;
  const lower = raw.trim().toLowerCase();
  if (lower === "yes" || lower === "y") return "yes";
  if (lower === "no" || lower === "n") return "no";
  return null;
}

function parseFiniteNumber(
  raw: unknown,
  mode: boolean | "signed" = false,
): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // Three modes:
  //   false      → strict positive (default; e.g. size, price)
  //   true       → allow zero, reject negative
  //   "signed"   → allow zero AND negative (e.g. unrealized PnL on losing
  //                positions — we MUST persist these or drawdown silently
  //                resets to 0 every sync until the position recovers).
  if (mode === "signed") return n;
  const allowZero = mode === true;
  if (!allowZero && n <= 0) return null;
  if (allowZero && n < 0) return null;
  return n;
}

export function parseRemotePositions(payload: unknown): RemotePosition[] {
  if (!Array.isArray(payload)) return [];
  const out: RemotePosition[] = [];
  for (const raw of payload) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;

    const marketId =
      typeof r.market === "string"
        ? r.market
        : typeof r.conditionId === "string"
          ? r.conditionId
          : null;
    const tokenId =
      typeof r.asset === "string"
        ? r.asset
        : typeof r.tokenId === "string"
          ? r.tokenId
          : null;
    if (!marketId || !tokenId) continue;

    const side = parseRemoteSide(r.outcome);
    if (!side) continue;

    const size = parseFiniteNumber(r.size);
    if (size === null) continue;

    const avg = parseFiniteNumber(r.avgPrice);
    if (avg === null || avg >= 1) continue;
    const cur = parseFiniteNumber(r.curPrice ?? r.currentPrice ?? avg) ?? avg;
    if (cur >= 1) continue;
    const pnl = parseFiniteNumber(r.cashPnl ?? r.unrealizedPnl ?? 0, "signed") ?? 0;

    out.push({
      marketId,
      tokenId,
      side,
      sizeUsdc: size * avg,
      entryPrice: avg,
      currentPrice: cur,
      unrealizedPnl: pnl,
    });
  }
  return out;
}

async function fetchRemotePositions(walletAddress: string): Promise<RemotePosition[] | null> {
  try {
    const url = `${DATA_API_BASE}/positions?user=${encodeURIComponent(walletAddress)}`;
    const resp = await fetchWithRetry(
      url,
      { method: "GET", headers: { Accept: "application/json" } },
      { label: "Polymarket.dataApi.positions", breaker: polymarketBreaker },
    );
    if (!resp.ok) {
      logger.warn(
        { status: resp.status, walletAddress },
        "[PolymarketPositionSync] data-api returned non-200",
      );
      return null;
    }
    const json = await resp.json();
    return parseRemotePositions(json);
  } catch (err) {
    logger.warn({ err, walletAddress }, "[PolymarketPositionSync] data-api fetch failed");
    return null;
  }
}

async function upsertOne(userId: number, remote: RemotePosition): Promise<boolean> {
  const database = await db.getDb();
  if (!database) return false;
  try {
    const existing = await database
      .select({
        id: polymarketPositions.id,
      })
      .from(polymarketPositions)
      .where(
        and(
          eq(polymarketPositions.userId, userId),
          eq(polymarketPositions.marketId, remote.marketId),
          eq(polymarketPositions.tokenId, remote.tokenId),
          inArray(polymarketPositions.positionStatus, ["open", "closing"]),
        ),
      )
      .limit(1)
      .then((rows: unknown[]) => (rows as Array<Record<string, unknown>>)[0]);

    if (existing) {
      await database
        .update(polymarketPositions)
        .set({
          sizeUsdc: remote.sizeUsdc,
          currentPrice: remote.currentPrice,
          unrealizedPnl: remote.unrealizedPnl,
        })
        .where(eq(polymarketPositions.id, Number(existing.id)));
    } else {
      await database.insert(polymarketPositions).values({
        userId,
        marketId: remote.marketId,
        tokenId: remote.tokenId,
        side: remote.side,
        sizeUsdc: remote.sizeUsdc,
        entryPrice: remote.entryPrice,
        currentPrice: remote.currentPrice,
        unrealizedPnl: remote.unrealizedPnl,
        realizedPnl: 0,
        positionStatus: "open",
      });
    }
    return true;
  } catch (err) {
    logger.warn(
      { err, marketId: remote.marketId, tokenId: remote.tokenId },
      "[PolymarketPositionSync] upsert failed",
    );
    return false;
  }
}

async function closeDriftedPositions(
  userId: number,
  remoteTokenIds: Set<string>,
): Promise<number[]> {
  const database = await db.getDb();
  if (!database) return [];
  try {
    // Include both 'open' AND 'closing' rows in the drift scan.  When
    // an auto-close SELL fills, the exit monitor flips the row to
    // 'closing' to debounce.  If we then never include it here, a
    // filled-and-vanished position would be stuck in 'closing' forever
    // and learning / dashboard / closed-PnL would never advance.
    const localOpen = await database
      .select({
        id: polymarketPositions.id,
        tokenId: polymarketPositions.tokenId,
      })
      .from(polymarketPositions)
      .where(
        and(
          eq(polymarketPositions.userId, userId),
          inArray(polymarketPositions.positionStatus, ["open", "closing"]),
        ),
      );

    const driftIds: number[] = [];
    for (const row of localOpen as Array<{ id: number; tokenId: string }>) {
      if (!remoteTokenIds.has(String(row.tokenId))) {
        driftIds.push(Number(row.id));
      }
    }
    if (driftIds.length === 0) return [];

    await database
      .update(polymarketPositions)
      .set({ positionStatus: "closed", closedAt: new Date() })
      .where(
        and(
          eq(polymarketPositions.userId, userId),
          inArray(polymarketPositions.id, driftIds),
        ),
      );

    void db
      .logAuditEvent(
        "polymarket_position_drift_closed",
        JSON.stringify({
          positionIds: driftIds,
          remoteTokenCount: remoteTokenIds.size,
          reason:
            "absent from data-api response — likely manual UI close or fill-then-close",
        }),
        `user:${userId}`,
      )
      .catch((auditErr) =>
        logger.warn({ err: auditErr }, "[PolymarketPositionSync] failed to write drift audit"),
      );

    return driftIds;
  } catch (err) {
    logger.warn({ err, userId }, "[PolymarketPositionSync] drift detection failed");
    return [];
  }
}

export async function syncPolymarketPositions(userId: number): Promise<PolymarketSyncResult> {
  const wallet = ENV.polymarketOwnerAddress;
  if (!wallet) return NOOP_RESULT_NO_ADDRESS;

  try {
    const subscribed = await polymarketCredDb.isUserSubscribedToPolymarket(userId);
    if (!subscribed) {
      return {
        walletAddress: wallet,
        remoteCount: 0,
        upsertedCount: 0,
        closedDriftCount: 0,
        closedDriftPositionIds: [],
        skippedReason: "user not subscribed to Polymarket",
      };
    }
  } catch {
    // Subscription lookup failure is non-fatal; we proceed conservatively.
  }

  const remote = await fetchRemotePositions(wallet);
  if (remote === null) {
    return {
      walletAddress: wallet,
      remoteCount: 0,
      upsertedCount: 0,
      closedDriftCount: 0,
      closedDriftPositionIds: [],
      skippedReason: "data-api fetch failed",
    };
  }

  let upserted = 0;
  for (const r of remote) {
    if (await upsertOne(userId, r)) upserted += 1;
  }

  const remoteTokenIds = new Set(remote.map((r) => r.tokenId));
  const driftIds = await closeDriftedPositions(userId, remoteTokenIds);

  return {
    walletAddress: wallet,
    remoteCount: remote.length,
    upsertedCount: upserted,
    closedDriftCount: driftIds.length,
    closedDriftPositionIds: driftIds,
  };
}
