import { ENV } from "./env";
import { getTradingPreferences } from "../db.trading-preferences";

export type TradingPlatform = "kalshi" | "polymarket";
export type TradingMode = "shadow" | "paper" | "live";

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
      ? Boolean((prefs as unknown as Record<string, unknown>).kalshiPaused)
      : Boolean((prefs as unknown as Record<string, unknown>).polymarketPaused);
    const rawMode = platform === "kalshi"
      ? (prefs as unknown as Record<string, unknown>).kalshiMode
      : (prefs as unknown as Record<string, unknown>).polymarketMode;
    const userMode: TradingMode = (rawMode as TradingMode) ?? "shadow";

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
