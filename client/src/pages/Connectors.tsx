import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, XCircle, Clock } from "lucide-react";

export default function Connectors() {
  const [selectedMarket, setSelectedMarket] = useState<"stocks" | "crypto" | "prediction">("stocks");

  const dataConnectors = trpc.connectors.dataConnectors.useQuery();
  const accountConnectors = trpc.connectors.accountConnectors.useQuery();

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "connected":
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case "disconnected":
        return <XCircle className="w-4 h-4 text-gray-500" />;
      case "error":
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      case "stale":
        return <Clock className="w-4 h-4 text-yellow-500" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "connected":
        return "bg-green-900 text-green-200";
      case "disconnected":
        return "bg-gray-900 text-gray-300";
      case "error":
        return "bg-red-900 text-red-200";
      case "stale":
        return "bg-yellow-900 text-yellow-200";
      default:
        return "bg-gray-900 text-gray-300";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-cyan-400 font-mono">[ DATA CONNECTORS ]</h1>
        <p className="text-gray-400 mt-2">Real-time market data and account state feeds</p>
      </div>

      {/* Data Connectors Section */}
      <div className="space-y-4">
        <div className="flex gap-2">
          {(["stocks", "crypto", "prediction"] as const).map((market) => (
            <Button
              key={market}
              variant={selectedMarket === market ? "default" : "outline"}
              onClick={() => setSelectedMarket(market)}
              className="capitalize"
            >
              {market}
            </Button>
          ))}
        </div>

        <div className="grid gap-4">
          {dataConnectors.data?.map((connector) => (
            <Card key={connector.id} className="border-cyan-900 bg-black/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(connector.status)}
                    <div>
                      <CardTitle className="text-cyan-400">{connector.name}</CardTitle>
                      <CardDescription className="text-gray-500">
                        {connector.source} • {connector.market}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge className={getStatusColor(connector.status)}>
                    {connector.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  {connector.lastSyncAt && (
                    <div className="text-gray-400">
                      Last sync: {new Date(connector.lastSyncAt).toLocaleString()}
                    </div>
                  )}
                  {connector.errorMessage && (
                    <div className="text-red-400 font-mono text-xs">{connector.errorMessage}</div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}

          {!dataConnectors.data || dataConnectors.data.length === 0 && (
            <Card className="border-gray-800 bg-black/50">
              <CardContent className="pt-6">
                <div className="text-center text-gray-400">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No data connectors configured</p>
                  <p className="text-sm mt-1">Add market data feeds to begin real-data trading</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Account Connectors Section */}
      <div className="space-y-4 mt-8">
        <h2 className="text-xl font-bold text-magenta-400 font-mono">[ ACCOUNT CONNECTORS ]</h2>

        <div className="grid gap-4">
          {accountConnectors.data?.map((connector) => (
            <Card key={connector.id} className="border-magenta-900 bg-black/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(connector.status)}
                    <div>
                      <CardTitle className="text-magenta-400">{connector.name}</CardTitle>
                      <CardDescription className="text-gray-500">
                        {connector.source}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge className={getStatusColor(connector.status)}>
                    {connector.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  {connector.balance !== null && (
                    <div className="text-gray-400">
                      Balance: <span className="text-green-400 font-mono">${connector.balance.toFixed(2)}</span>
                    </div>
                  )}
                  {connector.lastSyncAt && (
                    <div className="text-gray-400">
                      Last sync: {new Date(connector.lastSyncAt).toLocaleString()}
                    </div>
                  )}
                  {connector.errorMessage && (
                    <div className="text-red-400 font-mono text-xs">{connector.errorMessage}</div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}

          {!accountConnectors.data || accountConnectors.data.length === 0 && (
            <Card className="border-gray-800 bg-black/50">
              <CardContent className="pt-6">
                <div className="text-center text-gray-400">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No account connectors configured</p>
                  <p className="text-sm mt-1">Link your trading accounts to enable live trading</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
