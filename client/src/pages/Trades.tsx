import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";

export default function Trades() {
  const tradeHistoryQuery = trpc.kalshi.getTradeHistory.useQuery({ limit: 50 });

  if (tradeHistoryQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin w-8 h-8 text-primary" />
      </div>
    );
  }

  const trades = tradeHistoryQuery.data || [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-wider">
          <span className="bracket">[</span>
          TRADE HISTORY
          <span className="bracket">]</span>
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {trades.length} trade{trades.length !== 1 ? 's' : ''} in the last 30 days
        </p>
      </div>

      {trades.length === 0 ? (
        <div className="nexus-card text-center py-12">
          <p className="text-muted-foreground">No trades recorded</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="nexus-table">
            <thead>
              <tr>
                <th>Market ID</th>
                <th>Side</th>
                <th>Quantity</th>
                <th>Entry Price</th>
                <th>Current Price</th>
                <th>Status</th>
                <th>Realized PnL</th>
                <th>Unrealized PnL</th>
                <th>Closed At</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade: any) => (
                <tr key={trade.id}>
                  <td className="font-mono font-bold text-sm">{trade.marketId}</td>
                  <td className="capitalize text-xs font-semibold">
                    <span className={trade.side === 'yes' ? 'text-green-400' : 'text-red-400'}>
                      {trade.side.toUpperCase()}
                    </span>
                  </td>
                  <td className="font-mono text-sm">{trade.quantity}</td>
                  <td className="font-mono text-sm">${trade.entryPrice.toFixed(4)}</td>
                  <td className="font-mono text-sm">${trade.currentPrice.toFixed(4)}</td>
                  <td className="capitalize text-xs">
                    <span className={trade.positionStatus === 'closed' ? 'text-gray-400' : 'text-blue-400'}>
                      {trade.positionStatus}
                    </span>
                  </td>
                  <td className={`font-mono text-sm ${trade.realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ${trade.realizedPnl.toFixed(2)}
                  </td>
                  <td className={`font-mono text-sm ${trade.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ${trade.unrealizedPnl.toFixed(2)}
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {trade.closedAt ? new Date(trade.closedAt).toLocaleString() : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
