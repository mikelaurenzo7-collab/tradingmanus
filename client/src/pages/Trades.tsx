import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Receipt, TrendingUp, TrendingDown, Search, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyStates";
import { TableSkeleton } from "@/components/enhanced/Skeletons";
import { EnhancedTable, Column } from "@/components/enhanced/Table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Trade {
  id: string;
  marketId: string;
  side: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  positionStatus: string;
  realizedPnl: number;
  unrealizedPnl: number;
  closedAt: string | null;
}

export default function Trades() {
  const tradeHistoryQuery = trpc.kalshi.getTradeHistory.useQuery({ limit: 50 });
  
  const [searchQuery, setSearchQuery] = useState("");
  const [sideFilter, setSideFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const trades = tradeHistoryQuery.data || [];
  
  // Client-side filtering
  const filteredTrades = useMemo(() => {
    return trades.filter((trade: Trade) => {
      const matchesSearch = searchQuery === "" || 
        trade.marketId.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesSide = sideFilter === "all" || trade.side === sideFilter;
      const matchesStatus = statusFilter === "all" || trade.positionStatus === statusFilter;
      
      return matchesSearch && matchesSide && matchesStatus;
    });
  }, [trades, searchQuery, sideFilter, statusFilter]);

  // Summary calculations
  const winners = trades.filter((t: Trade) => Number(t.realizedPnl ?? 0) > 0).length;
  const losers = trades.filter((t: Trade) => Number(t.realizedPnl ?? 0) < 0).length;
  const totalRealized = trades.reduce((sum: number, t: Trade) => sum + Number(t.realizedPnl ?? 0), 0);
  const totalVolume = trades.reduce((sum: number, t: Trade) => sum + (t.quantity * t.entryPrice), 0);

  // Table columns
  const columns: Column<Trade>[] = [
    {
      key: "closedAt",
      header: "Timestamp",
      sortable: true,
      width: 180,
      render: (value) => (
        <span className="text-xs text-muted-foreground">
          {value ? new Date(value as string).toLocaleString() : "—"}
        </span>
      ),
    },
    {
      key: "marketId",
      header: "Market",
      sortable: true,
      render: (value) => (
        <span className="font-mono text-sm font-semibold truncate max-w-[200px] block">
          {value as string}
        </span>
      ),
    },
    {
      key: "side",
      header: "Side",
      sortable: true,
      width: 100,
      render: (value) => (
        <Badge
          variant="outline"
          className={
            value === "yes"
              ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
              : "border-rose-400/40 bg-rose-500/10 text-rose-300"
          }
        >
          {(value as string).toUpperCase()}
        </Badge>
      ),
    },
    {
      key: "quantity",
      header: "Qty",
      sortable: true,
      width: 80,
      className: "font-mono tabular-nums",
      render: (value) => value,
    },
    {
      key: "entryPrice",
      header: "Price",
      sortable: true,
      width: 100,
      className: "font-mono tabular-nums",
      render: (value) => `$${(value as number).toFixed(4)}`,
    },
    {
      key: "positionStatus",
      header: "Status",
      sortable: true,
      width: 100,
      render: (value) => (
        <Badge
          variant="outline"
          className={
            value === "closed"
              ? "border-slate-400/40 bg-slate-500/10 text-slate-300"
              : "border-blue-400/40 bg-blue-500/10 text-blue-300"
          }
        >
          {(value as string).charAt(0).toUpperCase() + (value as string).slice(1)}
        </Badge>
      ),
    },
    {
      key: "realizedPnl",
      header: "P&L",
      sortable: true,
      width: 120,
      render: (value, row) => {
        const pnl = value as number;
        return (
          <span
            className={`font-mono text-sm tabular-nums font-semibold ${
              pnl >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
          </span>
        );
      },
    },
  ];

  if (tradeHistoryQuery.isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          icon={Receipt}
          title="Trade History"
          description="Loading trade data..."
        />
        <div className="glass-panel p-8">
          <TableSkeleton rows={8} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        icon={Receipt}
        title="Trade History"
        description={`${trades.length} trade${trades.length !== 1 ? "s" : ""} in the last 30 days`}
        badge={
          trades.length > 0 ? (
            <Badge
              variant="outline"
              className={`gap-1.5 px-2.5 py-1 ${
                totalRealized >= 0
                  ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-400/40 bg-rose-500/10 text-rose-300"
              }`}
            >
              {totalRealized >= 0 ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              ${totalRealized.toFixed(2)}
            </Badge>
          ) : null
        }
      />

      {trades.length === 0 ? (
        <div className="glass-panel p-8">
          <EmptyState
            icon={Receipt}
            title="No trades recorded"
            message="Closed positions and their realized P&L will appear here once your bot starts trading."
          />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Trades" value={trades.length.toString()} accent="text-white" />
            <StatCard label="Winners" value={winners.toString()} accent="text-emerald-400" />
            <StatCard label="Losers" value={losers.toString()} accent="text-rose-400" />
            <StatCard label="Volume" value={`$${totalVolume.toFixed(0)}`} accent="text-primary" />
          </div>

          {/* Filter Bar */}
          <div className="glass-panel p-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search markets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={sideFilter} onValueChange={setSideFilter}>
                <SelectTrigger className="w-full sm:w-[140px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Side" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sides</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[140px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Enhanced Table */}
          <div className="glass-panel overflow-hidden">
            {filteredTrades.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={Search}
                  title="No matching trades"
                  message="Try adjusting your filters to see more results."
                />
              </div>
            ) : (
              <EnhancedTable
                columns={columns}
                data={filteredTrades}
                stickyHeader
                zebraStriping
                hoverGlow
                emptyMessage="No trades found"
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="glass-panel p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}
