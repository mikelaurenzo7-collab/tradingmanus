import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, TrendingUp, Zap, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function Signals() {
  const signals = trpc.kalshi.getRecentSignals.useQuery();
  const topSignals = trpc.kalshi.getTopSignals.useQuery({ topN: 5, minExecutionScore: 0.6 });
  const generateSignalsMutation = trpc.kalshi.generateSignals.useMutation();
  const marketsQuery = trpc.kalshi.getMarkets.useQuery({ status: "open" });
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateSignals = async () => {
    setIsGenerating(true);
    try {
      if (marketsQuery.data && marketsQuery.data.length > 0) {
        // Generate signals for top 10 markets
        const marketIds = marketsQuery.data.slice(0, 10).map((m: any) => m.id);
        await generateSignalsMutation.mutateAsync({
          marketIds,
          minConfidence: 0.5,
        });
        // Refetch signals
        await signals.refetch();
        await topSignals.refetch();
      }
    } catch (error) {
      console.error("Failed to generate signals:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const getSignalIcon = (signalType: string) => {
    switch (signalType) {
      case "value_play":
        return <TrendingUp className="w-4 h-4 text-green-400" />;
      case "momentum":
        return <Zap className="w-4 h-4 text-yellow-400" />;
      case "contrarian":
        return <AlertTriangle className="w-4 h-4 text-red-400" />;
      default:
        return <TrendingUp className="w-4 h-4 text-cyan-400" />;
    }
  };

  const getSignalDescription = (signalType: string) => {
    switch (signalType) {
      case "value_play":
        return "Market mispricing - fundamental vs market probability divergence";
      case "momentum":
        return "Strong directional movement with volume confirmation";
      case "contrarian":
        return "Extreme condition suggesting reversal opportunity";
      default:
        return "Trading signal generated";
    }
  };

  const getConfidenceBadgeColor = (confidence: number) => {
    if (confidence >= 0.8) return "bg-green-900 text-green-200";
    if (confidence >= 0.6) return "bg-yellow-900 text-yellow-200";
    return "bg-orange-900 text-orange-200";
  };

  const renderSignalCard = (signal: any) => (
    <Card key={signal.id} className="border-cyan-900 bg-black/50 hover:border-cyan-700 transition-colors">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {getSignalIcon(signal.signalType)}
            <div>
              <CardTitle className="text-cyan-400 capitalize">{signal.signalType.replace(/_/g, " ")}</CardTitle>
              <CardDescription className="text-gray-500 mt-1">{getSignalDescription(signal.signalType)}</CardDescription>
            </div>
          </div>
          <Badge className={getConfidenceBadgeColor(signal.confidence)}>
            {(signal.confidence * 100).toFixed(0)}% CONF
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-gray-500 font-mono">[ MARKET ]</div>
              <div className="text-gray-300 mt-1 font-mono text-xs">{signal.marketId}</div>
            </div>
            <div>
              <div className="text-gray-500 font-mono">[ SIDE ]</div>
              <div className={`mt-1 font-mono text-xs font-bold ${signal.side === "yes" ? "text-green-400" : "text-red-400"}`}>
                {signal.side.toUpperCase()}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-gray-500 font-mono">[ IMPLIED PROB ]</div>
              <div className="text-cyan-300 mt-1 font-mono">{(signal.impliedProbability * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-gray-500 font-mono">[ MARKET PRICE ]</div>
              <div className="text-cyan-300 mt-1 font-mono">${signal.marketPrice.toFixed(2)}</div>
            </div>
          </div>

          <div>
            <div className="text-gray-500 font-mono">[ EXPECTED VALUE ]</div>
            <div className={`mt-1 font-mono font-bold ${signal.expectedValue > 0 ? "text-green-400" : "text-red-400"}`}>
              ${signal.expectedValue.toFixed(4)}
            </div>
          </div>

          <div>
            <div className="text-gray-500 font-mono">[ REASONING ]</div>
            <div className="text-gray-300 text-xs mt-1 font-mono">{signal.reasoning}</div>
          </div>

          <div className="text-gray-600 text-xs pt-2 border-t border-gray-800">
            Generated: {new Date(signal.createdAt).toLocaleString()}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (signals.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-cyan-400 font-mono">[ TRADING SIGNALS ]</h1>
          <p className="text-gray-400 mt-2">Loading signals...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-cyan-400 font-mono">[ TRADING SIGNALS ]</h1>
          <p className="text-gray-400 mt-2">Real-time market signals with confidence scoring and execution readiness</p>
        </div>
        <Button
          onClick={handleGenerateSignals}
          disabled={isGenerating || generateSignalsMutation.isPending}
          className="bg-cyan-600 hover:bg-cyan-700 text-black font-mono"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isGenerating ? "animate-spin" : ""}`} />
          {isGenerating ? "Generating..." : "Generate Signals"}
        </Button>
      </div>

      {/* Top Execution-Ready Signals */}
      {topSignals.data && topSignals.data.length > 0 && (
        <div className="space-y-3">
          <div>
            <h2 className="text-xl font-bold text-green-400 font-mono">[ TOP EXECUTION SIGNALS ]</h2>
            <p className="text-gray-500 text-sm mt-1">Highest execution readiness scores</p>
          </div>
          <div className="grid gap-4">
            {topSignals.data.map((signal: any) => renderSignalCard(signal))}
          </div>
        </div>
      )}

      {/* All Recent Signals */}
      <div className="space-y-3">
        <div>
          <h2 className="text-xl font-bold text-cyan-400 font-mono">[ ALL RECENT SIGNALS ]</h2>
          <p className="text-gray-500 text-sm mt-1">Last 20 signals generated</p>
        </div>
        <div className="grid gap-4">
          {signals.data && signals.data.length > 0 ? (
            signals.data.map((signal: any) => renderSignalCard(signal))
          ) : (
            <Card className="border-gray-800 bg-black/50">
              <CardContent className="pt-6">
                <div className="text-center text-gray-400">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No signals generated yet</p>
                  <p className="text-sm mt-1">Click "Generate Signals" to analyze open markets</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
