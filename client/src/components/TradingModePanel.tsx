import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useTradingStatus, useSetTradingMode, useResumeTrading } from "@/hooks/useTradingStatus";
import { Loader2 } from "lucide-react";

type Platform = "kalshi" | "polymarket";
type Mode = "shadow" | "paper" | "live";

function modeBadgeClass(mode: Mode, paused: boolean) {
  if (paused) return "bg-red-600";
  if (mode === "live") return "bg-green-700";
  if (mode === "paper") return "bg-blue-700";
  return "bg-zinc-600";
}

function PlatformModeRow({ platform, label }: { platform: Platform; label: string }) {
  const { data, isLoading } = useTradingStatus();
  const setMode = useSetTradingMode();
  const resume = useResumeTrading();
  const info = data?.[platform];

  if (isLoading || !info) return <div className="h-10 animate-pulse bg-zinc-800 rounded" />;

  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-zinc-800 last:border-0">
      <div className="flex items-center gap-3">
        <span className="w-24 text-sm font-medium">{label}</span>
        <Badge className={modeBadgeClass(info.mode as Mode, info.paused)}>
          {info.paused ? "PAUSED" : info.mode.toUpperCase()}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        {info.paused ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => resume.mutate({ platform, reason: "manual resume" })}
            disabled={resume.isPending}
          >
            {resume.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Resume
          </Button>
        ) : (
          <Select
            value={info.mode}
            onValueChange={(value) => setMode.mutate({ platform, mode: value as Mode })}
            disabled={setMode.isPending}
          >
            <SelectTrigger className="w-32 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="shadow">Shadow</SelectItem>
              <SelectItem value="paper">Paper</SelectItem>
              <SelectItem value="live">Live</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

export function TradingModePanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Trading Modes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-0 p-4 pt-0">
        <PlatformModeRow platform="kalshi" label="Kalshi" />
        <PlatformModeRow platform="polymarket" label="Polymarket" />
        <p className="text-xs text-zinc-500 mt-3">
          Shadow: signals + reviewer run, no orders placed. Paper: simulated fills, no real capital. Live: real orders.
        </p>
      </CardContent>
    </Card>
  );
}
