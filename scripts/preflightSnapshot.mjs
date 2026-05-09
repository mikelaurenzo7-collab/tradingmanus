// Read-only preflight snapshot — uses Neon HTTP driver (port 443).
// Phase 0 of the hardening pass. Read-only SELECTs only; no schema or data writes.
//
// Owner resolution order:
//   1. OWNER_USER_ID env override (explicit operator intent).
//   2. SELECT id FROM "users" WHERE "openId" = 'owner:primary'  (the canonical
//      identity convention from server/_core/auth.ts:OWNER_OPEN_ID).
//   3. Hard error if neither resolves — never silently fall back to id=1, since
//      a wrong-id snapshot would bypass the polymarket cash-only halt-check.
//
// Run with: DATABASE_URL='...' node scripts/preflightSnapshot.mjs
// Optional override: OWNER_USER_ID=42 DATABASE_URL='...' node scripts/preflightSnapshot.mjs
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL missing"); process.exit(1); }
const sql = neon(url);

async function resolveOwnerUserId() {
  const override = process.env.OWNER_USER_ID;
  if (override) {
    const parsed = Number.parseInt(override, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`OWNER_USER_ID must be a positive integer (got: ${override})`);
    }
    return { ownerId: parsed, source: "OWNER_USER_ID env override" };
  }
  const rows = await sql`SELECT id FROM "users" WHERE "openId" = 'owner:primary' LIMIT 1`;
  if (rows.length === 0) {
    throw new Error("No user row with openId='owner:primary' — owner has not logged in yet, or schema mismatch");
  }
  return { ownerId: Number(rows[0].id), source: "users.openId='owner:primary'" };
}

try {
  const { ownerId, source } = await resolveOwnerUserId();
  console.log(`Resolved owner userId=${ownerId} (via ${source})`);

  const counts = await sql`
    SELECT 'kalshiCapital'        AS t, count(*)::text AS n FROM "kalshiCapital"        WHERE "userId"=${ownerId}
    UNION ALL SELECT 'kalshiPositions',     count(*)::text FROM "kalshiPositions"     WHERE "userId"=${ownerId}
    UNION ALL SELECT 'kalshiOrders',        count(*)::text FROM "kalshiOrders"        WHERE "userId"=${ownerId}
    UNION ALL SELECT 'kalshiFills',         count(*)::text FROM "kalshiFills"         WHERE "userId"=${ownerId}
    UNION ALL SELECT 'polymarketPositions', count(*)::text FROM "polymarketPositions" WHERE "userId"=${ownerId}
    UNION ALL SELECT 'polymarketOrders',    count(*)::text FROM "polymarketOrders"    WHERE "userId"=${ownerId}
    UNION ALL SELECT 'polymarketFills',     count(*)::text FROM "polymarketFills"     WHERE "userId"=${ownerId}
  `;
  console.log(`\n=== ROW COUNTS (owner userId=${ownerId}) ===`);
  for (const r of counts) console.log(`${r.t.padEnd(22)} ${r.n}`);

  const halt = await sql`
    SELECT id, "marketId", "tokenId", "sizeUsdc"::text AS s, "positionStatus"
    FROM "polymarketPositions"
    WHERE "userId"=${ownerId} AND "sizeUsdc" > 0 AND "positionStatus" IN ('open','closing')
  `;
  console.log("\n=== HALT-CHECK: polymarket open positions with sizeUsdc>0 ===");
  if (halt.length === 0) {
    console.log("(none — matches stated cash-only state)");
  } else {
    console.log("HALT — polymarket open positions found:");
    console.log(JSON.stringify(halt, null, 2));
    process.exit(2);
  }

  const cap = await sql`SELECT * FROM "kalshiCapital" WHERE "userId"=${ownerId} ORDER BY id DESC LIMIT 3`;
  console.log("\n=== kalshiCapital (latest 3) ===");
  console.log(JSON.stringify(cap, null, 2));

  const prefs = await sql`SELECT * FROM "tradingPreferences" WHERE "userId"=${ownerId}`;
  console.log("\n=== tradingPreferences (owner) ===");
  console.log(JSON.stringify(prefs, null, 2));
} catch (err) {
  console.error("Preflight snapshot failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
