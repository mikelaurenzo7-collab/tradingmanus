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
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { LayoutDashboard, LogOut, TrendingUp, Shield, FileText, Plug, BookOpen, BarChart3, Brain, Briefcase, LineChart, SlidersHorizontal, AlertTriangle, Loader2 } from "lucide-react";
import { CSSProperties, useEffect, useState } from "react";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";
import { trpc } from "@/lib/trpc";

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: Plug, label: "Connect Kalshi", path: "/connect" },
  { icon: SlidersHorizontal, label: "Trading Autonomy", path: "/autonomy" },
  { icon: TrendingUp, label: "Signals", path: "/signals" },
  { icon: LayoutDashboard, label: "Positions", path: "/positions" },
  { icon: LayoutDashboard, label: "Trades", path: "/trades" },
  { icon: BarChart3, label: "Performance", path: "/performance" },
  { icon: Brain, label: "Sentiment", path: "/sentiment" },
  { icon: Briefcase, label: "Portfolio", path: "/portfolio" },
  { icon: LineChart, label: "Backtest", path: "/backtest" },
  { icon: BarChart3, label: "Analytics", path: "/analytics" },
  { icon: BookOpen, label: "Training", path: "/training" },
  { icon: Shield, label: "Risk Controls", path: "/risk-controls" },
  { icon: FileText, label: "Audit Log", path: "/audit" },
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
  const loginUrl = getLoginUrl();
  const utils = trpc.useUtils();
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

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full scale-in">
          <div className="flex flex-col items-center gap-6">
            <div className="text-6xl font-bold gradient-text">LAURENZO</div>
            <h1 className="text-3xl font-bold tracking-tight text-center gradient-text">
              Kalshi Trading
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Sign in to access your Kalshi trading dashboard, live signals, and risk controls.
            </p>
          </div>
          <Button
            onClick={() => {
              if (loginUrl) {
                window.location.href = loginUrl;
              }
            }}
            disabled={!loginUrl}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all laurenzo-button"
          >
            {loginUrl ? "Sign in" : "Sign-in not configured"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            {loginUrl
              ? "After signing in: Connect your Kalshi API key to start trading"
              : "Set VITE_OAUTH_PORTAL_URL and VITE_APP_ID to enable sign-in for this preview."}
          </p>
        </div>
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
          <SidebarMenu>
            {menuItems.map((item) => (
              <SidebarMenuItem key={item.path}>
                <SidebarMenuButton asChild>
                  <a href={item.path} className="flex items-center gap-2">
                    <item.icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
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
