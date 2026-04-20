import { trpc } from "@/lib/trpc";
import { Loader2, BarChart3, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function Analytics() {
  const [activeMarket, setActiveMarket] = useState<'stocks' | 'crypto' | 'prediction'>('stocks');
  
  const stocksQuery = trpc.kalshi.getCapital.useQuery();
  const stocksHistoryQuery = { data: [], isLoading: false, error: null };

  if (stocksQuery.isLoading || stocksHistoryQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin w-8 h-8 text-primary" />
      </div>
    );
  }

  const overview = stocksQuery.data;
  const history = stocksHistoryQuery.data || [];

  const getMarketData = () => {
    // All markets use the same capital data for Kalshi
    return overview;
  };

  const marketData = getMarketData();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-wider">
          <span className="bracket">[</span>
          MARKET ANALYTICS
          <span className="bracket">]</span>
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Performance metrics and risk analysis by market
        </p>
      </div>

      {/* Market Tabs */}
      <div className="flex gap-2">
        {(['stocks', 'crypto', 'prediction'] as const).map((market) => (
          <Button
            key={market}
            onClick={() => setActiveMarket(market)}
            className={activeMarket === market ? 'nexus-button' : 'nexus-card'}
            variant={activeMarket === market ? 'default' : 'outline'}
          >
            {market.toUpperCase()}
          </Button>
        ))}
      </div>

      {/* Analytics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Win Rate */}
        <div className="nexus-card">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground tracking-wider mb-2">
                WIN RATE
              </div>
              <div className="text-3xl font-bold text-primary">
                {(marketData?.winRate ?? 0 * 100).toFixed(1)}%
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Winning trades ratio
              </p>
            </div>
            <BarChart3 className="w-8 h-8 text-primary opacity-50" />
          </div>
        </div>

        {/* Sharpe Ratio */}
        <div className="nexus-card">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground tracking-wider mb-2">
                SHARPE RATIO
              </div>
              <div className="text-3xl font-bold text-primary">
                {marketData?.sharpeRatio?.toFixed(2) || "0.00"}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Risk-adjusted returns
              </p>
            </div>
            <TrendingUp className="w-8 h-8 text-primary opacity-50" />
          </div>
        </div>

        {/* Max Drawdown */}
        <div className="nexus-card">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground tracking-wider mb-2">
                MAX DRAWDOWN
              </div>
              <div className="text-3xl font-bold loss">
                {(marketData?.maxDrawdown ?? 0 * 100).toFixed(2)}%
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Peak-to-trough decline
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Equity Curve */}
      <div className="nexus-card">
        <div className="text-xs text-muted-foreground tracking-wider mb-4">
          <span className="bracket">[</span> EQUITY CURVE <span className="bracket">]</span>
        </div>
        
        {history.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No historical data available
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm">
              <div className="text-muted-foreground mb-2">Historical Equity Snapshots</div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {history.map((snapshot: any, idx: any) => (
                  <div key={idx} className="flex items-center justify-between text-xs border-b border-border pb-2">
                    <span className="text-muted-foreground">
                      {new Date(snapshot.recordedAt).toLocaleString()}
                    </span>
                    <span className="font-mono">
                      ${snapshot.totalEquity.toFixed(2)}
                    </span>
                    <span className={`font-mono ${snapshot.dailyPnl > 0 ? 'profit' : 'loss'}`}>
                      {snapshot.dailyPnl > 0 ? '+' : ''}{snapshot.dailyPnl.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Performance Summary */}
      <div className="nexus-card">
        <div className="text-xs text-muted-foreground tracking-wider mb-4">
          <span className="bracket">[</span> PERFORMANCE SUMMARY <span className="bracket">]</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Current Balance</div>
            <div className="font-mono font-bold">
              ${marketData?.currentBalance?.toFixed(2) || "0.00"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Total PnL</div>
            <div className={`font-mono font-bold ${(marketData?.totalPnl ?? 0) > 0 ? 'profit' : 'loss'}`}>
              ${marketData?.totalPnl?.toFixed(2) || "0.00"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Total PnL</div>
            <div className={`font-mono font-bold ${(marketData?.totalPnl ?? 0) > 0 ? 'profit' : 'loss'}`}>
              ${marketData?.totalPnl?.toFixed(2) || "0.00"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Win Rate</div>
            <div className={`font-mono font-bold`}>
              {(marketData?.winRate ?? 0 * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
