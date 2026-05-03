import { getTodayRealizedLoss, getKalshiCapital, logAuditEvent } from "../db";
import { getTradingPreferences, saveTradingPreferences } from "../db.trading-preferences";
import { alertDrawdown } from "./alerting";
import type { TradingPlatform } from "./tradingMode";

export type DrawdownTier = "ok" | "warn" | "pause" | "panic" | "already_paused";

export interface DrawdownEvalResult {
  tier: DrawdownTier;
  lossPct: number;
  shouldPause: boolean;
}

export async function evaluateDrawdown(
  userId: number,
  platform: TradingPlatform,
  triggeredByOpenId: string
): Promise<DrawdownEvalResult> {
  const prefs = await getTradingPreferences(userId);

  const isPaused = platform === "kalshi" ? Boolean(prefs.kalshiPaused) : Boolean(prefs.polymarketPaused);
  if (isPaused) {
    return { tier: "already_paused", lossPct: 0, shouldPause: false };
  }

  // Only Kalshi capital tracked in SP-1; Polymarket deferred to SP-5
  const capital = platform === "kalshi" ? await getKalshiCapital(userId) : null;
  const startEquity = Number(capital?.currentBalance ?? capital?.startingBalance ?? 0);

  if (startEquity <= 0) {
    return { tier: "ok", lossPct: 0, shouldPause: false };
  }

  const realizedLoss = platform === "kalshi" ? await getTodayRealizedLoss(userId) : 0;
  const lossPct = (realizedLoss / startEquity) * 100;

  if (lossPct >= prefs.drawdownPanicPct) {
    await saveTradingPreferences(userId, platform === "kalshi" ? { kalshiPaused: 1 } : { polymarketPaused: 1 });
    void alertDrawdown(userId, platform, { level: "panic", lossPct, threshold: prefs.drawdownPanicPct });
    void logAuditEvent("drawdown_auto_pause", JSON.stringify({ platform, tier: "panic", lossPct, threshold: prefs.drawdownPanicPct }), triggeredByOpenId);
    return { tier: "panic", lossPct, shouldPause: true };
  }

  if (lossPct >= prefs.drawdownPausePct) {
    await saveTradingPreferences(userId, platform === "kalshi" ? { kalshiPaused: 1 } : { polymarketPaused: 1 });
    void alertDrawdown(userId, platform, { level: "pause", lossPct, threshold: prefs.drawdownPausePct });
    void logAuditEvent("drawdown_auto_pause", JSON.stringify({ platform, tier: "pause", lossPct, threshold: prefs.drawdownPausePct }), triggeredByOpenId);
    return { tier: "pause", lossPct, shouldPause: true };
  }

  if (lossPct >= prefs.drawdownWarnPct) {
    void alertDrawdown(userId, platform, { level: "warn", lossPct, threshold: prefs.drawdownWarnPct });
    return { tier: "warn", lossPct, shouldPause: false };
  }

  return { tier: "ok", lossPct, shouldPause: false };
}
