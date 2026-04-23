import { trpc } from "@/lib/trpc";
import { Loader2, Play, Pause, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Bots() {
  const botsQuery = { data: [], isLoading: false, error: null, refetch: async () => {} };
  const updateStatusMutation = { mutateAsync: async () => {} };

  if (botsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin w-8 h-8 text-primary" />
      </div>
    );
  }

  const bots = botsQuery.data || [];

  const handleStatusChange = async (botId: number, newStatus: 'running' | 'paused' | 'stopped') => {
    try {
      await updateStatusMutation.mutateAsync();
      botsQuery.refetch();
    } catch (error) {
      console.error("Failed to update bot status:", error);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-wider">
          <span className="bracket">[</span>
          BOT MANAGEMENT
          <span className="bracket">]</span>
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Monitor and control automated trading bots across all markets
        </p>
      </div>

      {bots.length === 0 ? (
        <div className="laurenzo-card text-center py-12">
          <p className="text-muted-foreground">No bots configured</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="laurenzo-table">
            <thead>
              <tr>
                <th>Bot Name</th>
                <th>Market</th>
                <th>Strategy</th>
                <th>Status</th>
                <th>Last Action</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {bots.map((bot: any) => (
                <tr key={bot.id}>
                  <td className="font-mono">{bot.name}</td>
                  <td>
                    <span className="capitalize">{bot.market}</span>
                  </td>
                  <td className="text-xs text-muted-foreground">{bot.strategy}</td>
                  <td>
                    <span className={`status-badge status-${bot.status}`}>
                      {bot.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {new Date(bot.lastActionAt).toLocaleString()}
                  </td>
                  <td className="space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleStatusChange(bot.id, 'running')}
                      disabled={bot.status === 'running'}
                    >
                      <Play className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleStatusChange(bot.id, 'paused')}
                      disabled={bot.status === 'paused'}
                    >
                      <Pause className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleStatusChange(bot.id, 'stopped')}
                      disabled={bot.status === 'stopped'}
                    >
                      <Square className="w-3 h-3" />
                    </Button>
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
