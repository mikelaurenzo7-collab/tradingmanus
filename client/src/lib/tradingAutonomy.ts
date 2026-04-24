export const AUTONOMY_MODES = [
  "manual",
  "approval_required",
  "semi_autonomous",
  "fully_autonomous",
] as const;

export const EXECUTION_CADENCES = [
  "manual_only",
  "session_assisted",
  "hourly_watch",
  "continuous_watch",
] as const;

export const RISK_POSTURES = [
  "conservative",
  "balanced",
  "aggressive",
] as const;

export type TradingAutonomyMode = (typeof AUTONOMY_MODES)[number];
export type ExecutionCadence = (typeof EXECUTION_CADENCES)[number];
export type RiskPosture = (typeof RISK_POSTURES)[number];

export type TradingPreferences = {
  autonomyMode: TradingAutonomyMode;
  liveTradingEnabled: boolean;
  executionCadence: ExecutionCadence;
  riskPosture: RiskPosture;
  minSignalConfidence: number;
  maxOrderNotional: number;
  maxDailyOrders: number;
  requireApprovalAbove: number;
};

export const DEFAULT_TRADING_PREFERENCES: TradingPreferences = {
  autonomyMode: "approval_required",
  liveTradingEnabled: false,
  executionCadence: "manual_only",
  riskPosture: "balanced",
  minSignalConfidence: 0.72,
  maxOrderNotional: 10,
  maxDailyOrders: 3,
  requireApprovalAbove: 8,
};

export function getAutonomyModeLabel(mode: TradingAutonomyMode) {
  switch (mode) {
    case "manual":
      return "Manual"
    case "approval_required":
      return "Approval required";
    case "semi_autonomous":
      return "Semi-autonomous";
    case "fully_autonomous":
      return "Fully autonomous";
  }
}

export function getAutonomyModeDescription(mode: TradingAutonomyMode) {
  switch (mode) {
    case "manual":
      return "The agent may research and rank setups, but it will not place live orders.";
    case "approval_required":
      return "The agent prepares candidate trades, but every live order still needs your explicit approval.";
    case "semi_autonomous":
      return "The agent may auto-execute smaller trades that meet your thresholds, while larger trades still pause for approval.";
    case "fully_autonomous":
      return "The agent may place eligible live orders automatically within your stored guardrails while live trading is armed.";
  }
}

export function getExecutionCadenceLabel(cadence: ExecutionCadence) {
  switch (cadence) {
    case "manual_only":
      return "Manual only";
    case "session_assisted":
      return "During guided sessions";
    case "hourly_watch":
      return "Hourly watch";
    case "continuous_watch":
      return "Continuous watch";
  }
}

export function getRiskPostureLabel(riskPosture: RiskPosture) {
  switch (riskPosture) {
    case "conservative":
      return "Conservative";
    case "balanced":
      return "Balanced";
    case "aggressive":
      return "Aggressive";
  }
}

export function getAutonomyStatusSummary(preferences: TradingPreferences) {
  if (preferences.autonomyMode === "manual") {
    return {
      title: "Manual research mode",
      body: "Live orders remain disabled until you choose an autonomy mode that permits execution.",
      tone: "text-slate-300",
    };
  }

  if (!preferences.liveTradingEnabled) {
    return {
      title: `${getAutonomyModeLabel(preferences.autonomyMode)} policy saved`,
      body: "The policy is configured, but live trading is currently disarmed.",
      tone: "text-amber-300",
    };
  }

  return {
    title: `${getAutonomyModeLabel(preferences.autonomyMode)} is armed`,
    body: "The app may submit live orders according to your stored thresholds and risk posture.",
    tone: "text-emerald-300",
  };
}

export function formatConfidence(value: number) {
  return `${Math.round(value * 100)}%`;
}
