import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, TrendingUp, TrendingDown } from "lucide-react";

export default function PaperTrading() {
  const paperTrades = trpc.paperTrading.list.useQuery({ limitDays: 30 });

  if (paperTrades.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-cyan-400 font-mono">[ PAPER TRADING LAB ]</h1>
          <p className="text-gray-400 mt-2">Loading...</p>
        </div>
      </div>
    );
  }

  if (paperTrades.error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-cyan-400 font-mono">[ PAPER TRADING LAB ]</h1>
          <p className="text-red-400 mt-2">Error loading paper trades</p>
        </div>
      </div>
    );
  }

  const formatPnL = (pnl: number | null, pnlPct: number | null) => {
    if (pnl === null) return "Pending";
    const color = pnl > 0 ? "text-green-400" : pnl < 0 ? "text-red-400" : "text-gray-400";
    return (
      <span className={color}>
        {pnl > 0 ? "+" : ""}{pnl.toFixed(2)} ({pnlPct?.toFixed(2)}%)
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-cyan-400 font-mono">[ PAPER TRADING LAB ]</h1>
        <p className="text-gray-400 mt-2">Immutable trade journal with founder annotations and strategy validation</p>
      </div>

      {/* Active Paper Trades */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-magenta-400 font-mono">[ ACTIVE TRADES ]</h2>

        <div className="grid gap-4">
          {paperTrades.data?.filter((t) => !t.exitedAt)?.map((trade) => (
            <Card key={trade.id} className="border-cyan-900 bg-black/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {trade.side === "long" || trade.side === "yes" ? (
                      <TrendingUp className="w-5 h-5 text-green-400" />
                    ) : (
                      <TrendingDown className="w-5 h-5 text-red-400" />
                    )}
                    <div>
                      <CardTitle className="text-cyan-400">
                        {trade.symbol} • {trade.side.toUpperCase()}
                      </CardTitle>
                      <CardDescription className="text-gray-500">
                        {trade.strategyTag} • {trade.market}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge className="bg-yellow-900 text-yellow-200">OPEN</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-gray-500">Entry Price</div>
                    <div className="text-cyan-400 font-mono">${trade.entryPrice.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Quantity</div>
                    <div className="text-cyan-400 font-mono">{trade.quantity}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-gray-500">Entry Signal</div>
                    <div className="text-gray-300 text-xs mt-1">{trade.entrySignal}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-gray-500">Rationale</div>
                    <div className="text-gray-300 text-xs mt-1">{trade.entryRationale}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {!paperTrades.data?.some((t) => !t.exitedAt) && (
            <Card className="border-gray-800 bg-black/50">
              <CardContent className="pt-6">
                <div className="text-center text-gray-400">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No active paper trades</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Closed Paper Trades */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-magenta-400 font-mono">[ CLOSED TRADES ]</h2>

        <div className="grid gap-4">
          {paperTrades.data?.filter((t) => t.exitedAt)?.map((trade) => (
            <Card key={trade.id} className="border-magenta-900 bg-black/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {trade.pnl && trade.pnl > 0 ? (
                      <TrendingUp className="w-5 h-5 text-green-400" />
                    ) : (
                      <TrendingDown className="w-5 h-5 text-red-400" />
                    )}
                    <div>
                      <CardTitle className="text-magenta-400">
                        {trade.symbol} • {trade.side.toUpperCase()}
                      </CardTitle>
                      <CardDescription className="text-gray-500">
                        {trade.strategyTag} • {trade.market}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-500">PnL</div>
                    {formatPnL(trade.pnl, trade.pnlPct)}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-gray-500">Entry</div>
                    <div className="text-cyan-400 font-mono">${trade.entryPrice.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Exit</div>
                    <div className="text-magenta-400 font-mono">${trade.exitPrice?.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Entered</div>
                    <div className="text-gray-300 text-xs">{new Date(trade.enteredAt).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Exited</div>
                    <div className="text-gray-300 text-xs">{trade.exitedAt && new Date(trade.exitedAt).toLocaleString()}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {!paperTrades.data?.some((t) => t.exitedAt) && (
            <Card className="border-gray-800 bg-black/50">
              <CardContent className="pt-6">
                <div className="text-center text-gray-400">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No closed paper trades yet</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
