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
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  ChevronDown,
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
  User,
  Wallet,
  Zap,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { CommandPalette } from "./CommandPalette";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { trpc } from "@/lib/trpc";
import { ThemeToggle } from "./ThemeToggle";

type NavItem = { icon: typeof LayoutDashboard; label: string; path: string };
type CollapsibleGroup = { 
  label: string; 
  icon: typeof LayoutDashboard; 
  items: NavItem[];
};

/**
 * Tier 1: MAIN NAV — Always visible primary navigation (non-collapsible)
 */
const mainNavItems: NavItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: MessageSquare, label: "Chat", path: "/chat" },
];

/**
 * Tier 2: COLLAPSIBLE SECTIONS — Organized by domain for cleaner hierarchy
 */
const collapsibleGroups: CollapsibleGroup[] = [
  {
    label: "Trading",
    icon: TrendingUp,
    items: [
      { icon: Zap, label: "Signals", path: "/signals" },
      { icon: ListChecks, label: "Positions", path: "/positions" },
      { icon: Activity, label: "Trades", path: "/trades" },
      { icon: Bot, label: "Strategies", path: "/strategies" },
    ],
  },
  {
    label: "Risk & Controls",
    icon: Shield,
    items: [
      { icon: Shield, label: "Risk Controls", path: "/risk-controls" },
      { icon: Cpu, label: "Trading Autonomy", path: "/autonomy" },
      { icon: BookOpen, label: "Training", path: "/training" },
      { icon: FileText, label: "Audit Log", path: "/audit" },
    ],
  },
  {
    label: "Analytics",
    icon: BarChart3,
    items: [
      { icon: BarChart3, label: "Performance", path: "/performance" },
      { icon: PieChart, label: "Analytics", path: "/analytics" },
      { icon: Brain, label: "Sentiment", path: "/sentiment" },
      { icon: Network, label: "Cluster Monitor", path: "/cluster-monitor" },
      { icon: LineChart, label: "Backtesting", path: "/backtest" },
      { icon: Briefcase, label: "Portfolio Optimization", path: "/portfolio" },
    ],
  },
  {
    label: "Account",
    icon: User,
    items: [
      { icon: Plug, label: "Connect", path: "/connect" },
      { icon: Wallet, label: "Funding", path: "/funding" },
      { icon: CheckCircle2, label: "Trading Readiness", path: "/trading-readiness" },
    ],
  },
];

/** Derive section + page label from the current URL path. */
function getCurrentPage(location: string): { section: string; label: string } | null {
  // Check main nav items
  for (const item of mainNavItems) {
    if (location === item.path || (item.path === "/dashboard" && location === "/")) {
      return { section: "Main", label: item.label };
    }
  }
  // Check collapsible groups
  for (const group of collapsibleGroups) {
    for (const item of group.items) {
      if (location === item.path) {
        return { section: group.label, label: item.label };
      }
    }
  }
  return null;
}

/**
 * Collapsible navigation group with localStorage persistence.
 * Auto-opens if any child route is active.
 */
function CollapsibleNavGroup({
  group,
  location,
}: {
  group: CollapsibleGroup;
  location: string;
}) {
  const storageKey = `laurenzo-nav-${group.label}`;
  const isGroupActive = group.items.some((item) => location === item.path);

  // Initialize: open if active route is inside, otherwise check localStorage
  const [open, setOpen] = useState(() => {
    if (isGroupActive) return true;
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : false;
    } catch {
      return false;
    }
  });

  // Auto-open when route becomes active
  useEffect(() => {
    if (isGroupActive && !open) {
      setOpen(true);
    }
  }, [isGroupActive, open]);

  // Persist state to localStorage
  const handleToggle = (newOpen: boolean) => {
    setOpen(newOpen);
    try {
      localStorage.setItem(storageKey, JSON.stringify(newOpen));
    } catch {
      // Ignore storage errors
    }
  };

  return (
    <Collapsible open={open} onOpenChange={handleToggle}>
      <SidebarGroup>
        <CollapsibleTrigger className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 hover:text-muted-foreground transition-colors rounded-md hover:bg-sidebar-accent/10 cursor-pointer">
          <div className="flex items-center gap-2">
            <group.icon className="w-3.5 h-3.5" />
            <span>{group.label}</span>
          </div>
          <ChevronDown
            className={`w-3 h-3 transition-transform duration-200 ${
              open ? "rotate-0" : "-rotate-90"
            }`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="transition-all duration-200">
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const isActive = location === item.path;
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link
                        href={item.path}
                        className={`flex items-center gap-2 cursor-pointer transition-colors duration-200 text-sm ${
                          isActive
                            ? "border-l-2 border-primary bg-primary/10 glow-primary"
                            : ""
                        }`}
                      >
                        <item.icon className="w-4 h-4 shrink-0" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
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
      <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-violet-950/30 to-slate-950">
        {/* Animated gradient mesh background */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-violet-600/20 via-transparent to-transparent" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-fuchsia-600/15 via-transparent to-transparent" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-600/10 via-transparent to-transparent" />
        </div>

        {/* Floating particles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-violet-500/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '0s', animationDuration: '8s' }} />
          <div className="absolute top-2/3 right-1/4 w-96 h-96 bg-fuchsia-500/8 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s', animationDuration: '10s' }} />
          <div className="absolute bottom-1/4 left-1/3 w-64 h-64 bg-cyan-500/8 rounded-full blur-3xl animate-float" style={{ animationDelay: '4s', animationDuration: '12s' }} />
          <div className="absolute top-1/2 right-1/3 w-48 h-48 bg-indigo-500/12 rounded-full blur-2xl animate-float" style={{ animationDelay: '1s', animationDuration: '9s' }} />
        </div>

        {/* Subtle geometric shapes */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-30">
          <div className="absolute top-20 left-12 w-32 h-32 border border-violet-500/20 rounded-2xl rotate-12 animate-pulse" style={{ animationDuration: '4s' }} />
          <div className="absolute bottom-32 right-20 w-24 h-24 border border-fuchsia-500/20 rounded-xl -rotate-12 animate-pulse" style={{ animationDuration: '5s' }} />
        </div>

        <form onSubmit={handleLogin} className="relative z-10 w-full max-w-md mx-6 scale-in">
          {/* Brand */}
          <div className="flex flex-col items-center gap-3 mb-10">
            <div className="flex items-center justify-center w-16 h-16 rounded-3xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-indigo-600 shadow-2xl shadow-violet-500/40 mb-2 animate-pulse-glow">
              <Zap className="w-8 h-8 text-white" />
            </div>
            <div className="text-5xl font-bold gradient-text tracking-tight heading-tight">LAURENZO</div>
            <p className="text-sm text-muted-foreground/80 tracking-wide">Prediction Market Intelligence</p>
          </div>

          {/* Premium glassmorphism login card */}
          <div className="group relative">
            {/* Animated glow effect */}
            <div className="absolute -inset-1 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-indigo-600 rounded-3xl blur-xl opacity-40 group-hover:opacity-60 transition-opacity duration-1000 animate-pulse-glow" />
            
            <div className="relative laurenzo-card space-y-5 p-8">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground/80 uppercase tracking-wider">Email</label>
                  <Input
                    autoComplete="email"
                    inputMode="email"
                    placeholder="founder@laurenzo.ai"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loginMutation.isPending}
                    className="h-12 text-base font-medium transition-all duration-300 focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/60 focus:shadow-lg focus:shadow-violet-500/20"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground/80 uppercase tracking-wider">Password</label>
                  <Input
                    autoComplete="current-password"
                    placeholder="••••••••••••"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loginMutation.isPending}
                    className="h-12 text-base font-medium transition-all duration-300 focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/60 focus:shadow-lg focus:shadow-violet-500/20"
                  />
                </div>
                {loginError ? (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 animate-shake-subtle">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <p className="text-sm text-rose-300 font-medium">{loginError}</p>
                  </div>
                ) : null}
              </div>
              <Button
                type="submit"
                disabled={loginMutation.isPending || !email.trim() || !password}
                size="lg"
                className="w-full h-12 laurenzo-button text-base font-bold tracking-wide"
              >
                {loginMutation.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Signing in…
                  </>
                ) : (
                  <>
                    <span>Sign in</span>
                    <ChevronRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 mt-8 text-xs text-muted-foreground/60">
            <Shield className="w-3.5 h-3.5" />
            <span>Founder-only access · Kalshi &amp; Polymarket</span>
          </div>
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
              <span className="text-[10px] text-muted-foreground/70 tracking-widest uppercase leading-none mt-0.5">Market Intelligence</span>
            </div>
          </div>
        </SidebarHeader>

        {/* ── Navigation ───────────────────────────────────────────── */}
        <SidebarContent>
          {/* Tier 1: Main Navigation */}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {mainNavItems.map((item) => {
                  const isActive =
                    location === item.path ||
                    (item.path === "/dashboard" && location === "/");
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton asChild isActive={isActive}>
                        <Link
                          href={item.path}
                          className={`flex items-center gap-2.5 cursor-pointer transition-colors duration-200 font-semibold ${
                            isActive
                              ? "border-l-2 border-primary bg-primary/10 glow-primary"
                              : ""
                          }`}
                        >
                          <item.icon className="w-4.5 h-4.5 shrink-0" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Tier 2: Collapsible Groups */}
          {collapsibleGroups.map((group) => {
            return (
              <CollapsibleNavGroup
                key={group.label}
                group={group}
                location={location}
              />
            );
          })}
        </SidebarContent>

        {/* ── User footer ──────────────────────────────────────────── */}
        <SidebarFooter className="border-t border-sidebar-border">
          {/* Command palette hint + theme toggle */}
          <div className="mx-2 my-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
              <span>Quick search</span>
              <kbd className="inline-flex h-5 items-center gap-0.5 rounded border border-border/40 bg-muted/30 px-1.5 font-mono text-[10px] font-medium">
                <span className="text-[9px]">⌘</span>K
              </kbd>
            </div>
            <ThemeToggle />
          </div>
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
      <CommandPalette />
      <KeyboardShortcuts />
    </SidebarProvider>
  );
}
