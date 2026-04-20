import { trpc } from "@/lib/trpc";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function Positions() {
  const positionsQuery = trpc.kalshi.getPositions.useQuery();
  const closePositionMutation = trpc.kalshi.closePosition.useMutation();
  const [closingId, setClosingId] = useState<number | null>(null);

  if (positionsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin w-8 h-8 text-primary" />
      </div>
    );
  }

  const positions = positionsQuery.data || [];

  const handleClosePosition = async (positionId: number, marketId: string, markPrice: number) => {
    setClosingId(positionId);
    try {
      await closePositionMutation.mutateAsync({
        positionId,
        marketId,
        currentPrice: markPrice,
      });
      positionsQuery.refetch();
    } catch (error) {
      console.error("Failed to close position:", error);
    } finally {
      setClosingId(null);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-wider">
          <span className="bracket">[</span>
          OPEN POSITIONS
          <span className="bracket">]</span>
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {positions.length} active position{positions.length !== 1 ? 's' : ''} across all markets
        </p>
      </div>

      {positions.length === 0 ? (
        <div className="nexus-card text-center py-12">
          <p className="text-muted-foreground">No open positions</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="nexus-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Market</th>
                <th>Side</th>
                <th>Size</th>
                <th>Entry Price</th>
                <th>Mark Price</th>
                <th>Unrealized PnL</th>
                <th>Opened</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position: any) => {
                const unrealizedPnl = (position.currentPrice - position.entryPrice) * position.quantity;
                const isProfit = unrealizedPnl > 0;

                return (
                  <tr key={position.id}>
                    <td className="font-mono font-bold">{position.symbol}</td>
                    <td className="capitalize text-xs">{position.market}</td>
                    <td>
                      <span className="capitalize">{position.side}</span>
                    </td>
                    <td className="font-mono">{position.size.toFixed(4)}</td>
                    <td className="font-mono">${position.entryPrice.toFixed(2)}</td>
                    <td className="font-mono">${position.markPrice.toFixed(2)}</td>
                    <td className={`font-mono font-bold ${isProfit ? "profit" : "loss"}`}>
                      ${unrealizedPnl.toFixed(2)}
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {new Date(position.openedAt).toLocaleString()}
                    </td>
                    <td>
                      <Button
                        size="sm"
                        className="nexus-button-kill"
                        onClick={() => handleClosePosition(position.id, position.marketId, position.currentPrice)}
                        disabled={closingId === position.id}
                      >
                        <X className="w-3 h-3" />
                        {closingId === position.id ? "Closing..." : "Close"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
