import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";

export default function RiskControls() {
  const riskLimits = trpc.riskControls.limits.useQuery();

  const getLimitCategory = (limitType: string) => {
    if (limitType.includes("daily")) return "Daily Limits";
    if (limitType.includes("weekly")) return "Weekly Limits";
    if (limitType.includes("per_position")) return "Position Limits";
    if (limitType.includes("correlation")) return "Correlation Limits";
    return "Other Limits";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-cyan-400 font-mono">[ RISK CONTROLS ]</h1>
        <p className="text-gray-400 mt-2">Hard capital, trade, model, and portfolio constraints</p>
      </div>

      {/* Capital Controls */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-magenta-400 font-mono">[ CAPITAL CONTROLS ]</h2>
        <div className="grid gap-4">
          {riskLimits.data
            ?.filter((l) => l.limitType.includes("daily") || l.limitType.includes("weekly"))
            ?.map((limit) => (
              <Card key={limit.id} className="border-cyan-900 bg-black/50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-cyan-400 capitalize">{limit.limitType.replace(/_/g, " ")}</CardTitle>
                    <Badge className="bg-yellow-900 text-yellow-200">{limit.period}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-mono text-red-400">${limit.value.toFixed(2)}</div>
                </CardContent>
              </Card>
            ))}
        </div>
      </div>

      {/* Trade Controls */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-magenta-400 font-mono">[ TRADE CONTROLS ]</h2>
        <div className="grid gap-4">
          {riskLimits.data
            ?.filter((l) => l.limitType.includes("per_position") || l.limitType.includes("order"))
            ?.map((limit) => (
              <Card key={limit.id} className="border-magenta-900 bg-black/50">
                <CardHeader>
                  <CardTitle className="text-magenta-400 capitalize">{limit.limitType.replace(/_/g, " ")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-mono text-magenta-400">{limit.value.toFixed(2)}</div>
                </CardContent>
              </Card>
            ))}
        </div>
      </div>

      {/* Portfolio Controls */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-magenta-400 font-mono">[ PORTFOLIO CONTROLS ]</h2>
        <div className="grid gap-4">
          {riskLimits.data
            ?.filter((l) => l.limitType.includes("correlation") || l.limitType.includes("concentration"))
            ?.map((limit) => (
              <Card key={limit.id} className="border-magenta-900 bg-black/50">
                <CardHeader>
                  <CardTitle className="text-magenta-400 capitalize">{limit.limitType.replace(/_/g, " ")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-mono text-magenta-400">{(limit.value * 100).toFixed(1)}%</div>
                </CardContent>
              </Card>
            ))}
        </div>
      </div>

      {!riskLimits.data || riskLimits.data.length === 0 && (
        <Card className="border-gray-800 bg-black/50">
          <CardContent className="pt-6">
            <div className="text-center text-gray-400">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No risk limits configured</p>
              <p className="text-sm mt-1">Set hard risk controls before enabling live trading</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
