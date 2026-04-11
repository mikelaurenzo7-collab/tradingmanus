import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";

export default function AuditLog() {
  const auditLog = trpc.audit.log.useQuery({ limitDays: 30 });

  const getEventColor = (eventType: string) => {
    if (eventType.includes("kill_switch")) return "bg-red-900 text-red-200";
    if (eventType.includes("position_close")) return "bg-yellow-900 text-yellow-200";
    if (eventType.includes("strategy")) return "bg-blue-900 text-blue-200";
    if (eventType.includes("risk")) return "bg-orange-900 text-orange-200";
    return "bg-gray-900 text-gray-200";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-cyan-400 font-mono">[ AUDIT LOG ]</h1>
        <p className="text-gray-400 mt-2">Immutable record of all system decisions, overrides, and governance events</p>
      </div>

      <div className="space-y-2">
        {auditLog.data?.map((event) => (
          <Card key={event.id} className="border-gray-800 bg-black/50">
            <CardContent className="pt-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge className={getEventColor(event.eventType)}>
                      {event.eventType.replace(/_/g, " ").toUpperCase()}
                    </Badge>
                    <span className="text-xs text-gray-500">
                      {new Date(event.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-gray-300 text-sm">{event.eventType}</div>
                  {event.details && (
                    <div className="text-gray-400 text-xs font-mono bg-black/50 p-2 rounded mt-2">
                      {event.details}
                    </div>
                  )}
                </div>
                {event.triggeredByOpenId && (
                  <div className="text-right text-xs text-gray-500">
                    <div>User</div>
                    <div className="font-mono">{event.triggeredByOpenId.substring(0, 8)}...</div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {!auditLog.data || auditLog.data.length === 0 && (
          <Card className="border-gray-800 bg-black/50">
            <CardContent className="pt-6">
              <div className="text-center text-gray-400">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No audit events recorded</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
