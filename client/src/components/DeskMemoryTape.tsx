import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DeskMemoryStats {
  [deskId: string]: {
    totalLessons: number;
    winRate: number;
    recentLessons: Array<{
      ts: string;
      outcome: "win" | "loss" | "scratch";
      note: string;
    }>;
  };
}

interface DeskMemoryTapeProps {
  deskMemoryStats: DeskMemoryStats;
}

function getStatusColor(lessonsCount: number): string {
  if (lessonsCount >= 4) return "text-emerald-400";
  if (lessonsCount >= 2) return "text-yellow-400";
  return "text-rose-400";
}

function getOutcomeColor(outcome: "win" | "loss" | "scratch"): string {
  if (outcome === "win") return "text-emerald-400";
  if (outcome === "loss") return "text-rose-400";
  return "text-muted-foreground";
}

export default function DeskMemoryTape({ deskMemoryStats }: DeskMemoryTapeProps) {
  const [expandedDesk, setExpandedDesk] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const desks = Object.entries(deskMemoryStats)
    .sort((a, b) => b[1].totalLessons - a[1].totalLessons)
    .map(([deskId, stats]) => ({
      deskId,
      ...stats,
    }));

  const handleRowClick = (deskId: string) => {
    setExpandedDesk(expandedDesk === deskId ? null : deskId);
    setDetailsOpen(true);
  };

  const expandedDeskData = expandedDesk
    ? desks.find((d) => d.deskId === expandedDesk)
    : null;

  return (
    <>
      <div className="data-card space-y-4">
        <h2 className="text-xl font-semibold">📚 Desk Memory Health</h2>

        {desks.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No desk memory recorded yet. Complete autonomy cycles to record lessons.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="laurenzo-table">
              <thead>
                <tr>
                  <th>Desk</th>
                  <th>Lessons</th>
                  <th>Win Rate</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {desks.map((desk) => (
                  <tr
                    key={desk.deskId}
                    onClick={() => handleRowClick(desk.deskId)}
                    className="cursor-pointer hover:bg-muted/50"
                  >
                    <td className="font-semibold capitalize">
                      {desk.deskId.replace(/_/g, " ")}
                    </td>
                    <td className="font-mono">{desk.totalLessons}</td>
                    <td className={`font-bold ${getStatusColor(desk.totalLessons)}`}>
                      {desk.winRate}%
                    </td>
                    <td>
                      <span
                        className={`text-xs font-semibold px-2 py-1 rounded ${
                          desk.totalLessons >= 4
                            ? "bg-emerald-500/20 text-emerald-400"
                            : desk.totalLessons >= 2
                              ? "bg-yellow-500/20 text-yellow-400"
                              : "bg-rose-500/20 text-rose-400"
                        }`}
                      >
                        {desk.totalLessons >= 4
                          ? "Ready"
                          : desk.totalLessons >= 2
                            ? "Growing"
                            : "Building"}
                      </span>
                    </td>
                    <td>
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="bg-blue-500/10 border border-blue-500/30 text-blue-100 p-3 rounded text-sm">
          <strong>📖 Desk Memory:</strong> Records lessons from each trade outcome. 4+ lessons
          per desk indicates sufficient learning history.
        </div>
      </div>

      {/* Details Modal */}
      {expandedDeskData && (
        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {expandedDeskData.deskId.replace(/_/g, " ")} — Lessons
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Total Lessons</p>
                  <p className="text-2xl font-bold">{expandedDeskData.totalLessons}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Win Rate</p>
                  <p
                    className={`text-2xl font-bold ${getStatusColor(
                      expandedDeskData.totalLessons
                    )}`}
                  >
                    {expandedDeskData.winRate}%
                  </p>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Recent Lessons</h4>
                <div className="space-y-2">
                  {expandedDeskData.recentLessons.length > 0 ? (
                    expandedDeskData.recentLessons.map((lesson, idx) => (
                      <div
                        key={idx}
                        className="border border-border rounded p-3 text-sm"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={`text-xs font-bold uppercase ${getOutcomeColor(
                              lesson.outcome
                            )}`}
                          >
                            {lesson.outcome}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(lesson.ts).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-muted-foreground">{lesson.note}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground text-sm">No lessons recorded</p>
                  )}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
