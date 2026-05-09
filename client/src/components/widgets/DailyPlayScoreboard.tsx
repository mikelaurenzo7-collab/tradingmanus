import React from "react";
import { Trophy, TrendingDown, Clock, MinusCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/**
 * Daily-pick Scoreboard widget.
 *
 * Renders the bot's win/loss record on its daily sports + moonshot picks
 * across both Kalshi and Polymarket.  Two modes:
 *
 *   compact (Dashboard.tsx):  3-row card — today's picks, last 30d split,
 *                             lifetime tally.
 *   full (Performance.tsx):   compact + per-platform breakdown table.
 */
interface DailyPlayScoreboardProps {
  compact?: boolean;
  className?: string;
}

interface PlatformRollup {
  wins: number;
  losses: number;
  pending: number;
  picks: number;
  totalStaked: number;
  totalPnl: number;
}

function formatPnl(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function formatPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; Icon: typeof Trophy }> = {
    pending: { label: "Open", cls: "bg-blue-500/20 text-blue-300", Icon: Clock },
    won: { label: "Won", cls: "bg-green-500/20 text-green-300", Icon: Trophy },
    lost: { label: "Lost", cls: "bg-red-500/20 text-red-300", Icon: TrendingDown },
    closed_breakeven: {
      label: "Even",
      cls: "bg-zinc-500/20 text-zinc-300",
      Icon: MinusCircle,
    },
    partial: { label: "Partial", cls: "bg-amber-500/20 text-amber-300", Icon: Clock },
    voided: { label: "Voided", cls: "bg-zinc-700/40 text-zinc-400", Icon: MinusCircle },
  };
  const e = map[status] ?? map.pending;
  const Icon = e.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
        e.cls,
      )}
    >
      <Icon size={12} />
      {e.label}
    </span>
  );
}

interface ChipPick {
  marketId: string;
  side: string;
  stakeUsd: number;
  status: string;
  confidence: number | null;
  realizedPnl?: number | null;
}

function PlatformChip({
  label,
  pick,
}: {
  label: string;
  pick: ChipPick | null;
}) {
  if (!pick) {
    return (
      <div className="flex flex-col gap-1 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-sm text-muted-foreground italic">No play yet today</div>
      </div>
    );
  }
  const truncated = pick.marketId.slice(0, 40);
  return (
    <div className="flex flex-col gap-1 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <StatusBadge status={pick.status} />
      </div>
      <div className="text-sm font-medium" title={pick.marketId}>
        {truncated}
      </div>
      <div className="text-xs text-muted-foreground">
        {pick.side.toUpperCase()} · ${pick.stakeUsd.toFixed(2)}
        {pick.confidence != null && ` · ${formatPct(pick.confidence)}`}
        {pick.realizedPnl != null && pick.status !== "pending" && (
          <span className={pick.realizedPnl >= 0 ? "text-green-300" : "text-red-300"}>
            {" · "}
            {formatPnl(pick.realizedPnl)}
          </span>
        )}
      </div>
    </div>
  );
}

function RollupCell({ label, rollup }: { label: string; rollup: PlatformRollup }) {
  return (
    <div className="flex flex-col items-start">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">
        <span className="text-green-300">{rollup.wins}W</span>
        <span className="text-muted-foreground"> · </span>
        <span className="text-red-300">{rollup.losses}L</span>
        {rollup.pending > 0 && (
          <>
            <span className="text-muted-foreground"> · </span>
            <span className="text-blue-300">{rollup.pending}P</span>
          </>
        )}
      </div>
      <div
        className={cn(
          "text-xs",
          rollup.totalPnl > 0
            ? "text-green-300"
            : rollup.totalPnl < 0
              ? "text-red-300"
              : "text-muted-foreground",
        )}
      >
        {formatPnl(rollup.totalPnl)}
      </div>
    </div>
  );
}

export function DailyPlayScoreboard({ compact = false, className }: DailyPlayScoreboardProps) {
  const scoreboardQuery = trpc.daily.getDailyPlayScoreboard.useQuery({
    platform: "both",
    daysBack: 30,
  });

  if (scoreboardQuery.isLoading || !scoreboardQuery.data) {
    return (
      <div className={cn("data-card", className)}>
        <div className="h-4 w-32 animate-shimmer rounded-md bg-white/5 mb-3" />
        <div className="h-12 animate-shimmer rounded-md bg-white/5 mb-3" />
        <div className="h-4 w-24 animate-shimmer rounded-md bg-white/5" />
      </div>
    );
  }

  const { today, days, lifetime } = scoreboardQuery.data;
  // Compute the 30-day combined rollup from days[]
  const last30 = days.reduce<PlatformRollup>(
    (acc, d) => ({
      wins: acc.wins + d.combined.wins,
      losses: acc.losses + d.combined.losses,
      pending: acc.pending + d.combined.pending,
      picks: acc.picks + d.combined.picks,
      totalStaked: acc.totalStaked + d.combined.totalStaked,
      totalPnl: acc.totalPnl + d.combined.totalPnl,
    }),
    { wins: 0, losses: 0, pending: 0, picks: 0, totalStaked: 0, totalPnl: 0 },
  );
  const last30Kalshi = days.reduce<PlatformRollup>(
    (acc, d) => ({
      wins: acc.wins + d.kalshi.wins,
      losses: acc.losses + d.kalshi.losses,
      pending: acc.pending + d.kalshi.pending,
      picks: acc.picks + d.kalshi.picks,
      totalStaked: acc.totalStaked + d.kalshi.totalStaked,
      totalPnl: acc.totalPnl + d.kalshi.totalPnl,
    }),
    { wins: 0, losses: 0, pending: 0, picks: 0, totalStaked: 0, totalPnl: 0 },
  );
  const last30Poly = days.reduce<PlatformRollup>(
    (acc, d) => ({
      wins: acc.wins + d.polymarket.wins,
      losses: acc.losses + d.polymarket.losses,
      pending: acc.pending + d.polymarket.pending,
      picks: acc.picks + d.polymarket.picks,
      totalStaked: acc.totalStaked + d.polymarket.totalStaked,
      totalPnl: acc.totalPnl + d.polymarket.totalPnl,
    }),
    { wins: 0, losses: 0, pending: 0, picks: 0, totalStaked: 0, totalPnl: 0 },
  );

  return (
    <div className={cn("data-card flex flex-col gap-4", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-amber-400" />
          <h3 className="text-sm font-semibold">Daily Pick Scoreboard</h3>
        </div>
        <div className="text-xs text-muted-foreground">
          Bot's daily sports/moonshot picks
        </div>
      </div>

      {/* Row 1: today's picks */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <PlatformChip label="Kalshi (today)" pick={today.kalshi} />
        <PlatformChip label="Polymarket (today)" pick={today.polymarket} />
      </div>

      {/* Row 2: last 30d split */}
      <div className="grid grid-cols-3 gap-2 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
        <RollupCell label="Last 30d · Kalshi" rollup={last30Kalshi} />
        <RollupCell label="Last 30d · Polymarket" rollup={last30Poly} />
        <RollupCell label="Last 30d · Combined" rollup={last30} />
      </div>

      {/* Row 3: lifetime */}
      <div className="flex items-baseline justify-between rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Lifetime
          </div>
          <div className="text-sm">
            <span className="font-medium">{formatPct(lifetime.winRate)}</span>
            <span className="text-muted-foreground">
              {" "}
              win rate · {lifetime.totalPicks} picks
            </span>
          </div>
        </div>
        <div
          className={cn(
            "text-base font-semibold",
            lifetime.totalPnl > 0
              ? "text-green-300"
              : lifetime.totalPnl < 0
                ? "text-red-300"
                : "text-muted-foreground",
          )}
        >
          {formatPnl(lifetime.totalPnl)}
        </div>
      </div>

      {/* Full mode: per-day table */}
      {!compact && days.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/5 text-left text-muted-foreground">
                <th className="py-2 pr-2">Date</th>
                <th className="py-2 pr-2">Kalshi (W/L/P)</th>
                <th className="py-2 pr-2">Polymarket (W/L/P)</th>
                <th className="py-2 pr-2 text-right">Daily PnL</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-b border-white/5">
                  <td className="py-2 pr-2 font-mono">{d.date}</td>
                  <td className="py-2 pr-2">
                    {d.kalshi.wins}/{d.kalshi.losses}/{d.kalshi.pending}
                  </td>
                  <td className="py-2 pr-2">
                    {d.polymarket.wins}/{d.polymarket.losses}/{d.polymarket.pending}
                  </td>
                  <td
                    className={cn(
                      "py-2 pr-2 text-right",
                      d.combined.totalPnl > 0
                        ? "text-green-300"
                        : d.combined.totalPnl < 0
                          ? "text-red-300"
                          : "text-muted-foreground",
                    )}
                  >
                    {formatPnl(d.combined.totalPnl)}
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

export default DailyPlayScoreboard;
