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
      return "The agent may identify trades continuously, but every live order still needs your explicit approval before submission.";
    case "semi_autonomous":
      return "The agent may place smaller eligible live trades automatically within your thresholds, while larger trades still pause for approval.";
    case "fully_autonomous":
      return "The agent may place live orders automatically within your stored guardrails whenever your account settings allow direct autonomous trading.";
  }
}

export function getExecutionCadenceLabel(cadence: ExecutionCadence) {
  switch (cadence) {
    case "manual_only":
      return "Manual only";
    case "session_assisted":
      return "During guided sessions";
    case "hourly_watch":
      return "Hourly autonomous trading";
    case "continuous_watch":
      return "Continuous autonomous trading";
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
      ? "Your live-trading policy is armed for eligible autonomous execution. Laurenzo can place trades automatically under your saved account guardrails while you are away."
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
    decision: null | {
      marketId: string | null;
      side: "yes" | "no" | null;
      confidence: number | null;
      executionScore: number | null;
      expectedValue: number | null;
      limitPrice: number | null;
      quantity: number | null;
      availableCapital: number | null;
      maxBudget: number | null;
      orderExposure: number | null;
      maxLossOnTrade: number | null;
      reasoning: string | null;
      blockedBy: string | null;
    };
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
    expectedValue: number | null;
    reasoning: string | null;
    availableCapital: number | null;
    maxBudget: number | null;
    orderExposure: number | null;
    maxLossOnTrade: number | null;
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
      title: "No autonomous trading activity recorded yet",
      body: "Once Laurenzo completes a direct autonomous trading cycle for your account, the latest outcome will appear here with its execution status and signal counts.",
      tone: "text-slate-300",
    };
  }

  const lastRun = activity.lastRun;
  const counts = `${lastRun.signalsGenerated} signals · ${lastRun.executionCandidates} execution-ready candidates`;

  switch (lastRun.status) {
    case "executed":
      return {
        title: "Last autonomous trading cycle placed a live order",
        body: `${counts}. ${lastRun.executedMarketId ? `Executed ${lastRun.executedMarketId}. ` : ""}${lastRun.reason ?? "A live order was submitted."}`,
        tone: "text-emerald-300",
      };
    case "blocked":
      return {
        title: "Last autonomous trading cycle was blocked by guardrails",
        body: `${counts}. ${lastRun.reason ?? "The autonomy policy or risk rules blocked execution."}`,
        tone: "text-amber-300",
      };
    case "generated_only":
      return {
        title: "Last autonomous trading cycle generated analysis without trading",
        body: `${counts}. ${lastRun.reason ?? "Signals were reviewed, but no trade was submitted."}`,
        tone: "text-cyan-300",
      };
    case "skipped":
      return {
        title: "Last autonomous trading cycle was skipped",
        body: lastRun.reason ?? "The current autonomy policy skipped direct autonomous trading.",
        tone: "text-slate-300",
      };
    default:
      return {
        title: "Last autonomous trading cycle hit an operational error",
        body: lastRun.reason ?? "The direct autonomous trading cycle returned an error before execution could proceed.",
        tone: "text-rose-300",
      };
  }
}

function getDecisionGuardrailLabel(blockedBy: string | null | undefined) {
  switch (blockedBy) {
    case "approval_required_mode":
      return "Approval-required mode held the order for manual review.";
    case "daily_order_cap":
      return "The saved daily order cap blocked execution.";
    case "open_position_limit":
      return "The open-position limit blocked another autonomous trade.";
    case "autonomy_or_exposure_guardrail":
      return "The candidate did not satisfy the saved autonomy or exposure guardrails.";
    case "per_trade_risk_limit":
      return "The candidate would have exceeded the per-trade risk limit.";
    case "daily_loss_limit":
      return "The daily loss limit had already been reached.";
    case "available_capital":
      return "Confirmed available capital was below the required exposure.";
    case "exchange_rejected_or_failed":
      return "The order reached submission but the exchange or execution path rejected it.";
    default:
      return null;
  }
}

export function getAutonomyDecisionSummary(activity: AutonomyActivitySummary | null | undefined) {
  const lastRun = activity?.lastRun;
  const decision = lastRun?.decision;

  if (!lastRun || !decision?.marketId) {
    return {
      title: "No candidate decision details recorded yet",
      body: "Once a scheduled review evaluates a concrete execution candidate, Laurenzo will show the selected market, sizing plan, and the exact reason it traded or stood down.",
      tone: "text-slate-300",
    };
  }

  const sideLabel = decision.side ? decision.side.toUpperCase() : "UNKNOWN";
  const confidenceLabel = decision.confidence !== null ? `${Math.round(decision.confidence * 100)}% confidence` : null;
  const scoreLabel = decision.executionScore !== null ? `${Math.round(decision.executionScore * 100)}% execution score` : null;
  const edgeLabel = decision.expectedValue !== null ? `${(decision.expectedValue * 100).toFixed(1)}¢ EV` : null;
  const detailLine = [confidenceLabel, scoreLabel, edgeLabel].filter(Boolean).join(" · ");
  const guardrailLine = getDecisionGuardrailLabel(decision.blockedBy) ?? lastRun.reason;

  switch (lastRun.status) {
    case "executed":
      return {
        title: `Last away review executed ${decision.marketId} ${sideLabel}`,
        body: [detailLine, guardrailLine].filter(Boolean).join(". "),
        tone: "text-emerald-300",
      };
    case "blocked":
      return {
        title: `Last away review blocked ${decision.marketId} ${sideLabel}`,
        body: [detailLine, guardrailLine].filter(Boolean).join(". "),
        tone: "text-amber-300",
      };
    case "generated_only":
      return {
        title: `Last away review evaluated ${decision.marketId} ${sideLabel} without trading`,
        body: [detailLine, guardrailLine].filter(Boolean).join(". "),
        tone: "text-cyan-300",
      };
    default:
      return {
        title: `Last away review considered ${decision.marketId} ${sideLabel}`,
        body: [detailLine, guardrailLine].filter(Boolean).join(". "),
        tone: "text-slate-300",
      };
  }
}

export function getAutonomyReadinessSummary(input: {
  preferences: TradingPreferences;
  connected: boolean;
  equity: number;
  lastRunAt?: string | Date | null;
}) {
  const { preferences, connected, equity, lastRunAt } = input;

  if (!connected) {
    return {
      title: "Away-from-chat trading is not ready",
      body: "Kalshi is not connected yet, so Laurenzo cannot review or place live trades while you are away.",
      tone: "text-rose-300",
    };
  }

  if (equity <= 0) {
    return {
      title: "Away-from-chat trading is funded incorrectly",
      body: "The connected account has no confirmed equity available for live execution.",
      tone: "text-amber-300",
    };
  }

  if (preferences.autonomyMode === "manual") {
    return {
      title: "Away-from-chat trading is disabled by mode",
      body: "Manual mode keeps Laurenzo in research-only operation even if the account is connected.",
      tone: "text-slate-300",
    };
  }

  if (!preferences.liveTradingEnabled) {
    return {
      title: "Away-from-chat trading is disarmed",
      body: "Your autonomy policy is saved, but live trading is currently disarmed.",
      tone: "text-amber-300",
    };
  }

  const supportsAwayScanning =
    preferences.executionCadence === "hourly_watch" ||
    preferences.executionCadence === "continuous_watch";

  if (!supportsAwayScanning) {
    return {
      title: "Away-from-chat trading is not enabled by cadence",
      body: "The current cadence limits Laurenzo to supervised sessions rather than scheduled away-from-chat reviews.",
      tone: "text-amber-300",
    };
  }

  return {
    title: "Away-from-chat trading is eligible",
    body: lastRunAt
      ? "Laurenzo is armed for scheduled reviews and has recorded recent away-from-chat activity under the current policy."
      : "Laurenzo is armed for scheduled reviews, but no away-from-chat review has been recorded yet under the current policy.",
    tone: "text-emerald-300",
  };
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
