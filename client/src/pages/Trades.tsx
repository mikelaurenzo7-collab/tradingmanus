import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";

export default function Trades() {
  const tradesQuery = trpc.kalshi.getAuditLog.useQuery();

  if (tradesQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin w-8 h-8 text-primary" />
      </div>
    );
  }

  const trades = (tradesQuery.data || []).filter((e: any) => e.event.includes('order'));

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
              {trades.map((trade: any) => (
                <tr key={trade.id}>
                  <td className="font-mono font-bold">{trade.event}</td>
                  <td className="capitalize text-xs">Kalshi</td>
                  <td>
                    <span className="capitalize text-xs">{trade.event}</span>
                  </td>
                  <td className="capitalize">-</td>
                  <td className="font-mono">-</td>
                  <td className="font-mono">-</td>
                  <td className="font-mono text-green-400">-</td>
                  <td className="text-xs text-muted-foreground">-</td>
                  <td className="text-xs text-muted-foreground">{new Date(trade.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
