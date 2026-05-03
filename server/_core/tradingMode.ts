import { ENV } from "./env";
import { getTradingPreferences } from "../db.trading-preferences";
import type { TradingMode } from "../db.trading-preferences";

export type TradingPlatform = "kalshi" | "polymarket";
export type { TradingMode };

export interface EffectiveModeResult {
  mode: TradingMode;
  paused: boolean;
  reason: string;
  source: "env_override" | "manual_pause" | "user_setting" | "error_reading_prefs";
}

export async function getEffectiveMode(
  userId: number,
  platform: TradingPlatform
): Promise<EffectiveModeResult> {
  try {
    const override = ENV.tradingModeOverride;

    if (override === "pause") {
      return { mode: "shadow", paused: true, reason: "TRADING_MODE_OVERRIDE=pause", source: "env_override" };
    }

    const prefs = await getTradingPreferences(userId);
    const isPaused = platform === "kalshi"
      ? Boolean(prefs.kalshiPaused)
      : Boolean(prefs.polymarketPaused);
    const userMode: TradingMode = (platform === "kalshi" ? prefs.kalshiMode : prefs.polymarketMode) ?? "shadow";

    if (isPaused) {
      return { mode: userMode, paused: true, reason: `${platform} manually paused`, source: "manual_pause" };
    }

    if (override === "shadow") {
      return { mode: "shadow", paused: false, reason: "TRADING_MODE_OVERRIDE=shadow", source: "env_override" };
    }

    return { mode: userMode, paused: false, reason: `user setting: ${userMode}`, source: "user_setting" };
  } catch {
    return { mode: "shadow", paused: true, reason: "error reading trading preferences", source: "error_reading_prefs" };
  }
}
