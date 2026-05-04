import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Cpu,
  FileText,
  LayoutDashboard,
  LineChart,
  ListChecks,
  Loader2,
  LogOut,
  MessageSquare,
  Network,
  PieChart,
  Plug,
  Shield,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { trpc } from "@/lib/trpc";

type NavItem = { icon: typeof LayoutDashboard; label: string; path: string };
type NavSection = { label: string; items: NavItem[] };

/**
 * Five purposeful sections that map to the trader's journey:
 *   CORE      — daily essentials (overview, signals, positions, trades)
 *   AUTOMATE  — autonomous trading controls
 *   MARKETS   — market-intelligence tools
 *   ANALYTICS — research & post-trade analysis
 *   ACCOUNT   — setup & administration
 */
const navSections: NavSection[] = [
  {
    label: "Core",
    items: [
      { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
      { icon: TrendingUp, label: "Signals", path: "/signals" },
      { icon: ListChecks, label: "Positions", path: "/positions" },
      { icon: Activity, label: "Trades", path: "/trades" },
    ],
  },
  {
    label: "Automate",
    items: [
      { icon: Cpu, label: "Trading Autonomy", path: "/autonomy" },
      { icon: CheckCircle2, label: "Trading Readiness", path: "/trading-readiness" },
      { icon: Shield, label: "Risk Controls", path: "/risk-controls" },
    ],
  },
  {
    label: "Markets",
    items: [
      { icon: Bot, label: "Strategies", path: "/strategies" },
      { icon: Network, label: "Cluster Monitor", path: "/cluster-monitor" },
      { icon: Brain, label: "Sentiment", path: "/sentiment" },
      { icon: MessageSquare, label: "AI Bots", path: "/chat" },
    ],
  },
  {
    label: "Analytics",
    items: [
      { icon: BarChart3, label: "Performance", path: "/performance" },
      { icon: Briefcase, label: "Portfolio", path: "/portfolio" },
      { icon: LineChart, label: "Backtest", path: "/backtest" },
      { icon: PieChart, label: "Analytics", path: "/analytics" },
    ],
  },
  {
    label: "Account",
    items: [
      { icon: BookOpen, label: "Training", path: "/training" },
      { icon: Plug, label: "Connect", path: "/connect" },
      { icon: Wallet, label: "Funding", path: "/funding" },
      { icon: FileText, label: "Audit Log", path: "/audit" },
    ],
  },
];

/** Derive section + page label from the current URL path. */
function getCurrentPage(location: string): { section: string; label: string } | null {
  for (const section of navSections) {
    for (const item of section.items) {
      if (location === item.path || (item.path === "/dashboard" && location === "/")) {
        return { section: section.label, label: item.label };
      }
    }
  }
  return null;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { loading, user, logout } = useAuth();
  const [location] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async (data: any) => {
      if (data && typeof data === "object" && "requiresTwoFactor" in data && data.requiresTwoFactor) {
        setLoginError(data.message || "Two-factor authentication required");
        return;
      }
      const loggedInUser = data && typeof data === "object" && "user" in data ? data.user : data;
      utils.auth.me.setData(undefined, loggedInUser);
      setPassword("");
      setLoginError(null);
      await utils.auth.me.invalidate();
    },
    onError: (error) => setLoginError(error.message || "Unable to sign in."),
  });

  const tradingPreferencesQuery = trpc.kalshi.getTradingPreferences.useQuery(undefined, {
    enabled: Boolean(user),
  });

  const killSwitchMutation = trpc.kalshi.killSwitch.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.kalshi.getTradingPreferences.invalidate(),
        utils.kalshi.getKalshiAccountStatus.invalidate(),
        utils.kalshi.getPositions.invalidate(),
        utils.kalshi.getCapital.invalidate(),
      ]);
    },
  });

  const liveTradingArmed = tradingPreferencesQuery.data?.liveTradingEnabled ?? false;
  const currentPage = getCurrentPage(location);

  useEffect(() => {
    document.title = "Laurenzo";
  }, [user]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  const handleLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError(null);
    loginMutation.mutate({ email: email.trim(), password });
  };

  if (!user) {
    return (
      <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
        {/* Layered ambient glows */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-violet-950/20 to-slate-950" />
        <div className="absolute top-1/3 left-1/4 w-[500px] h-[500px] bg-violet-600/8 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-1/3 right-1/4 w-[400px] h-[400px] bg-indigo-600/8 rounded-full blur-[100px] pointer-events-none" />

        <form onSubmit={handleLogin} className="relative z-10 w-full max-w-sm mx-6 scale-in">
          {/* Brand */}
          <div className="flex flex-col items-center gap-3 mb-8">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-500/30 mb-1">
              <Zap className="w-7 h-7 text-white" />
            </div>
            <div className="text-4xl font-bold gradient-text tracking-tight">LAURENZO</div>
            <p className="text-sm text-muted-foreground">Prediction market intelligence</p>
          </div>

          {/* Login card */}
          <div className="laurenzo-card space-y-4">
            <div className="space-y-3">
              <Input
                autoComplete="email"
                inputMode="email"
                placeholder="Founder email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loginMutation.isPending}
              />
              <Input
                autoComplete="current-password"
                placeholder="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loginMutation.isPending}
              />
              {loginError ? <p className="text-sm text-rose-300">{loginError}</p> : null}
            </div>
            <Button
              type="submit"
              disabled={loginMutation.isPending || !email.trim() || !password}
              size="lg"
              className="w-full laurenzo-button"
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground text-center mt-5">
            Founder-only access · Kalshi &amp; Polymarket
          </p>
        </form>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <Sidebar>
        {/* ── Brand header ─────────────────────────────────────────── */}
        <SidebarHeader className="border-b border-sidebar-border">
          <div className="flex items-center gap-2.5 px-3 py-4">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 shadow-md shadow-violet-500/30 shrink-0">
              <Zap className="w-4.5 h-4.5 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-[15px] font-bold gradient-text tracking-tight leading-none">LAURENZO</span>
              <span className="text-[10px] text-muted-foreground/70 tracking-widest uppercase leading-none mt-0.5">Trading Intelligence</span>
            </div>
          </div>
        </SidebarHeader>

        {/* ── Navigation ───────────────────────────────────────────── */}
        <SidebarContent>
          {navSections.map((section) => (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => {
                    const isActive =
                      location === item.path ||
                      (item.path === "/dashboard" && location === "/");
                    return (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton asChild isActive={isActive}>
                          <Link href={item.path} className="flex items-center gap-2 cursor-pointer">
                            <item.icon className="w-4 h-4 shrink-0" />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        {/* ── User footer ──────────────────────────────────────────── */}
        <SidebarFooter className="border-t border-sidebar-border">
          {liveTradingArmed && (
            <div className="mx-2 mb-1 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/8 px-3 py-2">
              <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse shrink-0" />
              <span className="text-xs font-semibold text-red-300 tracking-wide">Live Armed</span>
            </div>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2.5 w-full p-3 rounded-lg hover:bg-sidebar-accent/20 transition-all duration-200 group">
                <Avatar className="w-8 h-8 ring-1 ring-violet-400/30 group-hover:ring-violet-400/60 transition-all shrink-0">
                  <AvatarFallback className="text-xs font-bold bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
                    {user?.name?.charAt(0).toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">{user?.name || "User"}</div>
                  <div className="text-xs text-muted-foreground truncate">{user?.email || ""}</div>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                onClick={() => logout()}
                className="flex items-center gap-2 cursor-pointer text-red-400 focus:text-red-300 focus:bg-red-500/10"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>

      {/* ── Main content ─────────────────────────────────────────── */}
      <SidebarInset>
        <header className="flex items-center justify-between h-14 px-4 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <SidebarTrigger />
            {currentPage && (
              <div className="hidden sm:flex items-center gap-1 text-sm">
                <span className="text-muted-foreground/60 text-xs font-medium uppercase tracking-wide">
                  {currentPage.section}
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />
                <span className="font-semibold text-foreground/90">{currentPage.label}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {/* Live trading status pill */}
            <div
              className={`hidden rounded-full border px-3 py-1 text-xs font-semibold sm:flex items-center gap-1.5 transition-all ${
                liveTradingArmed
                  ? "border-red-400/50 bg-red-500/10 text-red-200"
                  : "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
              }`}
            >
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  liveTradingArmed ? "bg-red-400 animate-pulse" : "bg-emerald-400"
                }`}
              />
              {liveTradingArmed ? "Live armed" : "Disarmed"}
            </div>

            {/* Kill switch */}
            {liveTradingArmed ? (
              <Button
                variant="destructive"
                size="sm"
                disabled={killSwitchMutation.isPending}
                onClick={() => {
                  const confirmed = window.confirm(
                    "Activate the Kalshi kill switch? This will disarm live trading and submit close orders for your open positions."
                  );
                  if (confirmed) killSwitchMutation.mutate();
                }}
                title="Disarm live autonomy and close all Kalshi positions."
                className="gap-1.5 h-8 text-xs"
              >
                {killSwitchMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">Kill switch</span>
              </Button>
            ) : null}
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
