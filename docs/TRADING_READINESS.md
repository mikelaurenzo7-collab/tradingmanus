# Graduated Go-Live Guide: From Paper Trading to Full Autonomy

This guide walks you through the safe path from paper trading → micro-funding → scaling up to full autonomy on **Kalshi** and **Polymarket**. Follow each phase carefully. Trading is rewarding; mistakes are costly.

---

## When You're Ready: Pre-Launch Checklist

Before moving any real capital, confirm all of these:

- [ ] **Paper trading mode active for 7+ days** — You've run at least 50 cycles in paper mode, watching the system behave under realistic conditions.
- [ ] **At least 30 autonomy cycles completed in paper mode** — The scheduler has run, orders have been placed and filled, positions have been tracked.
- [ ] **Desk memory has ≥4 lessons per desk** — Each of your 16 desks (platform × category) has accumulated at least 4 learnings (check the `deskMemory` table). This shows the learning feedback loop is active.
- [ ] **Signal accuracy in paper >60%** — Your win rate across all trades (realized P&L / trades placed) is better than 60%. This is your baseline proof-of-concept.
- [ ] **No stuck orders or reconciliation errors in audit log** — Run a query on `auditLog`: filter for the last 30 cycles and check for `kalshi_order_sync_error` or `order_pending_reconciliation_timeout`. Zero is expected.
- [ ] **Risk parameters validated** — You've reviewed `tradingPreferences` and confirmed `maxPositionSizePercent`, `maxDailyLossPercent`, and `maxOpenPositions` match your risk appetite.
- [ ] **Kalshi/Polymarket API credentials verified** — Test a live fetch on both platforms (use the endpoint `/api/trpc/kalshi.testConnection` and `/api/trpc/polymarket.testConnection` if available, or do a manual test in the UI). No auth errors.

**If any checkbox is unchecked, stay in paper mode.**

---

## Phase 1: Micro-Funding ($100–$500)

**Goal:** Validate real order execution without risking significant capital. Prove that the system works end-to-end on real money.

### Setup

1. **Turn off PAPER_TRADE_MODE**
   - Set the environment variable `PAPER_TRADE_MODE=false` and restart the server.
   - This routes all orders to the real Kalshi and Polymarket APIs.
   - **Point of no return.** Verify credentials before restarting.

2. **Fund Kalshi account**
   - Deposit $100 (or your chosen micro amount) into your Kalshi account.
   - Verify the balance in Kalshi's web dashboard. It should appear within 5 minutes.

3. **Set ultra-conservative risk parameters**
   - Edit `tradingPreferences` in the database (or via the UI, if available):
     - `maxPositionSizePercent = 0.5%` (e.g., $0.50 per trade on a $100 account)
     - `maxDailyLossPercent = 2%` (hard stop at -$2 for the day)
     - `maxOpenPositions = 1` (one trade at a time; easy to monitor)
   - Keep `autonomyEnabled = false` for now. You'll run cycles manually.

4. **Run autonomy manually**
   - Use the endpoint `/api/trpc/kalshi.runAutonomy` (POST) or trigger via UI, if available.
   - Monitor the first cycle closely:
     - Check the audit log: did it emit `kalshi_signal_pipeline`?
     - Were any signals generated? If yes, did the reviewer approve them?
     - Did an order get placed? Check Kalshi's order history.
   - **Expected outcome:** 0–1 order placed, no errors.

### Monitoring: First 1–2 Weeks

After each cycle (or daily, if you prefer), check these:

#### Audit Log (Post-Run)
```sql
SELECT 
  eventType, 
  payload, 
  createdAt 
FROM auditLog 
WHERE userId = (your user id)
  AND createdAt > NOW() - INTERVAL '1 day'
ORDER BY createdAt DESC;
```

Look for:
- `kalshi_signal_pipeline` — How many signals generated? How many passed filters? Were any reviewed?
- `kalshi_reviewer_telemetry` — Token usage, cache hits, any `web_search` calls?
- `kalshi_order_placed` — Order ID, size, market, entry price.
- `kalshi_order_blocked_or_failed` — Why was the order rejected? (e.g., "risk_block_max_daily_loss", "execution_error")
- `scheduled_autonomy_run_executed` / `generated_only` / `skipped` — Status of the run.

#### Real Fills vs. Paper
- Compare the real filled price to the market mid-price at order time.
- Slippage of 1–3 cents is normal. >5 cents suggests execution issues or tight limits.

#### Credential Health
- No `kalshi_auth_error` in the audit log? Good.
- Kalshi's dashboard shows correct account balance? Match it to your records.

#### Desk Memory Updates
```sql
SELECT 
  category, 
  platform, 
  lessonsCount, 
  lastUpdateAt 
FROM deskMemory 
WHERE userId = (your user id)
ORDER BY lastUpdateAt DESC;
```

- Expect 1 new lesson per trade (win or loss). By end of week 1, you should have 5–10 new lessons total.
- Lesson content should be sensible (e.g., "Tech contracts lose on down days" or "Healthcare contracts over-trade at 3 PM").
- If lessons are gibberish, the Claude reviewer may be hallucinating; file a bug.

#### Running Balance & P&L
```sql
SELECT 
  balance, 
  dailyPnL, 
  recordedAt 
FROM kalshiCapital 
WHERE userId = (your user id)
ORDER BY recordedAt DESC 
LIMIT 10;
```

- Track your ending balance daily. Did it match Kalshi's dashboard?
- Is your P&L roughly in line with signal quality and position sizes?

### Success Criteria (After 1–2 Weeks)

✅ **Phase 1 success:**
- 10+ trades executed in real money without errors.
- Zero authentication failures.
- Actual filled prices match or beat simulated fills (real market conditions often favor patient traders).
- Desk memory has 10+ new lessons, showing consistent learning.
- Running balance is ≥95% of starting capital (i.e., losses <5%).

### Abort Signals (Pause & Investigate)

🛑 **If you see any of these, stop autonomy immediately:**
- >30% loss in a single day or cumulatively in the phase.
- 3+ credential authentication failures (check API key and private key validity).
- Consistent stuck orders (pending for >30 min in the real API).
- Audit log shows risk blocks on >50% of signals (tuning may be needed).

**Recovery step:** Pause autonomy, post a snapshot of the audit log, and investigate the root cause with a fresh pair of eyes.

---

## Phase 2: Small Account ($500–$5K)

**Goal:** Build confidence in autonomy scheduling and larger position sizes. Run the system hands-off for 4–8 weeks and prove it can handle continuous operation.

### Setup

1. **Increase funding**
   - Fund your Kalshi account to $500–$5K (whatever matches your risk tolerance).
   - Keep Polymarket credentials ready, but you may not need them yet.

2. **Gradually increase risk parameters**
   - Week 1 of Phase 2:
     - `maxPositionSizePercent = 1%` (e.g., $5 per trade on a $500 account)
     - `maxDailyLossPercent = 3%`
     - `maxOpenPositions = 2`
   - Week 3 of Phase 2 (only if Week 1–2 went well):
     - `maxPositionSizePercent = 1.5%`
     - `maxDailyLossPercent = 4%`
     - `maxOpenPositions = 3`
   - **Do not increase further without 4+ weeks of stable performance.**

3. **Enable autonomy scheduling**
   - Set `autonomyEnabled = true` in `tradingPreferences`.
   - The autonomy runner will spawn a new cycle every 15 minutes.
   - **You no longer run cycles manually.** The system is now self-driving.

### Monitoring: 4–8 Weeks

Unlike Phase 1, you don't need to monitor every cycle. But you do need a daily ritual:

#### Daily Check (5 min)
```sql
SELECT 
  COUNT(*) as cycles_today,
  SUM((payload->>'order_count')::int) as orders_placed,
  SUM((payload->>'risk_blocks')::int) as risk_blocks,
  MIN((payload->>'timestamp')::timestamp) as earliest_cycle
FROM auditLog 
WHERE eventType = 'scheduled_autonomy_run_executed'
  AND userId = (your user id)
  AND DATE(createdAt) = CURRENT_DATE;
```

- **Cycles today:** Expect 96 cycles (15-min interval, 24 hours). If significantly fewer, the scheduler may have crashed. Restart the server.
- **Orders placed:** Expect 0–3 per day on average. High variance is normal.
- **Risk blocks:** Are they >20% of signals? If so, markets may have changed; consider retraining signals.

#### Weekly Check (30 min)
```sql
SELECT 
  DATE(createdAt) as day,
  COUNT(DISTINCT eventType) as event_types,
  SUM(CASE WHEN payload->>'order_status' = 'filled' THEN 1 ELSE 0 END) as filled,
  SUM(CASE WHEN payload->>'order_status' = 'cancelled' THEN 1 ELSE 0 END) as cancelled
FROM auditLog 
WHERE userId = (your user id)
  AND createdAt > NOW() - INTERVAL '7 days'
GROUP BY DATE(createdAt)
ORDER BY day DESC;
```

- Trend: Are fills improving (more filled, fewer cancelled)?
- Cancellations: >20% cancellation rate suggests execution slippage or limits too tight.

#### Weekly: Desk Memory Review
```sql
SELECT 
  platform, 
  category, 
  lessonsCount, 
  lastUpdateAt 
FROM deskMemory 
WHERE userId = (your user id)
ORDER BY lastUpdateAt DESC;
```

- By week 4, you should have 30+ lessons across all desks.
- By week 8, 60+ lessons.
- Sample a few lessons (inspect the `lessons` JSONB field): are they coherent? Contradictory lessons are OK early on; they should stabilize by week 6.

#### Monthly Check (60 min)
- Compare **paper-mode P&L projection** (from your backtest or paper trading phase) to **real P&L**.
- Expect real P&L to be within ±20% of paper projection.
- If real P&L is 50%+ worse:
  - Check slippage: are fills consistently 5+ cents off market price?
  - Check order timing: are you hitting limits too tight?
  - Consider market regime change: are conditions different from paper training period?
  - Retrain desk memory (pause autonomy for 1 week, run fresh signal generation in paper mode, then restart).

#### Monthly: Risk Guardrail Health
```sql
SELECT 
  (payload->>'max_daily_loss')::float as max_daily_loss_config,
  MAX((payload->>'daily_pnl')::float) as worst_day_pnl,
  SUM((payload->>'position_count')::int) as total_positions_opened
FROM auditLog 
WHERE eventType = 'scheduled_autonomy_run_executed'
  AND userId = (your user id)
  AND createdAt > NOW() - INTERVAL '30 days'
GROUP BY (payload->>'max_daily_loss')::float;
```

- Have you ever hit the daily loss limit? If yes, review that day's audit log and understand what happened.
- Largest single open position: does it exceed 30% of your account? If yes, consider lowering `maxPositionSizePercent`.

### Success Criteria (After 4–8 Weeks)

✅ **Phase 2 success:**
- Autonomy has run smoothly, spawning cycles every 15 min with <1% failure rate.
- Desk memory has 30+ lessons per platform, showing active learning and feedback loops.
- Real P&L is within ±20% of paper P&L projection.
- No liquidations, margin calls, or account-level errors.
- Risk blocks are <20% of signals (tuning is working).
- At least one week with zero loss (positive P&L).

### Abort Signals (Retrain & Reassess)

🛑 **If you see any of these, pause autonomy for 1–2 weeks:**
- >50% cumulative loss in the phase.
- Consistent underperformance vs. paper (>30% gap for 3+ weeks).
- Desk memory learning plateaus (same lessons repeating verbatim, no new patterns).
- Cancellation rate >30% (execution breakdown).
- >5 credential failures or order reconciliation timeouts.

**Recovery step:** Pause autonomy, retrain desk memory (optional: reset it and start fresh), and investigate signal quality. If you suspect market regime change, backtest signals on recent data before resuming.

---

## Phase 3: Full Scale (Your Comfort Level)

**Goal:** Normal trading operations. The system runs autonomously; you monitor at a high level.

### Setup

1. **Increase risk parameters to target profile**
   - Set `maxPositionSizePercent`, `maxDailyLossPercent`, and `maxOpenPositions` to your desired operational profile.
   - Example: `maxPositionSizePercent = 2.5%`, `maxDailyLossPercent = 5%`, `maxOpenPositions = 5`.
   - These should be derived from your Phase 2 experience and your risk tolerance.

2. **Fund to your desired account size**
   - Deposit capital for full-scale operations.
   - Keep a 2–3 week cash reserve (don't deploy 100% to trading).

3. **Enable continuous autonomy**
   - `autonomyEnabled = true` (already set from Phase 2).
   - The system now runs 24/7. You do not intervene unless something breaks.

### Monitoring: Ongoing (Weekly & Monthly)

#### Weekly Summary (10 min)
- Run the daily check above; aggregate across 7 days.
- Expected metrics by week:
  - 600–800 autonomy cycles (96 per day × 7).
  - 5–20 orders placed (variance is normal).
  - 0–5 risk blocks (if >10, investigate signal quality).
  - Net P&L: should trend positive over time (not necessarily every week).

#### Monthly Deep Dive (60 min)

**Audit Log Summary:**
```sql
SELECT 
  DATE_TRUNC('day', createdAt) as day,
  COUNT(*) as total_events,
  COUNT(DISTINCT CASE WHEN eventType = 'kalshi_order_placed' THEN 1 END) as orders_placed,
  COUNT(DISTINCT CASE WHEN eventType = 'kalshi_order_blocked_or_failed' THEN 1 END) as orders_blocked,
  SUM((payload->>'pnl')::float) as daily_pnl
FROM auditLog 
WHERE userId = (your user id)
  AND createdAt > NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', createdAt)
ORDER BY day DESC;
```

- **Total events:** Expect 100–200 per day (audit log is verbose).
- **Orders placed:** Trend should be stable month-to-month (±20%).
- **Orders blocked:** Should be <10% of signals generated. If rising, markets are changing.
- **Daily P&L:** Chart it. Expect positive slope over time; individual weeks may be flat or slightly negative.

**Desk Memory Health:**
- Lessons should continue to accumulate (1–3 per day on average).
- Lesson diversity: are you learning new patterns, or just repeating old ones?
- If repeating: consider a refresh (Sundays: manually clear desk memory and let it rebuild).

**P&L vs. Backtest:**
- Compare monthly realized P&L to your backtested projection.
- Expect realized to be 70–90% of backtest (real-world drag is normal).
- If <50%, investigate:
  - Have market conditions changed (volatility, liquidity)?
  - Have your heuristics become stale (e.g., old market data in cached signals)?
  - Is the Claude reviewer being overly conservative (reviewing too many signals as low-confidence)?

#### Quarterly Backtest Review (2 hours)

Once per quarter (every 3 months), re-run your backtest on the latest market data (last 60 days):
1. Export recent market snapshots from `kalshiMarketSnapshots`.
2. Regenerate signals using the same heuristics.
3. Compare backtest P&L to real P&L from the same period.
4. If backtest P&L has dropped >30% vs. your original backtest, signals may be stale. Investigate:
   - Market regime change (volatility, liquidity)?
   - Heuristic drift (are the same trades working)?
   - Kalshi/Polymarket API changes?

### Early Warning Signs (Quarterly Checkups)

🟡 **Yellow flags — investigate, no action yet:**
- Desk memory learning **plateaus** (same lessons repeating for 2+ weeks).
- Consistent underperformance vs. backtested projections (70%+ of backtest).
- Rising risk blocks (>15% of signals blocked for 2+ weeks).
- High cancellation rate (>15% of orders cancelled).
- Slower signal generation (fewer than 5 signals per cycle on average).

🔴 **Red flags — pause and investigate immediately:**
- Desk memory **learning stops** (zero new lessons for 1 week).
- Real P&L drops below 50% of backtest P&L for 1+ month.
- Risk blocks spike to >50% of signals.
- Recurring credential failures (3+ in 1 week).
- Stuck orders (reconciliation errors) for >6 hours.

### Recovery Protocol

**If you hit a yellow or red flag:**

1. **Pause autonomy** — Set `autonomyEnabled = false`. The system stops placing orders.
2. **Investigate** — Review the audit log, desk memory, and recent market conditions.
3. **Diagnose:**
   - Are markets different (volatility, regime change)?
   - Are heuristics stale (backtested on old data)?
   - Is Claude being overly conservative (reviewer tuning needed)?
   - Is there a bug (check for error events in audit log)?
4. **Fix:**
   - Retrain desk memory (clear it, re-enable autonomy for 1 week in paper mode).
   - Refresh signal generation (re-run backtests on latest data).
   - Adjust Claude reviewer prompts (if it's being too cautious).
   - Patch bugs (if found).
5. **Resume** — After 1–2 weeks of paper-mode validation, re-enable autonomy in production.

---

## Monitoring Checklist Template

Use this template weekly and monthly:

```markdown
## Weekly Audit Log Review

**Reporting Period:** [start_date] to [end_date]

### Summary Metrics
- [ ] Total autonomy cycles: ___ (expected: ~672 if running 24/7)
- [ ] Orders placed (real): ___ 
- [ ] Orders blocked (risk guardrails): ___
- [ ] Orders failed (execution error): ___
- [ ] Avg P&L per trade: $___
- [ ] Worst day P&L: $___
- [ ] Best day P&L: $___
- [ ] Running balance (end of week): $___
- [ ] Capital reserve: $___

### Order Reconciliation
- [ ] Any stuck/pending orders? (yes/no) 
  - If yes, order IDs: ___
- [ ] Cancellation rate: ___ %
  - (should be <15%)
- [ ] Slippage (real vs. mid-price): ___ cents avg
  - (should be <3 cents)

### Desk Memory Health
- [ ] Total lessons accumulated: ___
  - Kalshi: ___
  - Polymarket: ___
- [ ] Lessons added this week: ___
- [ ] Most recent lesson date: ___
- [ ] Any nonsensical lessons? (yes/no)
  - If yes, flag for review

### Risk Guardrails
- [ ] Max position size (config): ___
- [ ] Largest single position (realized): $___
- [ ] Max daily loss (config): $___
- [ ] Worst day loss: $___
  - (should be >config if hit the limit once)
- [ ] Max open positions (config): ___
- [ ] Peak open positions (realized): ___

### Execution Quality
- [ ] Signal generation count (avg per cycle): ___
- [ ] Signal approval rate (reviewer): ___ %
- [ ] Risk block rate: ___ %
  - (should be <20%)
- [ ] Execution block rate: ___ %

### Credential & Auth Health
- [ ] Any auth errors? (yes/no)
- [ ] Kalshi balance matches dashboard? (yes/no)
- [ ] Polymarket balance matches dashboard? (yes/no)
```

---

## Troubleshooting

### Q: Real P&L is 50% worse than paper. What should I do?

**A:** This is common. Diagnose:

1. **Slippage vs. paper assumption:**
   - In paper mode, we assume perfect fills at market mid-price.
   - In real trading, you may hit slightly worse prices (market impact, limit delays).
   - Check: are real fills consistently 2–5 cents off the mid? This is normal.
   - If >5 cents, check order timing and limit tightness.

2. **Market regime change:**
   - Your paper trading may have been in different market conditions (e.g., high volatility, abundant liquidity).
   - Real market may have lower liquidity or different volatility profile.
   - Solution: Retrain desk memory on real market conditions.

3. **Signal staleness:**
   - Your heuristics were tuned on historical data; real markets may have drifted.
   - Check backtest P&L on recent market data (last 60 days).
   - If backtest P&L dropped, heuristics need retuning.

4. **Reviewer being too conservative:**
   - Claude's reviewer may be approving fewer signals or downgrading confidence.
   - Check: reviewer telemetry in audit log. Are approval rates lower than expected?
   - If yes, review Claude's system prompt and consider loosening thresholds slightly.

**Recovery:** Pause autonomy for 1 week. Retrain desk memory in paper mode with fresh signal generation on recent market data. Resume with confidence.

---

### Q: Desk memory is full of contradictory lessons.

**A:** This is normal in the first 4 weeks. Lessons are noisy early on. But if contradictions persist, investigate:

1. **Sample the lessons:**
   ```sql
   SELECT lessons 
   FROM deskMemory 
   WHERE category = 'TECH' AND platform = 'KALSHI' 
   LIMIT 1;
   ```
   - Are lessons like "Tech up on positive earnings" *and* "Tech down on positive earnings" both present?
   - Or are they just different specific patterns (e.g., "Tech up on earnings *surprise*" vs. "Tech down on earnings *miss*")?

2. **If truly contradictory (same condition, opposite outcome):**
   - This suggests the heuristics are not robust to market regime changes.
   - Clear desk memory and retrain on 4 weeks of new data.
   - Or: adjust heuristics to be more specific (e.g., filter by time-of-day, volatility regime, etc.).

3. **If different patterns (learning is nuanced):**
   - Congratulations. The system is learning. This is expected by week 6–8.

---

### Q: Should I add more capital mid-month?

**A:** No, not mid-month. Only add capital under these conditions:

1. You've had 4+ weeks of stable, **positive P&L trajectory.**
2. Desk memory has 30+ lessons, showing consistent learning.
3. You've hit no red flags (see "Recovery Protocol" above).
4. You have a clear plan for how the additional capital will be deployed.

**And:** Add conservatively. If you have $500 with +$100 profit, don't add $500 more. Add $100–$200 and re-evaluate after 2 weeks.

---

### Q: Can I toggle paper mode on/off without restarting?

**A:** No. Paper mode is controlled by the `PAPER_TRADE_MODE` environment variable, which is read at startup. To toggle:

1. Stop the server.
2. Set the env var.
3. Restart the server.

**Don't flip back and forth.** Each flip loses continuity in desk memory and order history. Commit to a decision for at least 4 weeks.

---

### Q: What if the scheduler crashes?

**A:** The autonomy scheduler runs in-process on Railway or via Vercel Cron. If it crashes:

1. **Symptom:** No audit log events for >30 min, and no new orders placed.
2. **First step:** Check server logs (Railway or Vercel dashboard).
3. **Common causes:**
   - Database connection pool exhausted (check `DATABASE_URL` pooling settings).
   - Distributed lock deadlock (rare; restart server to break).
   - Out-of-memory (check server resource usage).
   - Credential decryption error (check `CREDENTIAL_ENCRYPTION_SECRET`).
4. **Recovery:** Restart the server. The next cycle will pick up normally.

If crashes repeat >2x per week, file a bug with logs and investigate the root cause.

---

### Q: What if an order gets stuck (pending for >30 min)?

**A:** This is a real order on Kalshi/Polymarket. Kalshi orders usually fill within seconds; stuck orders usually indicate:

1. **Limit too tight** — You placed a buy order at $0.40 when market is at $0.42. Unlikely to fill.
   - Solution: Cancel manually via Kalshi web dashboard. Adjust order limits in the config.

2. **Kalshi API is slow** — Rare, but possible during high volume.
   - Solution: Wait 5 min, then check Kalshi. If still pending, cancel and re-place.

3. **Our order sync missed it** — The autonomy run cancelled the order, but our audit log wasn't updated.
   - Solution: Check Kalshi dashboard. If the order is actually filled or cancelled, manually update our database and audit log.

**Preventive:** Set a 2-minute auto-cancel on all orders. (This is configurable; ask for help if you need it.)

---

### Q: How do I know if the AI reviewer is working?

**A:** Check the audit log for `kalshi_reviewer_telemetry`:

```sql
SELECT 
  payload->>'model' as model,
  payload->>'token_usage' as tokens,
  payload->>'cache_hit_ratio' as cache_ratio,
  payload->>'web_search_calls' as web_searches,
  createdAt
FROM auditLog 
WHERE eventType = 'kalshi_reviewer_telemetry'
  AND userId = (your user id)
ORDER BY createdAt DESC 
LIMIT 10;
```

- **Model:** Should be `claude-sonnet-4-5` (or Opus for escalations).
- **Tokens:** Input + output tokens. Expect 2k–5k per review.
- **Cache ratio:** Should be 20–50% (prompt caching is working).
- **Web searches:** 0–2 per review (searching for recent news, earnings, etc.).

If you see zero web searches and low cache ratio for 2+ days, the reviewer may be misconfigured. File a bug.

---

### Q: What's the difference between "generated_only" and "executed" in the audit log?

**A:** 
- **`generated_only`** — Signals were generated and reviewed, but **no order was placed** (e.g., all signals scored too low, or risk guardrails blocked all candidates).
- **`executed`** — At least **one order was placed**.
- **`skipped`** — Autonomy cycle was skipped (e.g., market closed, user disabled autonomy).

All three are normal. `generated_only` cycles are expected on low-signal days. If you see **only** `skipped` for 2+ days, check if autonomy is enabled.

---

## Final Tips

### 1. Keep a trading journal.

Even if just audit log snapshots, **write down why you think Phase 2 went well (or poorly).** You'll want this context for Phase 3.

Example:
```
Week 3 of Phase 2 — Best week so far: +$150 P&L. 
Desk memory shows strong tech earnings lesson (positive outcomes on earnings surprise).
Market conditions: high volatility, abundant liquidity. 
May not persist if volatility drops.
```

### 2. Expect desk memory learning to take 4–6 weeks.

Early lessons (week 1–2) will be noisy. They stabilize by week 4–5 as you accumulate more outcomes. **Don't judge the system too harshly in the first month.**

### 3. Signal quality >> position sizing.

Start small, nail the signals, then scale. It's tempting to deploy larger positions early; resist. A 2% average winner at 1% position size beats a 1% average winner at 5% position size. The math is simple: **edge × sizing = P&L.** Focus on edge first.

### 4. The AI reviewer is your safety net, not your profit engine.

Claude vetos bad signals (based on fundamental, sentiment, and recency analysis). It **doesn't generate alpha.** Alpha comes from your heuristics (momentum, mean-reversion, sentiment, arbitrage). The reviewer just keeps you safe.

### 5. If anything feels off, pause.

Autonomy will always be there tomorrow. A 1-week pause to investigate is better than a month of slow bleed. Trust your gut.

---

## Checklists for Each Phase

### End of Phase 1 Sign-Off

- [ ] 10+ trades executed in real money, zero errors.
- [ ] Zero auth failures.
- [ ] Filled prices within 3 cents of market mid.
- [ ] Desk memory has 10+ new lessons.
- [ ] Running balance is ≥95% of starting capital.
- [ ] No stuck orders in audit log.
- [ ] Ready to increase risk params and enable autonomy.

### End of Phase 2 Sign-Off

- [ ] Autonomy ran for 4–8 weeks with <1% failure rate.
- [ ] Desk memory has 30+ lessons per platform.
- [ ] Real P&L within ±20% of paper projection.
- [ ] No liquidations, margin calls, or account errors.
- [ ] Risk blocks <20% of signals.
- [ ] At least 2 weeks with positive P&L.
- [ ] Ready for full-scale operations.

### End of Phase 3 (Ongoing)

- [ ] Continuous autonomy running smoothly.
- [ ] Weekly reviews showing stable metrics.
- [ ] Monthly P&L trending positive.
- [ ] Desk memory continuously learning (new lessons every week).
- [ ] No red flags (see "Early Warning Signs" above).
- [ ] Quarterly backtests showing signal robustness.
- [ ] Confidence in the system. Ready to scale further (optional).

---

## Support & Escalation

If you're stuck:

1. **Check the audit log first.** 90% of issues are visible there.
2. **Review this guide.** Ctrl+F for your symptom.
3. **Check the codebase CLAUDE.md.** Technical details are there.
4. **Ask for help.** File an issue with audit log exports and symptom description.

Good luck. Trade safe. Scale smart.

