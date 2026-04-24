import { Activity, ArrowRight, BarChart3, Briefcase, ShieldCheck, Waves } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { getFastActionItems, getFirstTestReadiness, getLandingBadge, getVisibleCapital } from "@/lib/dashboardLanding";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function Home() {
  const performance = trpc.kalshi.getPerformanceOverview.useQuery();
  const positions = trpc.kalshi.getPositions.useQuery();
  const feeds = trpc.kalshi.getAllMarketFeeds.useQuery();
  const accountStatus = trpc.kalshi.getKalshiAccountStatus.useQuery(undefined, {
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  const connected = accountStatus.data?.connected ?? false;
  const confirmedEquity = getVisibleCapital({
    connected: connected && accountStatus.data?.status === "connected",
    currentBalance: accountStatus.data?.equity ?? 0,
  });
  const liveFeedCount = (feeds.data ?? []).filter((feed) => feed?.currentSnapshot).length;
  const openPositions = (positions.data ?? []).filter((position: { status?: string }) => position.status === "open");
  const badge = getLandingBadge({
    connected,
    currentBalance: confirmedEquity,
    liveFeedCount,
    maxDrawdown: performance.data?.metrics.maxDrawdown ?? 0,
  });
  const readiness = getFirstTestReadiness({
    connected,
    currentBalance: confirmedEquity,
    liveFeedCount,
    maxDrawdown: performance.data?.metrics.maxDrawdown ?? 0,
  });
  const actions = getFastActionItems();

  const cards = [
    {
      title: "Tracked Capital",
      value: connected && accountStatus.data?.status === "connected" ? formatCurrency(confirmedEquity) : "—",
      description:
        connected && accountStatus.data?.status === "connected"
          ? "Live equity confirmed from the connected Kalshi account"
          : connected
            ? "Waiting for a fresh live equity confirmation from Kalshi"
            : "Connect Kalshi to sync live account equity",
      accent: "text-cyan-300",
      icon: Activity,
    },
    {
      title: "Daily P&L",
      value: formatCurrency(performance.data?.metrics.dailyPnL ?? 0),
      description: "Current trading-day contribution",
      accent: (performance.data?.metrics.dailyPnL ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300",
      icon: BarChart3,
    },
    {
      title: "Open Positions",
      value: String(openPositions.length),
      description: "Currently consuming live risk budget",
      accent: "text-violet-300",
      icon: Briefcase,
    },
    {
      title: "Live Feeds",
      value: String(liveFeedCount),
      description: "Markets contributing active microstructure telemetry",
      accent: "text-amber-300",
      icon: Waves,
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Badge className={`mb-3 border px-3 py-1 font-mono ${badge.tone === "connected" ? "border-emerald-700 bg-emerald-950/40 text-emerald-300" : badge.tone === "funding" ? "border-amber-700 bg-amber-950/40 text-amber-300" : "border-cyan-700 bg-cyan-950/40 text-cyan-300"}`}>
            <ShieldCheck className="mr-2 h-3.5 w-3.5" />
            {badge.label}
          </Badge>
          <h1 className="bg-gradient-to-r from-violet-400 via-fuchsia-300 to-cyan-300 bg-clip-text text-4xl font-bold text-transparent">
            Kalshi Operating Overview
          </h1>
          <p className="mt-2 max-w-3xl text-slate-400">
            Use this control surface to confirm account connection, inspect live exposure, and jump into the highest-impact analytics before the next trade decision.
          </p>
          {readiness.needsFundingReview ? (
            <p className="mt-3 max-w-3xl text-sm text-amber-300">
              Your account appears connected but not yet funded. Complete the connection check, then add capital on Kalshi before your first live order.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/connect">
            <Button className="laurenzo-button">Connect Kalshi</Button>
          </Link>
          <Link href="/signals">
            <Button variant="outline" className="border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800">
              Review Signals
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title} className="border-slate-800 bg-slate-950/70">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                  <Icon className="h-5 w-5 text-slate-400" />
                  {card.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-semibold ${card.accent}`}>{card.value}</div>
                <p className="mt-2 text-sm text-slate-500">{card.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-slate-800 bg-slate-950/70">
          <CardHeader>
            <CardTitle>First-Test Readiness</CardTitle>
            <CardDescription>
              The next live test should move from connection to controlled observation rather than immediate aggressive execution.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Connection</div>
              <div className="mt-2 text-lg font-semibold text-slate-100">{readiness.connectionLabel}</div>
              <p className="mt-2 text-sm text-slate-500">Paste your fresh laptop-generated key pair directly in the Connect Kalshi flow.</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Risk posture</div>
              <div className="mt-2 text-lg font-semibold text-slate-100">{readiness.drawdownUsageLabel}</div>
              <p className="mt-2 text-sm text-slate-500">Current drawdown usage should be reviewed before the first live order.</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Microstructure</div>
              <div className="mt-2 text-lg font-semibold text-slate-100">{readiness.microstructureLabel}</div>
              <p className="mt-2 text-sm text-slate-500">Active feed snapshots available for liquidity-aware signal screening.</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-950/70">
          <CardHeader>
            <CardTitle>Fastest Next Actions</CardTitle>
            <CardDescription>
              Use these entry points to move through the most important Kalshi workflows without hunting across the sidebar.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {actions.map((item) => (
              <Link key={item.href} href={item.href}>
                <div className="group cursor-pointer rounded-2xl border border-slate-800 bg-slate-900/60 p-4 transition hover:border-cyan-500/50 hover:bg-slate-900">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-100">{item.title}</div>
                      <p className="mt-1 text-sm text-slate-500">{item.body}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-500 transition group-hover:text-cyan-300" />
                  </div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
