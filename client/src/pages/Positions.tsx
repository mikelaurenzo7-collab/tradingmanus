import { trpc } from "@/lib/trpc";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";

type KalshiPositionRow = {
  id: number;
  marketId: string;
  side: "yes" | "no";
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  positionStatus: "open" | "closing" | "closed";
  openedAt: string | Date;
  closedAt: string | Date | null;
};

function formatPrice(value: number) {
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : "—";
}

function formatQuantity(value: number) {
  return Number.isFinite(value) ? value.toString() : "—";
}

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

  const positions = ((positionsQuery.data ?? []) as KalshiPositionRow[]).filter(
    (position) => position.positionStatus !== "closed"
  );

  const handleClosePosition = async (
    positionId: number,
    marketId: string,
    currentPrice: number,
    side: "yes" | "no",
    quantity: number,
  ) => {
    const confirmed = window.confirm(
      `Close ${quantity} ${side.toUpperCase()} on ${marketId} at ~$${currentPrice.toFixed(2)}? This will submit a closing order.`,
    );
    if (!confirmed) {
      return;
    }

    setClosingId(positionId);
    const pendingToast = toast.loading(`Submitting close order for ${marketId}…`);
    try {
      await closePositionMutation.mutateAsync({
        positionId,
        marketId,
        currentPrice,
      });
      toast.success(`Close order submitted for ${marketId}`, { id: pendingToast });
      await positionsQuery.refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error closing position";
      console.error("Failed to close position:", error);
      toast.error(`Close order failed: ${message}`, { id: pendingToast });
    } finally {
      setClosingId(null);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-wider gradient-text">Open Positions</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {positions.length} active Kalshi position{positions.length !== 1 ? "s" : ""}
        </p>
      </div>

      {positions.length === 0 ? (
        <div className="laurenzo-card text-center py-12">
          <p className="text-muted-foreground">No open positions</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="laurenzo-table">
            <thead>
              <tr>
                <th>Market</th>
                <th>Side</th>
                <th>Quantity</th>
                <th>Entry Price</th>
                <th>Current Price</th>
                <th>Unrealized P&amp;L</th>
                <th>Status</th>
                <th>Opened</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => {
                const entryPrice = Number(position.entryPrice ?? 0);
                const currentPrice = Number(position.currentPrice ?? 0);
                const quantity = Number(position.quantity ?? 0);
                const storedUnrealized = Number(position.unrealizedPnl ?? 0);
                const computedUnrealized =
                  position.side === "no"
                    ? quantity * (entryPrice - currentPrice)
                    : quantity * (currentPrice - entryPrice);
                const unrealizedPnl =
                  Number.isFinite(storedUnrealized) && storedUnrealized !== 0
                    ? storedUnrealized
                    : computedUnrealized;
                const isProfit = unrealizedPnl > 0;

                return (
                  <tr key={position.id}>
                    <td className="font-mono font-bold text-xs">{position.marketId}</td>
                    <td>
                      <span
                        className={
                          position.side === "yes"
                            ? "text-emerald-400 font-semibold uppercase"
                            : "text-rose-400 font-semibold uppercase"
                        }
                      >
                        {position.side}
                      </span>
                    </td>
                    <td className="font-mono">{formatQuantity(quantity)}</td>
                    <td className="font-mono">{formatPrice(entryPrice)}</td>
                    <td className="font-mono">{formatPrice(currentPrice)}</td>
                    <td
                      className={`font-mono font-bold ${
                        isProfit
                          ? "text-emerald-400"
                          : unrealizedPnl < 0
                            ? "text-rose-400"
                            : "text-muted-foreground"
                      }`}
                    >
                      {isProfit ? "+" : ""}${unrealizedPnl.toFixed(2)}
                    </td>
                    <td className="capitalize text-xs">{position.positionStatus}</td>
                    <td className="text-xs text-muted-foreground">
                      {position.openedAt ? new Date(position.openedAt).toLocaleString() : "—"}
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          handleClosePosition(
                            position.id,
                            position.marketId,
                            currentPrice,
                            position.side,
                            quantity,
                          )
                        }
                        disabled={
                          closingId === position.id || position.positionStatus === "closing"
                        }
                      >
                        {closingId === position.id ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <X className="w-3 h-3 mr-1" />
                        )}
                        {closingId === position.id ? "Closing…" : "Close"}
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
