// Read-only preflight snapshot — uses Neon HTTP driver (port 443).
// Phase 0 of the hardening pass. Read-only SELECTs only; no schema or data writes.
// Run with: DATABASE_URL='...' node scripts/preflightSnapshot.mjs
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL missing"); process.exit(1); }
const sql = neon(url);

const counts = await sql`
  SELECT 'kalshiCapital'        AS t, count(*)::text AS n FROM "kalshiCapital"        WHERE "userId"=1
  UNION ALL SELECT 'kalshiPositions',     count(*)::text FROM "kalshiPositions"     WHERE "userId"=1
  UNION ALL SELECT 'kalshiOrders',        count(*)::text FROM "kalshiOrders"        WHERE "userId"=1
  UNION ALL SELECT 'kalshiFills',         count(*)::text FROM "kalshiFills"         WHERE "userId"=1
  UNION ALL SELECT 'polymarketPositions', count(*)::text FROM "polymarketPositions" WHERE "userId"=1
  UNION ALL SELECT 'polymarketOrders',    count(*)::text FROM "polymarketOrders"    WHERE "userId"=1
  UNION ALL SELECT 'polymarketFills',     count(*)::text FROM "polymarketFills"     WHERE "userId"=1
`;
console.log("\n=== ROW COUNTS (owner userId=1) ===");
for (const r of counts) console.log(`${r.t.padEnd(22)} ${r.n}`);

const halt = await sql`
  SELECT id, "marketId", "tokenId", "sizeUsdc"::text AS s, "positionStatus"
  FROM "polymarketPositions"
  WHERE "userId"=1 AND "sizeUsdc" > 0 AND "positionStatus" IN ('open','closing')
`;
console.log("\n=== HALT-CHECK: polymarket open positions with sizeUsdc>0 ===");
console.log(halt.length === 0 ? "(none — matches stated cash-only state)" : JSON.stringify(halt, null, 2));

const cap = await sql`SELECT * FROM "kalshiCapital" WHERE "userId"=1 ORDER BY id DESC LIMIT 3`;
console.log("\n=== kalshiCapital (latest 3) ===");
console.log(JSON.stringify(cap, null, 2));

const prefs = await sql`SELECT * FROM "tradingPreferences" WHERE "userId"=1`;
console.log("\n=== tradingPreferences (owner) ===");
console.log(JSON.stringify(prefs, null, 2));
