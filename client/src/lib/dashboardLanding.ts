export type DashboardLandingMetrics = {
  connected: boolean;
  currentBalance: number;
  liveFeedCount: number;
  maxDrawdown: number;
};

export function getLandingBadge(metrics: DashboardLandingMetrics) {
  if (metrics.connected && metrics.currentBalance <= 0) {
    return {
      label: "Account connected, funding review needed",
      tone: "funding" as const,
    };
  }

  if (metrics.connected) {
    return {
      label: "Account telemetry active",
      tone: "connected" as const,
    };
  }

  return {
    label: "Connect account to unlock live telemetry",
    tone: "attention" as const,
  };
}

export function getFirstTestReadiness(metrics: DashboardLandingMetrics) {
  return {
    connectionLabel: metrics.connected ? "Ready" : "Pending",
    drawdownUsageLabel: `${(metrics.maxDrawdown * 100).toFixed(1)}%`,
    microstructureLabel: String(metrics.liveFeedCount),
    needsFundingReview: metrics.connected && metrics.currentBalance <= 0,
  };
}

export function getVisibleCapital(metrics: Pick<DashboardLandingMetrics, "connected" | "currentBalance">) {
  return metrics.connected ? metrics.currentBalance : 0;
}

export function getFastActionItems() {
  return [
    {
      href: "/connect",
      title: "Connect fresh Kalshi keys",
      body: "Validate and encrypt your new laptop-generated key pair directly inside the app.",
    },
    {
      href: "/risk-controls",
      title: "Review guardrails",
      body: "Check risk budgets, posture warnings, and kill-switch readiness before testing live execution.",
    },
    {
      href: "/analytics",
      title: "Scan liquidity",
      body: "Inspect spread proxies, depth imbalance, and pressure watchlists before acting on any signal.",
    },
    {
      href: "/backtest",
      title: "Compare scenarios",
      body: "Use history-backed analysis or scenario mode to vet setups before the first real trade.",
    },
  ] as const;
}
