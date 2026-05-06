import * as React from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { springConfigs } from "@/lib/animations";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MiniChart } from "@/components/charts/MiniChart";

interface SignalReviewCardProps {
  signalId: string;
  marketTitle: string;
  confidence: number; // 0-1
  expectedValue: number; // EV in dollars
  reasoning: string; // AI reasoning text
  historicalPerformance?: Array<{ date: string; pnl: number }>; // for mini chart
  side: "yes" | "no";
  suggestedPrice: number; // 0-1
  onExecute?: () => void;
  onDismiss?: () => void;
  loading?: boolean;
  className?: string;
}

function getCircleProgress(confidence: number) {
  const circumference = 2 * Math.PI * 50; // radius = 50
  const offset = circumference - confidence * circumference;
  return { circumference, offset };
}

function getConfidenceColor(confidence: number): {
  stroke: string;
  glow: string;
  text: string;
} {
  if (confidence > 0.7) {
    return {
      stroke: "stroke-green-500",
      glow: "drop-shadow-[0_0_8px_rgba(34,197,94,0.6)]",
      text: "text-green-500",
    };
  }
  if (confidence >= 0.5) {
    return {
      stroke: "stroke-yellow-500",
      glow: "drop-shadow-[0_0_8px_rgba(234,179,8,0.6)]",
      text: "text-yellow-500",
    };
  }
  return {
    stroke: "stroke-red-500",
    glow: "drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]",
    text: "text-red-500",
  };
}

export function SignalReviewCard({
  signalId,
  marketTitle,
  confidence,
  expectedValue,
  reasoning,
  historicalPerformance,
  side,
  suggestedPrice,
  onExecute,
  onDismiss,
  loading = false,
  className,
}: SignalReviewCardProps) {
  const [isReasoningExpanded, setIsReasoningExpanded] = React.useState(false);

  const { circumference, offset } = getCircleProgress(confidence);
  const colors = getConfidenceColor(confidence);
  const confidencePercent = Math.round(confidence * 100);

  const isPositiveEV = expectedValue >= 0;
  const formattedEV = isPositiveEV
    ? `+$${expectedValue.toFixed(2)}`
    : `-$${Math.abs(expectedValue).toFixed(2)}`;

  const displayedReasoning =
    isReasoningExpanded || reasoning.length <= 100
      ? reasoning
      : `${reasoning.slice(0, 100)}...`;

  const chartData = historicalPerformance?.map((item) => ({
    x: item.date,
    y: item.pnl,
  }));

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={springConfigs.smooth}
      className={cn("data-card p-6 relative", className)}
    >
      <div className="flex flex-col gap-6">
        {/* Top section: Confidence meter + EV badge */}
        <div className="flex items-start justify-between gap-4">
          {/* Circular confidence meter */}
          <div className="relative flex items-center justify-center">
            <svg width="120" height="120" className="transform -rotate-90">
              {/* Background circle */}
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                className="text-muted/20"
              />
              {/* Progress circle */}
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                strokeWidth="8"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                className={cn(colors.stroke, colors.glow)}
                style={{
                  transition: "stroke-dashoffset 0.5s ease",
                }}
              />
            </svg>
            {/* Center text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={cn("text-3xl font-bold", colors.text)}>
                {confidencePercent}
              </span>
              <span className="text-xs text-muted-foreground">confidence</span>
            </div>
          </div>

          {/* EV badge */}
          <div
            className={cn(
              "px-4 py-2 rounded-lg font-bold text-2xl shadow-lg",
              isPositiveEV
                ? "bg-green-500/20 text-green-500 border border-green-500/30"
                : "bg-red-500/20 text-red-500 border border-red-500/30"
            )}
          >
            {formattedEV}
          </div>
        </div>

        {/* Market title and side badge */}
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold line-clamp-2 flex-1">
            {marketTitle}
          </h3>
          <div
            className={cn(
              "px-3 py-1 rounded-md font-semibold text-sm whitespace-nowrap",
              side === "yes"
                ? "bg-green-500/20 text-green-500 border border-green-500/30"
                : "bg-red-500/20 text-red-500 border border-red-500/30"
            )}
          >
            {side.toUpperCase()}
          </div>
        </div>

        {/* Suggested price */}
        <div className="text-sm text-muted-foreground">
          Suggested: <span className="font-semibold text-foreground">
            {Math.round(suggestedPrice * 100)}¢
          </span>
        </div>

        {/* AI reasoning - collapsible */}
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {displayedReasoning}
          </p>
          {reasoning.length > 100 && (
            <button
              onClick={() => setIsReasoningExpanded(!isReasoningExpanded)}
              className="text-sm text-primary hover:underline focus:outline-none focus:underline"
            >
              {isReasoningExpanded ? "Show less" : "Read more"}
            </button>
          )}
        </div>

        {/* Bottom section: Mini chart + action buttons */}
        <div className="flex items-end justify-between gap-4 pt-4 border-t border-border/50">
          {/* Historical performance mini chart */}
          {chartData && chartData.length > 0 && (
            <div className="flex-shrink-0">
              <MiniChart
                data={chartData}
                type="area"
                height={60}
                className="w-[150px]"
                color={chartData[chartData.length - 1].y >= 0 ? "#22c55e" : "#ef4444"}
                formatY={(value) => `$${value.toFixed(2)}`}
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 ml-auto">
            {onDismiss && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onDismiss}
                disabled={loading}
                className="text-muted-foreground hover:text-foreground"
              >
                Dismiss
              </Button>
            )}
            {onExecute && (
              <button
                onClick={onExecute}
                disabled={loading}
                className={cn(
                  "laurenzo-button",
                  loading && "opacity-50 cursor-not-allowed"
                )}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Executing...
                  </>
                ) : (
                  "Execute"
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default SignalReviewCard;
