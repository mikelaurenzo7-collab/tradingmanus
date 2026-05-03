import { trpc } from "@/lib/trpc";
import { Loader2, Receipt, TrendingUp, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";

export default function Trades() {
  const tradeHistoryQuery = trpc.kalshi.getTradeHistory.useQuery({ limit: 50 });

  if (tradeHistoryQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin w-8 h-8 text-violet-400" />
      </div>
    );
  }

  const trades = tradeHistoryQuery.data || [];
  const winners = trades.filter((t: any) => Number(t.realizedPnl ?? 0) > 0).length;
  const losers = trades.filter((t: any) => Number(t.realizedPnl ?? 0) < 0).length;
  const totalRealized = trades.reduce((sum: number, t: any) => sum + Number(t.realizedPnl ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Receipt}
        title="Trade History"
        description={`${trades.length} trade${trades.length !== 1 ? "s" : ""} in the last 30 days`}
        badge={
          trades.length > 0 ? (
            <Badge variant="outline" className={`gap-1.5 px-2.5 py-1 ${totalRealized >= 0 ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300" : "border-rose-400/40 bg-rose-500/10 text-rose-300"}`}>
              {totalRealized >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              ${totalRealized.toFixed(2)}
            </Badge>
          ) : null
        }
      />

      {trades.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No trades recorded"
          description="Closed positions and their realized P&L will appear here once your bot starts trading."
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Total Trades" value={trades.length.toString()} accent="text-white" />
            <StatCard label="Winners" value={winners.toString()} accent="text-emerald-400" />
            <StatCard label="Losers" value={losers.toString()} accent="text-rose-400" />
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/[0.02] backdrop-blur-sm">
            <table className="laurenzo-table">
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
                      <span className={trade.side === "yes" ? "text-emerald-400" : "text-rose-400"}>
                        {trade.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="font-mono text-sm tabular-nums">{trade.quantity}</td>
                    <td className="font-mono text-sm tabular-nums">${trade.entryPrice.toFixed(4)}</td>
                    <td className="font-mono text-sm tabular-nums">${trade.currentPrice.toFixed(4)}</td>
                    <td className="capitalize text-xs">
                      <span
                        className={
                          trade.positionStatus === "closed"
                            ? "px-2 py-0.5 rounded-full bg-slate-700/40 text-slate-300"
                            : "px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300"
                        }
                      >
                        {trade.positionStatus}
                      </span>
                    </td>
                    <td className={`font-mono text-sm tabular-nums font-semibold ${trade.realizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      ${trade.realizedPnl.toFixed(2)}
                    </td>
                    <td className={`font-mono text-sm tabular-nums ${trade.unrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      ${trade.unrealizedPnl.toFixed(2)}
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {trade.closedAt ? new Date(trade.closedAt).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 backdrop-blur-sm">
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}
