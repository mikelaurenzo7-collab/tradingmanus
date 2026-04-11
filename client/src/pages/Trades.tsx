import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";

export default function Trades() {
  const tradesQuery = trpc.trades.history.useQuery({ limitDays: 30 });

  if (tradesQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin w-8 h-8 text-primary" />
      </div>
    );
  }

  const trades = tradesQuery.data || [];

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
                <th>Symbol</th>
                <th>Market</th>
                <th>Action</th>
                <th>Side</th>
                <th>Quantity</th>
                <th>Fill Price</th>
                <th>PnL</th>
                <th>Strategy</th>
                <th>Executed</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr key={trade.id}>
                  <td className="font-mono font-bold">{trade.symbol}</td>
                  <td className="capitalize text-xs">{trade.market}</td>
                  <td>
                    <span className="capitalize text-xs">{trade.action}</span>
                  </td>
                  <td className="capitalize">{trade.side}</td>
                  <td className="font-mono">{trade.quantity.toFixed(4)}</td>
                  <td className="font-mono">${trade.fillPrice.toFixed(2)}</td>
                  <td className={`font-mono font-bold ${trade.pnl > 0 ? "profit" : "loss"}`}>
                    ${trade.pnl.toFixed(2)}
                  </td>
                  <td className="text-xs text-muted-foreground">{trade.strategyTag}</td>
                  <td className="text-xs text-muted-foreground">
                    {new Date(trade.executedAt).toLocaleString()}
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
