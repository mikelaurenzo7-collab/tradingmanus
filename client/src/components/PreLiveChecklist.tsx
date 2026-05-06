import { CheckCircle2, Circle, AlertCircle, CheckCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  score: number;
  evidence?: string;
}

interface PreLiveChecklistProps {
  checklist: {
    checklist: ChecklistItem[];
    overallScore: number;
    recommendation: "NOT_READY" | "CAUTIOUS" | "READY";
  };
}

function getRecommendationBadge(
  recommendation: "NOT_READY" | "CAUTIOUS" | "READY"
): { icon: React.ReactNode; label: string; color: string; bg: string } {
  if (recommendation === "READY") {
    return {
      icon: <CheckCircle className="w-6 h-6 text-emerald-400" />,
      label: "READY",
      color: "text-emerald-400",
      bg: "bg-emerald-500/20",
    };
  }
  if (recommendation === "CAUTIOUS") {
    return {
      icon: <AlertCircle className="w-6 h-6 text-yellow-400" />,
      label: "CAUTIOUS",
      color: "text-yellow-400",
      bg: "bg-yellow-500/20",
    };
  }
  return {
    icon: <AlertCircle className="w-6 h-6 text-rose-400" />,
    label: "NOT_READY",
    color: "text-rose-400",
    bg: "bg-rose-500/20",
  };
}

function getNextStepsAdvice(
  recommendation: "NOT_READY" | "CAUTIOUS" | "READY",
  incompleteItems: ChecklistItem[]
): string[] {
  if (recommendation === "READY") {
    return [
      "✅ All criteria met — ready to begin Phase 1 micro-funding",
      "Start with $100–$500 capital allocation",
      "Monitor for 1–2 weeks before scaling",
      "Review desk memory daily to refine models",
    ];
  }

  if (recommendation === "CAUTIOUS") {
    return [
      "🟡 Can attempt micro-funding with caution",
      "Start with $50–$100 allocation only",
      "Watch closely for first 5–10 trades",
      `Complete missing checks: ${incompleteItems.map((i) => i.label).join(", ")}`,
      "Stop immediately if live win rate drops below 50%",
    ];
  }

  return [
    "🔴 Not yet ready for live trading",
    "Complete more autonomy cycles (target: 30+)",
    "Run paper trades for at least 7 days",
    `Focus on: ${incompleteItems.slice(0, 3).map((i) => i.label).join(", ")}`,
    "Return to this checklist when metrics improve",
  ];
}

export default function PreLiveChecklist({ checklist }: PreLiveChecklistProps) {
  const { checklist: items, overallScore, recommendation } = checklist;
  const badge = getRecommendationBadge(recommendation);
  const incompleteItems = items.filter((i) => !i.completed);
  const nextSteps = getNextStepsAdvice(recommendation, incompleteItems);
  const progressPercent = (overallScore / 100) * 100;

  return (
    <div className="data-card space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">✅ Pre-Live Readiness Checklist</h2>
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full border font-semibold text-sm ${badge.bg} ${badge.color}`}>
          {badge.icon}
          <span>{badge.label}</span>
        </div>
      </div>

      {/* Overall Score Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Overall Score</span>
          <span className={`font-mono font-bold text-lg ${overallScore >= 85 ? "text-emerald-400" : overallScore >= 60 ? "text-yellow-400" : "text-rose-400"}`}>
            {overallScore}/100
          </span>
        </div>
        <Progress value={progressPercent} className="h-2" />
      </div>

      {/* Checklist Items */}
      <div className="space-y-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="border border-border rounded-lg p-4 hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="mt-1">
                {item.completed ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : (
                  <Circle className="w-5 h-5 text-muted-foreground" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h3 className={`font-semibold text-sm ${item.completed ? "text-foreground" : "text-muted-foreground"}`}>
                    {item.label}
                  </h3>
                  <span className="text-xs font-mono font-bold text-muted-foreground">
                    {item.score > 0 ? `${item.score}/100` : "0/100"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-2">{item.description}</p>
                {item.evidence && (
                  <p className="text-xs text-blue-300">📊 {item.evidence}</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recommendation & Next Steps */}
      <div className="space-y-4">
        <div
          className={`rounded-lg p-4 border ${
            recommendation === "READY"
              ? "bg-emerald-500/10 border-emerald-500/30"
              : recommendation === "CAUTIOUS"
                ? "bg-yellow-500/10 border-yellow-500/30"
                : "bg-rose-500/10 border-rose-500/30"
          }`}
        >
          <h3 className="font-semibold mb-2">📋 Next Steps</h3>
          <ul className="space-y-1 text-sm">
            {nextSteps.map((step, idx) => (
              <li key={idx} className="text-muted-foreground">
                • {step}
              </li>
            ))}
          </ul>
        </div>

        {/* Tips for Incomplete Items */}
        {incompleteItems.length > 0 && (
          <div className="bg-blue-500/10 border border-blue-500/30 text-blue-100 p-3 rounded-lg text-sm space-y-2">
            <strong>💡 Tips to improve your score:</strong>
            <ul className="space-y-1 ml-2">
              {incompleteItems.map((item) => (
                <li key={item.id}>
                  • <strong>{item.label}:</strong> {getItemTip(item.id)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="bg-blue-500/10 border border-blue-500/30 text-blue-100 p-3 rounded text-sm">
        <strong>ℹ️ Readiness Criteria:</strong> This checklist ensures you have sufficient data, stable performance, and proper risk controls before live trading. Aim for at least 85/100 before scaling beyond micro-funding.
      </div>
    </div>
  );
}

function getItemTip(itemId: string): string {
  const tips: Record<string, string> = {
    paper_duration:
      "Wait 1 week of autonomous trading to gather sufficient data.",
    autonomy_cycles:
      "Enable Trading Autonomy and let it run at least 30 scheduled cycles.",
    desk_memory:
      "Complete more trades in different categories to build desk memory.",
    paper_win_rate:
      "Refine your signal thresholds or risk parameters to improve accuracy.",
    no_errors:
      "Check the Audit Log for errors and fix any configuration issues.",
    risk_params:
      "Review Trading Autonomy → Risk Controls to validate all parameters.",
    api_verified:
      "Go to Connect Platforms and ensure Kalshi API is properly connected.",
  };
  return tips[itemId] || "Keep monitoring this metric.";
}
