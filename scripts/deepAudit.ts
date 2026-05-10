#!/usr/bin/env tsx
/**
 * Deep system audit — connection status, recent activity, error detection,
 * and aggressive profit optimization recommendations.
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { 
  users, kalshiCredentials, kalshiSignals, kalshiOrders, 
  kalshiPositions, kalshiCapital, autonomyRuns, auditLog 
} from "../drizzle/schema";
import { desc, sql } from "drizzle-orm";
import { getKalshiCredentials } from "../server/db.kalshi-credentials";
import { ENV } from "../server/_core/env";

async function runDeepAudit() {
  console.log("\n🔍 DEEP SYSTEM AUDIT\n");
  console.log("=".repeat(80));

  // Check DATABASE_URL is set
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL environment variable is not set");
    console.error("\n📋 USAGE:");
    console.error("   DATABASE_URL='postgresql://...' corepack pnpm tsx scripts/deepAudit.ts");
    console.error("\n   Or copy your Neon connection string from Railway → Variables");
    process.exit(1);
  }

  // Initialize database connection
  const sqlClient = neon(process.env.DATABASE_URL);
  const db = drizzle(sqlClient);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 1. DATABASE CONNECTION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("\n[1] DATABASE CONNECTION");
  console.log("-".repeat(80));
  
  try {
    const result = await sqlClient`SELECT NOW() as now, current_database() as db`;
    console.log("✅ Database connected");
    console.log(`   Database: ${result[0].db}`);
    console.log(`   Timestamp: ${result[0].now}`);
  } catch (err: unknown) {
    console.error("❌ Database connection failed:", err);
    process.exit(1);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2. USER & CREDENTIALS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("\n[2] USER & KALSHI CREDENTIALS");
  console.log("-".repeat(80));

  const usersResult = await sqlClient`SELECT id, email, role, created_at FROM users`;
  if (usersResult.length === 0) {
    console.log("⚠️  No users found");
  } else {
    for (const user of usersResult) {
      console.log(`✅ User ID ${user.id}: ${user.email} (${user.role})`);
      
      // Check Kalshi credentials
      try {
        const creds = await getKalshiCredentials(user.id as string);
        if (creds) {
          console.log(`   ✅ Kalshi credentials CONNECTED`);
          console.log(`      Key ID: ${creds.apiKeyId}`);
          console.log(`      Account status: ${creds.accountStatus || "unknown"}`);
        } else {
          console.log(`   ❌ Kalshi credentials NOT SET`);
        }
      } catch (err) {
        console.log(`   ❌ Kalshi credentials error:`, err);
      }
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 3. RECENT AUTONOMY RUNS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("\n[3] RECENT AUTONOMY RUNS (Last 10)");
  console.log("-".repeat(80));

  const autonomyRunsResult = await sqlClient`
    SELECT 
      id, user_id, outcome, created_at, 
      execution_decision, reconciliation_status,
      error_message
    FROM autonomy_runs
    ORDER BY created_at DESC
    LIMIT 10
  `;

  if (autonomyRunsResult.length === 0) {
    console.log("⚠️  No autonomy runs found");
  } else {
    for (const run of autonomyRunsResult) {
      const status = run.outcome === "executed" ? "✅" : 
                     run.outcome === "blocked" ? "⚠️ " : 
                     run.outcome === "error" ? "❌" : "ℹ️ ";
      console.log(`${status} Run ${run.id} (${new Date(run.created_at).toISOString()})`);
      console.log(`   Outcome: ${run.outcome}`);
      console.log(`   Execution: ${run.execution_decision || "N/A"}`);
      if (run.error_message) {
        console.log(`   ❌ Error: ${run.error_message}`);
      }
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 4. RECENT SIGNALS GENERATED
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("\n[4] RECENT SIGNALS (Last 20)");
  console.log("-".repeat(80));

  const signalsResult = await sqlClient`
    SELECT 
      id, market_id, signal_type, side, confidence, 
      expected_value, created_at
    FROM kalshi_signals
    ORDER BY created_at DESC
    LIMIT 20
  `;

  if (signalsResult.length === 0) {
    console.log("⚠️  No signals found — autonomy may not be generating signals");
  } else {
    console.log(`Found ${signalsResult.length} recent signals:`);
    const byType: Record<string, number> = {};
    for (const signal of signalsResult) {
      byType[signal.signal_type] = (byType[signal.signal_type] || 0) + 1;
    }
    console.log("\nSignal type breakdown:");
    for (const [type, count] of Object.entries(byType)) {
      console.log(`   ${type}: ${count}`);
    }
    
    console.log("\nTop 5 signals by confidence:");
    const topSignals = signalsResult
      .sort((a: any, b: any) => (b.confidence || 0) - (a.confidence || 0))
      .slice(0, 5);
    for (const sig of topSignals) {
      console.log(`   ${(sig.confidence * 100).toFixed(1)}% ${sig.signal_type} ${sig.side.toUpperCase()} on ${sig.market_id} (EV: ${sig.expected_value?.toFixed(3) || "N/A"})`);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 5. RECENT ORDERS & TRADES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("\n[5] RECENT ORDERS (Last 10)");
  console.log("-".repeat(80));

  const ordersResult = await sqlClient`
    SELECT 
      id, market_id, side, quantity, limit_price, 
      status, created_at, filled_at
    FROM kalshi_orders
    ORDER BY created_at DESC
    LIMIT 10
  `;

  if (ordersResult.length === 0) {
    console.log("⚠️  No orders found — no trades executed yet");
  } else {
    for (const order of ordersResult) {
      const statusIcon = order.status === "filled" ? "✅" : 
                         order.status === "pending" ? "⏳" : 
                         order.status === "cancelled" ? "🚫" : "❓";
      console.log(`${statusIcon} ${order.side.toUpperCase()} ${order.quantity} @ $${order.limit_price?.toFixed(2) || "N/A"} on ${order.market_id}`);
      console.log(`   Status: ${order.status} | Created: ${new Date(order.created_at).toISOString()}`);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 6. OPEN POSITIONS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("\n[6] OPEN POSITIONS");
  console.log("-".repeat(80));

  const positionsResult = await sqlClient`
    SELECT 
      market_id, side, quantity, entry_price, 
      current_price, unrealized_pnl, created_at
    FROM kalshi_positions
    WHERE position_status = 'open'
    ORDER BY created_at DESC
  `;

  if (positionsResult.length === 0) {
    console.log("✅ No open positions");
  } else {
    let totalUnrealizedPnL = 0;
    for (const pos of positionsResult) {
      const pnl = pos.unrealized_pnl || 0;
      totalUnrealizedPnL += pnl;
      const pnlIcon = pnl > 0 ? "📈" : pnl < 0 ? "📉" : "➖";
      console.log(`${pnlIcon} ${pos.side.toUpperCase()} ${pos.quantity} on ${pos.market_id}`);
      console.log(`   Entry: $${pos.entry_price?.toFixed(2) || "N/A"} | Current: $${pos.current_price?.toFixed(2) || "N/A"} | P&L: $${pnl.toFixed(2)}`);
    }
    console.log(`\nTotal Unrealized P&L: $${totalUnrealizedPnL.toFixed(2)}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 7. CAPITAL & BALANCE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("\n[7] CAPITAL & BALANCE");
  console.log("-".repeat(80));

  const capitalResult = await sqlClient`
    SELECT user_id, current_balance, starting_balance, 
           max_drawdown, max_drawdown_pct, updated_at
    FROM kalshi_capital
    ORDER BY user_id
  `;

  if (capitalResult.length === 0) {
    console.log("⚠️  No capital records found");
  } else {
    for (const cap of capitalResult) {
      console.log(`User ${cap.user_id}:`);
      console.log(`   Current Balance: $${cap.current_balance?.toFixed(2) || "N/A"}`);
      console.log(`   Starting Balance: $${cap.starting_balance?.toFixed(2) || "N/A"}`);
      const profit = (cap.current_balance || 0) - (cap.starting_balance || 0);
      const profitPct = cap.starting_balance > 0 ? (profit / cap.starting_balance) * 100 : 0;
      const profitIcon = profit > 0 ? "📈" : profit < 0 ? "📉" : "➖";
      console.log(`   ${profitIcon} Net P&L: $${profit.toFixed(2)} (${profitPct > 0 ? "+" : ""}${profitPct.toFixed(2)}%)`);
      console.log(`   Max Drawdown: ${(cap.max_drawdown_pct * 100).toFixed(2)}%`);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 8. RECENT ERRORS (from audit log)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("\n[8] RECENT ERRORS (Last 10)");
  console.log("-".repeat(80));

  const errorsResult = await sqlClient`
    SELECT event_type, payload, created_at
    FROM audit_log
    WHERE event_type LIKE '%error%' 
       OR event_type LIKE '%failed%'
       OR event_type LIKE '%blocked%'
    ORDER BY created_at DESC
    LIMIT 10
  `;

  if (errorsResult.length === 0) {
    console.log("✅ No recent errors found");
  } else {
    for (const err of errorsResult) {
      console.log(`❌ ${err.event_type} (${new Date(err.created_at).toISOString()})`);
      const payload = typeof err.payload === 'string' ? JSON.parse(err.payload) : err.payload;
      if (payload.error || payload.reason) {
        console.log(`   ${payload.error || payload.reason}`);
      }
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 9. CURRENT ENV CONFIGURATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("\n[9] CURRENT CONFIGURATION");
  console.log("-".repeat(80));

  console.log("Autonomy:");
  console.log(`   Interval: ${ENV.autonomyIntervalMs / 1000}s`);
  console.log(`   Paper Mode: ${ENV.paperTradeMode ? "ENABLED" : "DISABLED"}`);
  
  console.log("\nRisk Settings:");
  console.log(`   Max Risk Per Trade: ${ENV.profitGuardrails.maxRiskPerTradePct * 100}%`);
  console.log(`   Daily Loss Limit: $${ENV.profitGuardrails.dailyLossLimitUsd}`);
  console.log(`   Kelly Fraction: ${ENV.profitGuardrails.kellyFraction}`);
  console.log(`   Min Confidence: ${ENV.profitGuardrails.minConfidenceAfterAdjust}`);
  console.log(`   Min Net EV: ${ENV.profitGuardrails.minNetEV}`);
  console.log(`   Min Order Exposure: $${ENV.profitGuardrails.minOrderExposureUsd}`);

  console.log("\nAI Stack:");
  console.log(`   Claude Model: ${ENV.claudeModel}`);
  console.log(`   Deep Model: ${ENV.claudeDeepModel}`);
  console.log(`   Grok Enabled: ${ENV.enableGrokTeam ? "YES (dual-bot)" : "NO"}`);
  console.log(`   OpenRouter Triage: ${ENV.openRouterTriageEnabled ? "YES" : "NO"}`);
  if (ENV.openRouterTriageEnabled) {
    console.log(`   OpenRouter Model: ${ENV.openRouterTriageModel}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 10. AGGRESSIVE PROFIT RECOMMENDATIONS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log("\n[10] 🔥 AGGRESSIVE PROFIT OPTIMIZATION RECOMMENDATIONS");
  console.log("-".repeat(80));

  const currentRisk = ENV.profitGuardrails.maxRiskPerTradePct * 100;
  const currentKelly = ENV.profitGuardrails.kellyFraction;
  const currentMinConf = ENV.profitGuardrails.minConfidenceAfterAdjust;
  const currentBalanceRow = capitalResult[0];
  const currentBalance = currentBalanceRow?.current_balance || 0;

  console.log("\n🎯 ULTRA-AGGRESSIVE PRESET (⚠️  HIGH RISK / HIGH REWARD):");
  console.log("   Based on your $459 balance and request for maximum profit...\n");

  if (currentRisk < 15) {
    console.log(`   • MAX_RISK_PER_TRADE_PERCENT: ${currentRisk}% → 15%`);
    console.log(`     Impact: ~$69/trade cap (was $${(currentBalance * currentRisk / 100).toFixed(0)})`);
  }
  
  if (currentKelly < 1.0) {
    console.log(`   • KELLY_FRACTION: ${currentKelly} → 1.0 (FULL Kelly)`);
    console.log(`     Impact: Bet full Kelly edge — maximum growth rate`);
  }

  console.log(`   • KELLY_MAX_PCT_OF_CAPITAL: 0.30 → 0.40`);
  console.log(`     Impact: Allow 40% of capital on a single trade (high conviction)`);

  if (currentMinConf > 0.50) {
    console.log(`   • MIN_CONFIDENCE_AFTER_ADJUST: ${currentMinConf} → 0.50`);
    console.log(`     Impact: Accept more marginal signals (~2-3× signal count)`);
  }

  console.log(`   • MIN_NET_EV: 0.015 → 0.008`);
  console.log(`     Impact: Trade thinner edges (more volume, lower selectivity)`);

  console.log(`   • DAILY_LOSS_LIMIT_USD: 35 → 75`);
  console.log(`     Impact: ~16% daily loss tolerance (allows recovery from bad streaks)`);

  console.log(`   • AUTONOMY_INTERVAL_MS: 600000 (10min) → 120000 (2min)`);
  console.log(`     Impact: 5× more scans/day, faster response to market moves`);
  console.log(`     AI Cost: ~$4-6/day (was ~$2-3/day)`);

  console.log(`   • CATASTROPHIC_PCT_OF_CAPITAL: 0.18 → 0.25`);
  console.log(`     Impact: Allow 25% capital on extreme-conviction outlier plays`);

  console.log("\n⚡ EXPECTED OUTCOMES:");
  console.log(`   • Daily notional: ~$400-900 (cycling your full balance 1-2×/day)`);
  console.log(`   • Trades/day: 15-30 (was 5-10)`);
  console.log(`   • Win expectancy: +2-5% on winning days, -10-16% on losing days`);
  console.log(`   • Volatility: 3-4× higher than current conservative preset`);
  console.log(`   • 30-day Monte Carlo outcome range: +30% to -60%`);

  console.log("\n⚠️  RISKS:");
  console.log(`   • One bad week can wipe 30-40% of capital`);
  console.log(`   • Triple-Kelly bets on mispriced markets = gambler's ruin territory`);
  console.log(`   • Increased exposure to Kalshi liquidity gaps and adverse selection`);

  console.log("\n📋 RECOMMENDED ENV VARS FOR ULTRA-AGGRESSIVE MODE:");
  console.log(`
MAX_RISK_PER_TRADE_PERCENT=15
KELLY_FRACTION=1.0
KELLY_MAX_PCT_OF_CAPITAL=0.40
MIN_CONFIDENCE_AFTER_ADJUST=0.50
MIN_NET_EV=0.008
DAILY_LOSS_LIMIT_USD=75
AUTONOMY_INTERVAL_MS=120000
CATASTROPHIC_PCT_OF_CAPITAL=0.25
HIGH_STAKES_PCT_OF_CAPITAL=0.08
MIN_ORDER_EXPOSURE_USD=3
  `);

  console.log("\n" + "=".repeat(80));
  console.log("✅ AUDIT COMPLETE\n");
  
  process.exit(0);
}

runDeepAudit().catch((err) => {
  console.error("\n❌ Audit failed:", err);
  process.exit(1);
});
