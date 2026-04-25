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
import { LayoutDashboard, LogOut, TrendingUp, Shield, FileText, Plug, BookOpen, BarChart3, Brain, Briefcase, LineChart, SlidersHorizontal, AlertTriangle, Loader2, ListChecks, Wallet, Activity } from "lucide-react";
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
      { icon: ListChecks, label: "Positions", path: "/positions" },
      { icon: Activity, label: "Trades", path: "/trades" },
    ],
  },
  {
    label: "Strategy",
    items: [
      { icon: SlidersHorizontal, label: "Trading Autonomy", path: "/autonomy" },
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
      { icon: Plug, label: "Connect Kalshi", path: "/connect" },
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
    onSuccess: async (loggedInUser) => {
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
              Kalshi Trading
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Founder-only sign-in for OpenAI + Claude-reviewed Kalshi signals, live execution controls, and the audit trail.
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
            After signing in, connect Kalshi and set Trading Autonomy before arming live trading.
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
        <SidebarHeader className="border-b border-sidebar-border">
          <div className="flex items-center gap-2 px-2 py-4">
            <div className="text-2xl font-bold gradient-text">LAURENZO</div>
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
                          <Link href={item.path} className="flex items-center gap-2">
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
        <SidebarFooter className="border-t border-sidebar-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 w-full p-2 rounded-lg hover:bg-sidebar-accent/20 transition-colors">
                <Avatar className="w-8 h-8">
                  <AvatarFallback className="text-xs font-bold">
                    {user?.name?.charAt(0).toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left">
                  <div className="text-sm font-semibold">{user?.name || "User"}</div>
                  <div className="text-xs text-muted-foreground">{user?.email || "user@example.com"}</div>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => logout()}
                className="flex items-center gap-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex items-center justify-between h-16 px-6 border-b border-border bg-background/50 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
          </div>
          <div className="flex items-center gap-3">
            <div className={`hidden rounded-full border px-3 py-1 text-xs font-semibold sm:block ${liveTradingArmed ? "border-red-400/50 bg-red-500/10 text-red-200" : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"}`}>
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
              >
                {killSwitchMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
                Kill switch
              </Button>
            ) : null}
            <div className="hidden text-sm text-muted-foreground md:block">
              Laurenzo Trading Dashboard
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
