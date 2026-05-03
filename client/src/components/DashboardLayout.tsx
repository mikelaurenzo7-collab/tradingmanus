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
import { LayoutDashboard, LogOut, TrendingUp, Shield, FileText, Plug, BookOpen, BarChart3, Brain, Briefcase, LineChart, SlidersHorizontal, AlertTriangle, Loader2, ListChecks, Wallet, Activity, Network, Bot, MessageSquare, CheckCircle2, Zap } from "lucide-react";
import { CSSProperties, FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { trpc } from "@/lib/trpc";

type NavItem = { icon: typeof LayoutDashboard; label: string; path: string };

const navSections: { label: string; items: NavItem[] }[] = [
  {
    label: "Trade",
    items: [
      { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
      { icon: TrendingUp, label: "Signals", path: "/signals" },
      { icon: Network, label: "Cluster Monitor", path: "/cluster-monitor" },
      { icon: Bot, label: "Strategies", path: "/strategies" },
      { icon: ListChecks, label: "Positions", path: "/positions" },
      { icon: Activity, label: "Trades", path: "/trades" },
      { icon: MessageSquare, label: "AI Bots", path: "/chat" },
    ],
  },
  {
    label: "Strategy",
    items: [
      { icon: SlidersHorizontal, label: "Trading Autonomy", path: "/autonomy" },
      { icon: CheckCircle2, label: "Trading Readiness", path: "/trading-readiness" },
      { icon: Shield, label: "Risk Controls", path: "/risk-controls" },
      { icon: BookOpen, label: "Training", path: "/training" },
    ],
  },
  {
    label: "Insight",
    items: [
      { icon: BarChart3, label: "Performance", path: "/performance" },
      { icon: Brain, label: "Sentiment", path: "/sentiment" },
      { icon: Briefcase, label: "Portfolio", path: "/portfolio" },
      { icon: LineChart, label: "Backtest", path: "/backtest" },
      { icon: BarChart3, label: "Analytics", path: "/analytics" },
      { icon: FileText, label: "Audit Log", path: "/audit" },
    ],
  },
  {
    label: "Account",
    items: [
      { icon: Plug, label: "Connect Platforms", path: "/connect" },
      { icon: Wallet, label: "Funding", path: "/funding" },
    ],
  },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user, logout } = useAuth();
  const [location] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async (data: any) => {
      if (data && typeof data === 'object' && 'requiresTwoFactor' in data && data.requiresTwoFactor) {
        // Handle 2FA requirement
        setLoginError(data.message || 'Two-factor authentication required');
        return;
      }
      const loggedInUser = data && typeof data === 'object' && 'user' in data ? data.user : data;
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

  useEffect(() => {
    document.title = "Laurenzo";
  }, [user]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />
  }

  const handleLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError(null);
    loginMutation.mutate({ email: email.trim(), password });
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <form onSubmit={handleLogin} className="flex flex-col items-center gap-8 p-8 max-w-md w-full scale-in">
          <div className="flex flex-col items-center gap-6">
            <div className="text-6xl font-bold gradient-text">LAURENZO</div>
            <h1 className="text-3xl font-bold tracking-tight text-center gradient-text">
              Prediction Market Trading
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Founder-only sign-in for AI-reviewed signals and live execution on Kalshi and Polymarket.
            </p>
          </div>
          <div className="w-full space-y-3">
            <Input
              autoComplete="email"
              inputMode="email"
              placeholder="Founder email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={loginMutation.isPending}
            />
            <Input
              autoComplete="current-password"
              placeholder="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={loginMutation.isPending}
            />
            {loginError ? <p className="text-sm text-rose-300">{loginError}</p> : null}
          </div>
          <Button
            type="submit"
            disabled={loginMutation.isPending || !email.trim() || !password}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all laurenzo-button"
          >
            {loginMutation.isPending ? "Signing in..." : "Sign in"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            After signing in, connect Kalshi and/or Polymarket and set Trading Autonomy before arming live trading.
          </p>
        </form>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <Sidebar>
        <SidebarHeader className="border-b border-sidebar-border bg-gradient-to-br from-violet-900/10 to-transparent">
          <div className="flex items-center gap-2 px-2 py-4">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 shadow-md shadow-violet-500/30">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div className="text-2xl font-bold gradient-text tracking-tight">LAURENZO</div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          {navSections.map((section) => (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => {
                    const isActive = location === item.path || (item.path === "/dashboard" && location === "/");
                    return (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton asChild isActive={isActive}>
                          <Link href={item.path} className="flex items-center gap-2 cursor-pointer">
                            <item.icon className="w-4 h-4" />
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
        <SidebarFooter className="border-t border-sidebar-border bg-gradient-to-br from-transparent to-violet-900/10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 w-full p-3 rounded-lg hover:bg-sidebar-accent/30 transition-all duration-200 group">
                <Avatar className="w-9 h-9 ring-2 ring-violet-400/30 group-hover:ring-violet-400/50 transition-all">
                  <AvatarFallback className="text-xs font-bold bg-gradient-to-br from-violet-500 to-indigo-500 text-white">
                    {user?.name?.charAt(0).toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left">
                  <div className="text-sm font-semibold text-foreground">{user?.name || "User"}</div>
                  <div className="text-xs text-muted-foreground truncate max-w-[160px]">{user?.email || "user@example.com"}</div>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
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
      <SidebarInset>
        <header className="flex items-center justify-between h-16 px-6 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-10 shadow-sm">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
          </div>
          <div className="flex items-center gap-3">
            <div className={`hidden rounded-full border px-3 py-1.5 text-xs font-semibold sm:flex items-center gap-1.5 transition-all ${liveTradingArmed ? "border-red-400/50 bg-red-500/10 text-red-200 shadow-sm shadow-red-500/20" : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"}`}>
              <div className={`w-2 h-2 rounded-full ${liveTradingArmed ? "bg-red-400 animate-pulse" : "bg-emerald-400"}`} />
              {liveTradingArmed ? "Live trading armed" : "Live trading disarmed"}
            </div>
            {liveTradingArmed ? (
              <Button
                variant="destructive"
                size="sm"
                disabled={killSwitchMutation.isPending}
                onClick={() => {
                  const confirmed = window.confirm(
                    "Activate the Kalshi kill switch? This will disarm live trading and submit close orders for your open positions."
                  );
                  if (confirmed) {
                    killSwitchMutation.mutate();
                  }
                }}
                title="Cancel live autonomy and submit close orders for open Kalshi positions."
                className="gap-2 shadow-sm hover:shadow-md transition-all"
              >
                {killSwitchMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">Kill switch</span>
              </Button>
            ) : null}
            <div className="hidden text-sm text-muted-foreground md:flex items-center gap-2">
              <Activity className="w-4 h-4 text-violet-400" />
              <span>Laurenzo Trading — Kalshi &amp; Polymarket</span>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6 bg-gradient-to-br from-transparent via-transparent to-violet-900/5">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
