#!/usr/bin/env tsx
/**
 * Reset every user's `tradingPreferences` row to permissive values that
 * never bottleneck the env-driven aggressive preset.  This is the
 * counterpart to deleting the Risk Controls page — risk is now managed
 * exclusively via Railway env vars, so per-user preference rows must not
 * cap below those env limits.
 *
 * Permissive values applied:
 *   autonomyMode:        "fully_autonomous"
 *   liveTradingEnabled:  true
 *   paperTradeMode:      false  (env PAPER_TRADE_MODE is the kill switch)
 *   aggressiveMode:      true
 *   moonshotMode:        true   (matches ENABLE_DAILY_MOONSHOT=true)
 *   executionCadence:    "continuous_watch"
 *   riskPosture:         "aggressive"
 *   minSignalConfidence: 0.50   (matches MIN_CONFIDENCE_AFTER_ADJUST)
 *   maxOrderNotional:    200    (well above env-derived $69 trade cap)
 *   maxDailyOrders:      100    (well above 15-30/day target)
 *   requireApprovalAbove: 999   (effectively never)
 *
 * Usage:
 *   DATABASE_URL='postgresql://...' corepack pnpm tsx scripts/syncPrefsToEnv.ts
 */

import { neon } from "@neondatabase/serverless";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL not set");
    console.error("\nUsage: DATABASE_URL='postgresql://...' corepack pnpm tsx scripts/syncPrefsToEnv.ts");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  console.log("🔄 Syncing trading preferences to permissive env-driven defaults...\n");

  const before = await sql`
    SELECT user_id, autonomy_mode, live_trading_enabled, paper_trade_mode,
           aggressive_mode, moonshot_mode, execution_cadence, risk_posture,
           min_signal_confidence, max_order_notional, max_daily_orders,
           require_approval_above
    FROM trading_preferences
  `;

  if (before.length === 0) {
    console.log("ℹ️  No tradingPreferences rows found — nothing to reset.");
    console.log("   The default permissive values from db.trading-preferences.ts will apply on first read.\n");
    return;
  }

  console.log(`Found ${before.length} preferences row(s). Current values:\n`);
  for (const row of before) {
    console.log(`  User ${row.user_id}:`);
    console.log(`    autonomyMode=${row.autonomy_mode} liveTrading=${row.live_trading_enabled} paper=${row.paper_trade_mode}`);
    console.log(`    aggressive=${row.aggressive_mode} moonshot=${row.moonshot_mode} cadence=${row.execution_cadence} posture=${row.risk_posture}`);
    console.log(`    minConfidence=${row.min_signal_confidence} maxNotional=${row.max_order_notional} maxDaily=${row.max_daily_orders}`);
  }

  console.log("\n📝 Updating to permissive env-driven values...\n");

  const result = await sql`
    UPDATE trading_preferences SET
      autonomy_mode = 'fully_autonomous',
      live_trading_enabled = true,
      paper_trade_mode = false,
      aggressive_mode = true,
      moonshot_mode = true,
      execution_cadence = 'continuous_watch',
      risk_posture = 'aggressive',
      min_signal_confidence = 0.50,
      max_order_notional = 200,
      max_daily_orders = 100,
      require_approval_above = 999,
      updated_at = NOW()
    RETURNING user_id
  `;

  console.log(`✅ Updated ${result.length} preferences row(s).\n`);

  console.log("🎯 Now your trading is fully governed by Railway env vars:");
  console.log("   • MAX_RISK_PER_TRADE_PERCENT=15      → $69/trade cap");
  console.log("   • KELLY_FRACTION=1.0                  → full Kelly sizing");
  console.log("   • KELLY_MAX_PCT_OF_CAPITAL=0.40       → 40% max position");
  console.log("   • MIN_CONFIDENCE_AFTER_ADJUST=0.50    → confidence floor");
  console.log("   • MIN_NET_EV=0.008                    → edge floor");
  console.log("   • DAILY_LOSS_LIMIT_USD=75             → daily stop");
  console.log("   • AUTONOMY_INTERVAL_MS=120000         → 2-min cadence");
  console.log("\n🛑 Kill switches still work:");
  console.log("   • Topbar 'Kill Switch' button         → flatten all positions + disarm");
  console.log("   • Command palette 'Kill switch'       → same as above");
  console.log("   • PAPER_TRADE_MODE=true env var       → global emergency stop\n");
}

main().catch((err) => {
  console.error("\n❌ Sync failed:", err);
  process.exit(1);
});
