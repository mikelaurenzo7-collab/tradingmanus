import { trpc } from "@/lib/trpc";
import { Loader2, X, TrendingUp, Briefcase, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyStates";
import { EnhancedTable, type Column } from "@/components/enhanced/Table";
import { Sparkline } from "@/components/charts/Sparkline";

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

export default function Positions({ embedded = false }: { embedded?: boolean } = {}) {
  const positionsQuery = trpc.kalshi.getPositions.useQuery();
  const closePositionMutation = trpc.kalshi.closePosition.useMutation();
  const [closingId, setClosingId] = useState<number | null>(null);

  const positions = useMemo(() => {
    return ((positionsQuery.data ?? []) as KalshiPositionRow[]).filter(
      (position) => position.positionStatus !== "closed"
    );
  }, [positionsQuery.data]);

  // Calculate summary metrics
  const summary = useMemo(() => {
    const totalPnl = positions.reduce((sum, p) => {
      const entryPrice = Number(p.entryPrice ?? 0);
      const currentPrice = Number(p.currentPrice ?? 0);
      const quantity = Number(p.quantity ?? 0);
      const storedUnrealized = Number(p.unrealizedPnl ?? 0);
      const computedUnrealized =
        p.side === "no"
          ? quantity * (entryPrice - currentPrice)
          : quantity * (currentPrice - entryPrice);
      const unrealizedPnl =
        Number.isFinite(storedUnrealized) && storedUnrealized !== 0
          ? storedUnrealized
          : computedUnrealized;
      return sum + unrealizedPnl;
    }, 0);

    const totalExposure = positions.reduce((sum, p) => {
      return sum + Number(p.quantity ?? 0) * Number(p.entryPrice ?? 0);
    }, 0);

    return {
      count: positions.length,
      totalPnl,
      totalExposure,
    };
  }, [positions]);

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

  // Define table columns
  const columns: Column<KalshiPositionRow>[] = useMemo(
    () => [
      {
        key: "marketId",
        header: "Market",
        sortable: true,
        width: "25%",
        render: (value) => (
          <span className="font-mono text-xs font-semibold text-white/90">
            {String(value)}
          </span>
        ),
      },
      {
        key: "side",
        header: "Side",
        sortable: true,
        width: 80,
        render: (value) => (
          <Badge
            variant={value === "yes" ? "default" : "destructive"}
            className={
              value === "yes"
                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 uppercase"
                : "bg-rose-500/20 text-rose-400 border-rose-500/30 uppercase"
            }
          >
            {String(value)}
          </Badge>
        ),
      },
      {
        key: "quantity",
        header: "Qty",
        sortable: true,
        width: 80,
        render: (value) => (
          <span className="font-mono text-sm">{formatQuantity(Number(value))}</span>
        ),
      },
      {
        key: "entryPrice",
        header: "Entry",
        sortable: true,
        width: 100,
        render: (value) => (
          <span className="font-mono text-sm">{formatPrice(Number(value))}</span>
        ),
      },
      {
        key: "currentPrice",
        header: "Current",
        sortable: true,
        width: 140,
        render: (value, row) => {
          // Placeholder for sparkline - can be populated with historical data
          const mockPriceHistory = Array.from({ length: 10 }, (_, i) => {
            const basePrice = Number(row.entryPrice ?? 0);
            const currentPriceVal = Number(value ?? 0);
            const priceDiff = currentPriceVal - basePrice;
            return basePrice + (priceDiff * i) / 9 + (Math.random() - 0.5) * 0.02;
          });

          return (
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm">{formatPrice(Number(value))}</span>
              {mockPriceHistory.length > 1 && (
                <Sparkline
                  data={mockPriceHistory}
                  width={60}
                  height={20}
                  color={
                    Number(value) >= Number(row.entryPrice)
                      ? "rgb(52, 211, 153)"
                      : "rgb(251, 113, 133)"
                  }
                  strokeWidth={1.5}
                />
              )}
            </div>
          );
        },
      },
      {
        key: "unrealizedPnl",
        header: "P&L",
        sortable: true,
        width: 120,
        render: (value, row) => {
          const entryPrice = Number(row.entryPrice ?? 0);
          const currentPrice = Number(row.currentPrice ?? 0);
          const quantity = Number(row.quantity ?? 0);
          const storedUnrealized = Number(value ?? 0);
          const computedUnrealized =
            row.side === "no"
              ? quantity * (entryPrice - currentPrice)
              : quantity * (currentPrice - entryPrice);
          const unrealizedPnl =
            Number.isFinite(storedUnrealized) && storedUnrealized !== 0
              ? storedUnrealized
              : computedUnrealized;
          const isProfit = unrealizedPnl > 0;

          return (
            <span
              className={`font-mono text-sm font-bold ${
                isProfit
                  ? "text-emerald-400"
                  : unrealizedPnl < 0
                    ? "text-rose-400"
                    : "text-muted-foreground"
              }`}
            >
              {isProfit ? "+" : ""}${unrealizedPnl.toFixed(2)}
            </span>
          );
        },
      },
      {
        key: "id",
        header: "Actions",
        width: 100,
        pinned: "right",
        render: (value, row) => {
          const positionId = Number(value);
          const isClosing = closingId === positionId || row.positionStatus === "closing";

          return (
            <Button
              size="sm"
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation();
                handleClosePosition(
                  positionId,
                  row.marketId,
                  Number(row.currentPrice),
                  row.side,
                  Number(row.quantity),
                );
              }}
              disabled={isClosing}
              className="h-8 px-3"
            >
              {isClosing ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  Closing
                </>
              ) : (
                <>
                  <X className="w-3 h-3 mr-1.5" />
                  Close
                </>
              )}
            </Button>
          );
        },
      },
    ],
    [closingId],
  );

  if (positionsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin w-8 h-8 text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {embedded ? null : (
      <PageHeader
        icon={Briefcase}
        title="Open Positions"
        description={
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            {summary.count} active Kalshi position{summary.count !== 1 ? "s" : ""}
          </span>
        }
        iconColor="text-success"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => positionsQuery.refetch()}
            disabled={positionsQuery.isRefetching}
            className="gap-2"
          >
            {positionsQuery.isRefetching ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Refresh
          </Button>
        }
      />
      )}

      {/* Summary Cards */}
      {positions.length > 0 && (
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
          style={{
            animation: "fadeSlideUp 0.5s ease-out",
          }}
        >
          <div className="glass-panel p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary-500/20 flex items-center justify-center">
                <Briefcase className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Total Positions
                </p>
                <p className="text-2xl font-bold text-white">{summary.count}</p>
              </div>
            </div>
          </div>

          <div className="glass-panel p-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  summary.totalPnl >= 0
                    ? "bg-emerald-500/20"
                    : "bg-rose-500/20"
                }`}
              >
                <TrendingUp
                  className={`w-5 h-5 ${
                    summary.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Total P&L
                </p>
                <p
                  className={`text-2xl font-bold ${
                    summary.totalPnl >= 0
                      ? "text-emerald-400"
                      : "text-rose-400"
                  }`}
                >
                  {summary.totalPnl >= 0 ? "+" : ""}${summary.totalPnl.toFixed(2)}
                </p>
              </div>
            </div>
          </div>

          <div className="glass-panel p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Total Exposure
                </p>
                <p className="text-2xl font-bold text-white">
                  ${summary.totalExposure.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Positions Table */}
      {positions.length === 0 ? (
        <div
          className="glass-panel"
          style={{
            animation: "fadeSlideUp 0.5s ease-out 0.1s both",
          }}
        >
          <EmptyState
            icon={TrendingUp}
            title="No open positions"
            message="Your active positions will appear here once you start trading."
          />
        </div>
      ) : (
        <div
          className="glass-panel overflow-hidden"
          style={{
            animation: "fadeSlideUp 0.5s ease-out 0.1s both",
          }}
        >
          <EnhancedTable
            columns={columns}
            data={positions}
            stickyHeader={true}
            zebraStriping={true}
            hoverGlow={true}
            emptyMessage="No positions found"
          />
        </div>
      )}

      <style>
        {`
          @keyframes fadeSlideUp {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}
      </style>
    </div>
  );
}
