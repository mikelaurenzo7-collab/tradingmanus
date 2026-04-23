import { trpc } from "@/lib/trpc";
import { Loader2, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ReasoningLog() {
  const reasoningQuery = trpc.kalshi.getRecentSignals.useQuery();
  const generateAnalysisMutation = { mutateAsync: async () => {} };

  if (reasoningQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin w-8 h-8 text-primary" />
      </div>
    );
  }

  const logs = reasoningQuery.data || [];

  const handleGenerateAnalysis = async (market: 'stocks' | 'crypto' | 'prediction') => {
    try {
      // Market analysis generation not yet implemented for Kalshi
      reasoningQuery.refetch();
    } catch (error) {
      console.error("Failed to generate analysis:", error);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-wider">
            <span className="bracket">[</span>
            AI REASONING LOG
            <span className="bracket">]</span>
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Market analysis, signals, and cross-asset correlation insights
          </p>
        </div>
        <div className="space-x-2">
          <Button
            onClick={() => handleGenerateAnalysis('stocks')}
            disabled={false}
            className="laurenzo-button"
          >
            <Lightbulb className="w-4 h-4 mr-2" />
            Analyze Stocks
          </Button>
          <Button
            onClick={() => handleGenerateAnalysis('crypto')}
            disabled={false}
            className="laurenzo-button"
          >
            <Lightbulb className="w-4 h-4 mr-2" />
            Analyze Crypto
          </Button>
          <Button
            onClick={() => handleGenerateAnalysis('prediction')}
            disabled={false}
            className="laurenzo-button"
          >
            <Lightbulb className="w-4 h-4 mr-2" />
            Analyze Prediction
          </Button>
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="laurenzo-card text-center py-12">
          <p className="text-muted-foreground">No reasoning logs yet. Generate market analysis to begin.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {logs.map((log: any) => (
            <div key={log.id} className="laurenzo-card">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-bold tracking-wider">{log.headline}</h3>
                  <div className="text-xs text-muted-foreground mt-1">
                    <span className="bracket">[</span>
                    {log.market.toUpperCase()}
                    <span className="bracket">]</span>
                    {" "}
                    Signal: <span className="text-primary font-mono">{log.signal.toUpperCase()}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono">
                    Correlation: <span className="text-primary">{log.correlationScore.toFixed(2)}</span>
                  </div>
                  <div className="text-sm font-mono">
                    Confidence: <span className="text-primary">{log.confidenceScore.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground font-bold tracking-wider mb-1">
                    REGIME SUMMARY
                  </div>
                  <p className="text-foreground">{log.regimeSummary}</p>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground font-bold tracking-wider mb-1">
                    LLM ANALYSIS
                  </div>
                  <p className="text-foreground">{log.explanation}</p>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground font-bold tracking-wider mb-1">
                    OPPORTUNITY
                  </div>
                  <p className="text-primary">{log.opportunityTitle}</p>
                </div>
              </div>

              <div className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
                {new Date(log.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
