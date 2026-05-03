import { useTradingStatus } from "@/hooks/useTradingStatus";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, AlertTriangle, Pause, Eye } from "lucide-react";

type ModeInfo = { mode: string; paused: boolean; reason: string };

function PlatformBadge({ label, info }: { label: string; info: ModeInfo }) {
  if (info.paused) {
    return (
      <span className="flex items-center gap-1 text-red-400 font-semibold">
        <Pause className="h-3 w-3" />
        {label}: PAUSED — {info.reason}
      </span>
    );
  }
  if (info.mode === "shadow") {
    return (
      <span className="flex items-center gap-1 text-zinc-400">
        <Eye className="h-3 w-3" />
        {label}: SHADOW
      </span>
    );
  }
  if (info.mode === "paper") {
    return (
      <span className="flex items-center gap-1 text-blue-400">
        <Shield className="h-3 w-3" />
        {label}: PAPER
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-green-400 font-semibold">
      <AlertTriangle className="h-3 w-3" />
      {label}: LIVE
    </span>
  );
}

export function TradingModeBanner() {
  const { data } = useTradingStatus();
  if (!data) return null;

  const isLive = data.kalshi.mode === "live" || data.polymarket.mode === "live";
  const isPaused = data.kalshi.paused || data.polymarket.paused;

  if (!isLive && !isPaused) return null; // no banner needed in full shadow/paper

  return (
    <Alert className={`rounded-none border-x-0 border-t-0 py-2 ${isPaused ? "bg-red-950/40 border-red-800" : "bg-zinc-900 border-zinc-700"}`}>
      <AlertDescription className="flex gap-6 text-xs">
        <PlatformBadge label="Kalshi" info={data.kalshi} />
        <PlatformBadge label="Polymarket" info={data.polymarket} />
        {data.kalshi.liveStartedAt && (
          <span className="text-zinc-500">
            Ramp window: {data.rampWindowHours}h @ {Math.round(data.rampSizeMultiplier * 100)}% size
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}
