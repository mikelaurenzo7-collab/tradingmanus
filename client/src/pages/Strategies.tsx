import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";

export default function Strategies() {
  const strategies = trpc.strategies.list.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-cyan-400 font-mono">[ STRATEGY REGISTRY ]</h1>
        <p className="text-gray-400 mt-2">Validated trading strategies with walk-forward performance</p>
      </div>

      <div className="grid gap-4">
        {strategies.data?.map((strategy) => (
          <Card key={strategy.id} className="border-cyan-900 bg-black/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-cyan-400">{strategy.name}</CardTitle>
                  <CardDescription className="text-gray-500 mt-1">
                    {strategy.marketUniverse} • {strategy.holdingPeriod}
                  </CardDescription>
                </div>
                <Badge className="bg-green-900 text-green-200">ACTIVE</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-gray-500 font-mono">[ HYPOTHESIS ]</div>
                  <div className="text-gray-300 mt-1">{strategy.hypothesis}</div>
                </div>
                <div>
                  <div className="text-gray-500 font-mono">[ ENTRY LOGIC ]</div>
                  <div className="text-gray-300 text-xs mt-1 font-mono">{strategy.entryLogic}</div>
                </div>
                <div>
                  <div className="text-gray-500 font-mono">[ EXIT LOGIC ]</div>
                  <div className="text-gray-300 text-xs mt-1 font-mono">{strategy.exitLogic}</div>
                </div>
                <div>
                  <div className="text-gray-500 font-mono">[ SIZING ]</div>
                  <div className="text-gray-300 text-xs mt-1">{strategy.sizingRules}</div>
                </div>
                {strategy.expectedCosts && (
                  <div>
                    <div className="text-gray-500 font-mono">[ EXPECTED COSTS ]</div>
                    <div className="text-yellow-400 font-mono">{strategy.expectedCosts.toFixed(2)}%</div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {!strategies.data || strategies.data.length === 0 && (
          <Card className="border-gray-800 bg-black/50">
            <CardContent className="pt-6">
              <div className="text-center text-gray-400">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No strategies registered</p>
                <p className="text-sm mt-1">Add trading strategies to the registry</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
