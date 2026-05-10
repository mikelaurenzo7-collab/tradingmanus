# 🚀 Quick Start: Ultra-Aggressive Trading Mode

Your system is ready for maximum profit optimization. Here's what to do:

---

## ⚡ Step 1: Run the System Audit (5 minutes)

### Get your DATABASE_URL from Railway:
1. Railway → Your Project → **Variables** tab
2. Copy the `DATABASE_URL` value

### Run the audit:
```bash
DATABASE_URL='your-connection-string' corepack pnpm tsx scripts/deepAudit.ts
```

**This will show you:**
- ✅ Is everything connected? (Database, Kalshi credentials)
- 🤖 Are trades executing? (Recent autonomy runs, orders)
- 💰 What's your current balance and P&L?
- ❌ Any errors blocking trades?
- 🔥 **Ultra-aggressive preset recommendations**

---

## 🔥 Step 2: Apply Ultra-Aggressive Preset (2 minutes)

If audit looks good, go to **Railway → Variables** and add these 10 variables:

```
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

Then click **"Deploy"** at the top.

**This will:**
- Check markets every **2 minutes** (5× faster)
- Bet up to **$69/trade** (was $27)
- Accept **more signals** (50% confidence vs 60%)
- Trade **thinner edges** (0.8% EV vs 1.5%)
- Target **15-30 trades/day** (was 5-10)

---

## 📊 What to Expect

### On a Good Day:
- 20-25 trades executed
- $500-700 total notional volume
- +$15 to +$40 profit
- **+3-8% balance growth**

### On a Bad Day:
- 15-20 trades executed
- $400-600 total notional volume
- -$40 to -$75 loss (hits daily stop)
- **-8-16% balance decline**

### Over a Month:
- **Best case:** +30% to +50% ($459 → $600-690)
- **Expected:** +15% to +25% ($459 → $530-575)
- **Worst case:** -30% to -60% ($459 → $320-180)

**This is 3-4× more volatile than your current conservative setup.**

---

## 🛑 Emergency Stop

If it's too wild, immediately set:
```
PAPER_TRADE_MODE=true
```
in Railway → Variables, then redeploy. All real trading stops instantly.

---

## 📋 Monitor First 48 Hours

Check every few hours:
1. **Railway → Logs:** Autonomy runs every 2 min?
2. **Dashboard → Review:** Trades showing up?
3. **Balance:** Still above $350? (if not, consider reducing risk)

After 2 days you'll know if this pace works for you.

---

## 📖 Full Documentation

- **SYSTEM_AUDIT_RESULTS.md** — Complete audit guide + troubleshooting
- **scripts/deepAudit.ts** — Audit script source code
- **CLAUDE.md** — Full system architecture reference
- **RAILWAY.md** — Deployment guide

---

**You're all set. Run the audit, apply the preset, and watch it trade.**
