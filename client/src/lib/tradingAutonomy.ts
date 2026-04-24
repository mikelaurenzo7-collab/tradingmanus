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
      return "The agent may generate candidate trades during active app use or scheduled reviews, but every live order still needs your explicit approval.";
    case "semi_autonomous":
      return "The agent may auto-execute smaller eligible trades within your thresholds, including scheduled away-from-chat reviews, while larger trades still pause for approval.";
    case "fully_autonomous":
      return "The agent may place live orders automatically within your stored guardrails during eligible in-app flows and scheduled away-from-chat reviews once the latest build is published.";
  }
}

export function getExecutionCadenceLabel(cadence: ExecutionCadence) {
  switch (cadence) {
    case "manual_only":
      return "Manual only";
    case "session_assisted":
      return "During guided sessions";
    case "hourly_watch":
      return "Hourly review policy";
    case "continuous_watch":
      return "Continuous review policy";
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

  const usesAwayScanning =
    preferences.executionCadence === "hourly_watch" ||
    preferences.executionCadence === "continuous_watch";

  return {
    title: `${getAutonomyModeLabel(preferences.autonomyMode)} is armed`,
    body: usesAwayScanning
      ? "Your live-trading policy is armed for eligible execution flows. After you publish the latest build, scheduled reviews can keep evaluating markets while you are away."
      : "Your live-trading policy is armed for eligible in-app execution flows, but the selected cadence keeps execution supervised to active sessions.",
    tone: "text-emerald-300",
  };
}

export type AutonomyActivitySummary = {
  lastRun: null | {
    eventType: string;
    status: string;
    createdAt: string | Date;
    reason: string | null;
    signalsGenerated: number;
    executionCandidates: number;
    candidateMarketId: string | null;
    executedMarketId: string | null;
    autonomyMode: string | null;
    executionCadence: string | null;
  };
  lastOrder: null | {
    eventType: string;
    createdAt: string | Date;
    marketId: string | null;
    side: string | null;
    quantity: number | null;
    limitPrice: number | null;
    confidence: number | null;
    executionScore: number | null;
    reason: string | null;
  };
  recentActivity: Array<{
    id: number;
    eventType: string;
    createdAt: string | Date;
    details: Record<string, unknown> | null;
    rawDetails: string | null;
  }>;
};

export function formatAutonomyActivityTime(value: string | Date | null | undefined) {
  if (!value) {
    return "Not yet recorded";
  }

  return new Date(value).toLocaleString();
}

export function getAutonomyReviewSummary(activity: AutonomyActivitySummary | null | undefined) {
  if (!activity?.lastRun) {
    return {
      title: "No scheduled review recorded yet",
      body: "Once Laurenzo completes an away-from-chat review, the latest outcome will appear here with its execution status and signal counts.",
      tone: "text-slate-300",
    };
  }

  const lastRun = activity.lastRun;
  const counts = `${lastRun.signalsGenerated} signals · ${lastRun.executionCandidates} execution-ready candidates`;

  switch (lastRun.status) {
    case "executed":
      return {
        title: "Last away review placed a live order",
        body: `${counts}. ${lastRun.executedMarketId ? `Executed ${lastRun.executedMarketId}. ` : ""}${lastRun.reason ?? "A live order was submitted."}`,
        tone: "text-emerald-300",
      };
    case "blocked":
      return {
        title: "Last away review was blocked by guardrails",
        body: `${counts}. ${lastRun.reason ?? "The autonomy policy or risk rules blocked execution."}`,
        tone: "text-amber-300",
      };
    case "generated_only":
      return {
        title: "Last away review generated analysis without trading",
        body: `${counts}. ${lastRun.reason ?? "Signals were reviewed, but no trade was submitted."}`,
        tone: "text-cyan-300",
      };
    case "skipped":
      return {
        title: "Last away review was skipped",
        body: lastRun.reason ?? "The current autonomy policy skipped the scheduled review.",
        tone: "text-slate-300",
      };
    default:
      return {
        title: "Last away review hit an operational error",
        body: lastRun.reason ?? "The scheduled review returned an error before execution could proceed.",
        tone: "text-rose-300",
      };
  }
}

export function getAutonomyEventLabel(eventType: string) {
  return eventType
    .replace(/^scheduled_autonomy_run_/, "away review ")
    .replace(/^scheduled_autonomy_/, "away ")
    .replace(/^live_trading_/, "live trading ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatConfidence(value: number) {
  return `${Math.round(value * 100)}%`;
}
