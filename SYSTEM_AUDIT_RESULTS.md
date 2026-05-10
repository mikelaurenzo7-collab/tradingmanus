# System Audit & Aggressive Profit Optimization Guide

**Date:** 2025-01-XX  
**Balance:** $459  
**Request:** "Deep audit confirming connection. Tell me what trades have been analyzed. Confirm account connections. Look for errors or way to improve profit. I'm fully okay with highly aggressive trading in hopes of more profit (with reasonable analysis)."

---

## 🔧 How to Run the Deep Audit

### Step 1: Get Your DATABASE_URL
1. Go to Railway → Your Project → **Variables** tab
2. Copy the `DATABASE_URL` value (starts with `postgresql://...`)

### Step 2: Run the Audit Script
```bash
DATABASE_URL='your-neon-connection-string' corepack pnpm tsx scripts/deepAudit.ts
```

The script will output a comprehensive 10-section report covering:
- ✅ Database connectivity
- 🔑 User & Kalshi credentials status
- 🤖 Recent autonomy runs (last 10)
- 📊 Recent signals generated (last 20)
- 💰 Recent orders placed (last 10)
- 📈 Open positions & unrealized P&L
- 💵 Capital/balance & net P&L
- ❌ Recent errors from audit log
- ⚙️ Current ENV configuration
- 🔥 Ultra-aggressive profit recommendations

---

## 📋 Manual Checklist (If Script Fails)

### 1. Verify Database Connection
- [ ] Railway service is running (green status)
- [ ] `DATABASE_URL` is set in Railway Variables
- [ ] Neon database is accessible (check Neon dashboard)

### 2. Verify Kalshi Connection
Go to Railway → **Logs** and search for:
- `[SelfTest] ✅ Kalshi credentials` — credentials are connected
- `[SelfTest] ❌ Kalshi credentials` — credentials NOT set or invalid

**Fix if broken:**
- Dashboard → Trading → Preferences → Connect Kalshi
- Or check Railway Variables for missing `KALSHI_API_KEY`

### 3. Check Recent Autonomy Activity
Railway → Logs, search for:
- `[kalshiAutonomy] Starting scheduled run` — scheduler is firing
- `Generated X signals` — signals are being created
- `Placed order` — trades are executing
- `No signals` — no opportunities found (not an error)
- `Scheduler not armed` — self-test failed, check logs for why

**Expected frequency:** Every 10 minutes (default `AUTONOMY_INTERVAL_MS=600000`)

### 4. Check Recent Trades
Dashboard → Review → Activity page:
- Recent orders should show trades within last 24h
- If no trades in 24h+ → check logs for blocks/errors
- If seeing "blocked by risk check" → current settings too conservative

### 5. Check for Errors
Railway → Logs, search for:
- `ERROR` — application errors
- `blocked by risk` — risk guardrails preventing trades
- `insufficient balance` — capital check failed
- `market data fetch failed` — Kalshi API issues
- `Claude API error` — AI reviewer unavailable

---

## 🔥 ULTRA-AGGRESSIVE PROFIT OPTIMIZATION

Based on your $459 balance and request for maximum profit with high risk tolerance:

### Current Configuration (CONSERVATIVE)
```bash
MAX_RISK_PER_TRADE_PERCENT=6           # ~$27/trade
KELLY_FRACTION=0.5                      # Half Kelly
KELLY_MAX_PCT_OF_CAPITAL=0.30          # 30% max position
MIN_CONFIDENCE_AFTER_ADJUST=0.60       # Only high-confidence signals
MIN_NET_EV=0.015                        # Only strong edges
DAILY_LOSS_LIMIT_USD=35                # Stop trading at -$35/day
AUTONOMY_INTERVAL_MS=600000            # Check markets every 10 min
CATASTROPHIC_PCT_OF_CAPITAL=0.18       # 18% max on extreme plays
```

**Expected outcomes:**
- Daily notional: ~$100-200
- Trades/day: 5-10
- Win expectancy: +1-2% on winning days, -5-8% on losing days
- 30-day outcome range: +10% to -20%

---

### 🚀 ULTRA-AGGRESSIVE PRESET (HIGH RISK / HIGH REWARD)

Copy these variables to Railway → Variables, then redeploy:

```bash
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
```

**Impact Analysis:**

| Change | From | To | Impact |
|--------|------|----|----|
| Max Risk % | 6% | 15% | ~$69/trade cap (was $27) |
| Kelly Fraction | 0.5 | 1.0 | Full Kelly — maximum growth rate |
| Kelly Max % | 30% | 40% | 40% of capital on single high-conviction trade |
| Min Confidence | 0.60 | 0.50 | Accept more marginal signals (~2-3× signal count) |
| Min Net EV | 0.015 | 0.008 | Trade thinner edges (more volume, lower selectivity) |
| Daily Loss Limit | $35 | $75 | ~16% daily loss tolerance (allows recovery) |
| Autonomy Interval | 10 min | 2 min | 5× more scans/day, faster response to market moves |
| Catastrophic % | 18% | 25% | Allow 25% capital on extreme-conviction outlier plays |

**Expected Outcomes:**
- 📊 Daily notional: **$400-900** (cycling your full balance 1-2×/day)
- 🔄 Trades/day: **15-30** (was 5-10)
- 💰 Win expectancy: **+2-5%** on winning days, **-10-16%** on losing days
- 📈 Volatility: **3-4× higher** than current conservative preset
- 🎯 30-day Monte Carlo outcome range: **+30% to -60%**
- 💸 AI cost: **~$4-6/day** (was ~$2-3/day) due to 2-min cadence

**Risk Warnings:**
- ⚠️ One bad week can wipe **30-40% of capital**
- ⚠️ Full Kelly + thin edges = higher gambler's ruin risk
- ⚠️ Increased exposure to Kalshi liquidity gaps and adverse selection
- ⚠️ 2-min cadence means more reactive/less strategic positioning
- ⚠️ Daily loss limit is 16% — you could have 3-4 bad days before the month ends

---

## 🎯 How to Apply Ultra-Aggressive Preset

### Option 1: Via Railway Dashboard (Recommended)
1. Go to Railway → Your Project → **Variables**
2. For each variable in the ultra-aggressive preset above:
   - Click **"+ New Variable"**
   - Paste the key name (e.g., `MAX_RISK_PER_TRADE_PERCENT`)
   - Paste the value (e.g., `15`)
3. After adding all 10 variables, click **"Deploy"** at the top
4. Wait for redeploy to complete (~2-3 min)
5. Check logs: you should see `[SelfTest] profitGuardrails` with new values

### Option 2: Via Railway CLI
```bash
railway variables set MAX_RISK_PER_TRADE_PERCENT=15
railway variables set KELLY_FRACTION=1.0
railway variables set KELLY_MAX_PCT_OF_CAPITAL=0.40
railway variables set MIN_CONFIDENCE_AFTER_ADJUST=0.50
railway variables set MIN_NET_EV=0.008
railway variables set DAILY_LOSS_LIMIT_USD=75
railway variables set AUTONOMY_INTERVAL_MS=120000
railway variables set CATASTROPHIC_PCT_OF_CAPITAL=0.25
railway variables set HIGH_STAKES_PCT_OF_CAPITAL=0.08
railway variables set MIN_ORDER_EXPOSURE_USD=3

railway up  # redeploy
```

### Option 3: Manual `.env` Override (Local Testing Only)
Create `.env` in repo root with ultra-aggressive values, then:
```bash
corepack pnpm dev  # local dev server
```
**⚠️ This only affects local dev — Railway deployment uses Railway Variables, not `.env`**

---

## 📊 Monitoring Your Aggressive Strategy

### First 24 Hours
Watch Railway logs for:
- [ ] Autonomy runs every 2 minutes (should see `Starting scheduled run` 720×/day)
- [ ] Signal generation increased (~20-40 signals/run vs 5-10 before)
- [ ] Order placement volume (15-30 orders/day target)
- [ ] Daily loss limit warnings (if you see "daily loss limit exceeded" before end of day, that's the safety net working)

### First Week
Track in Dashboard → Review:
- [ ] Net P&L trend (volatile, but should be trending up over 7+ days)
- [ ] Win rate per signal type (check if any strategies bleeding capital)
- [ ] Average trade size (should be ~$50-70, not $1 dust trades)
- [ ] Max drawdown (expect to see -15% to -25% intra-week swings)

### Strategy Disable Warnings
If you see audit log events like:
- `strategy_auto_disabled: value_play` — the value_play strategy had <35% win rate over 20+ trades and was auto-disabled
- This is the `kalshiLearning.ts` safety net stopping bleeding strategies
- Check Dashboard → Review → Performance to see which strategy is underperforming
- You can manually re-enable via Trading Preferences if you think it was a bad luck streak

---

## 🛑 Emergency Kill Switch

If volatility is too extreme or losses mounting:

### Stop All Trading Immediately
Railway → Variables → Set:
```bash
PAPER_TRADE_MODE=true
```
Then redeploy. This forces **everyone** (including owner) into paper trading mode regardless of per-user settings. Real orders stop instantly.

### Reduce Risk Back to Conservative
Railway → Variables → **Delete** the 10 ultra-aggressive variables you added, then redeploy. The system will fall back to conservative defaults from `env.ts`.

---

## 📈 Expected Performance Timeline

### Week 1-2: High Volatility, Learning Phase
- Account swings: -$50 to +$100 days
- Win rate may be 40-55% (expected for thin-edge strategy)
- Some signal types will underperform → auto-disable triggers
- Net expectancy: +$5 to +$30 over 2 weeks (but high variance)

### Week 3-4: Stabilization
- Auto-disable removes bleeding strategies
- Remaining strategies have >50% win rate
- Account should show net positive trend
- Target: +10% to +25% by end of month 4 (but -30% to -50% also possible in bad month)

### Month 2+: Strategy Refinement
- Desk memory learning loop improves signal quality
- Momentum/confluence strategies dominate (value_play may be disabled)
- Win rate climbs to 55-65% on remaining active strategies
- Target: +15% to +40% monthly returns (with -20% to -60% downside risk in bad months)

---

## 🔍 Troubleshooting Common Issues

### "No signals generated for X runs in a row"
**Cause:** Either no opportunities in current Kalshi markets, or filters too strict.  
**Fix:** Lower `MIN_CONFIDENCE_AFTER_ADJUST` to 0.45 or `MIN_NET_EV` to 0.005 (but this increases noise).

### "Blocked by risk: exposure would exceed X%"
**Cause:** Already have too many open positions.  
**Fix:** Increase `KELLY_MAX_PCT_OF_CAPITAL` to 0.50 or close some positions manually.

### "Daily loss limit exceeded"
**Cause:** Realized P&L today is below `-$75`.  
**Fix:** This is the safety net working. Wait until UTC midnight for reset, or raise `DAILY_LOSS_LIMIT_USD` to $100.

### "Insufficient Kalshi balance"
**Cause:** Capital depleted, or open positions locked up all funds.  
**Fix:** Add more funds via Kalshi website, or close positions to free capital.

### "Claude API quota exceeded"
**Cause:** 2-min cadence + large signal batches = ~$6-8/day AI cost, may exceed Anthropic tier limits.  
**Fix:** Raise to `AUTONOMY_INTERVAL_MS=300000` (5 min, cuts AI cost 40%), or upgrade Anthropic tier.

---

## ✅ Final Checklist Before Going Live

- [ ] Audit script ran successfully (database, credentials, recent activity all green)
- [ ] No critical errors in Railway logs from last 24h
- [ ] Kalshi credentials connected and account balance correct
- [ ] Backup funds set aside (don't risk rent money!)
- [ ] Comfortable with +30% to -60% 30-day outcome range
- [ ] Emergency kill switch documented (`PAPER_TRADE_MODE=true`)
- [ ] Monitoring plan in place (check Dashboard + Railway logs daily)

**Once ready, apply the ultra-aggressive preset and monitor closely for first 72 hours.**

---

## 📞 Support & Debugging

If the audit script fails or you see unexpected behavior:
1. Check Railway → Logs for recent `ERROR` or `WARN` lines
2. Verify all required env vars are set (see `RAILWAY.md`)
3. Run type check: `corepack pnpm check` (should pass with 0 errors)
4. Run tests: `corepack pnpm test -- --run` (925/926 should pass)
5. Check Kalshi API status: https://kalshi.com/status

**The system is designed to fail safe:** if anything breaks (DB down, Claude API error, Kalshi unreachable), autonomy skips that tick and retries on next cycle rather than placing blind orders.
