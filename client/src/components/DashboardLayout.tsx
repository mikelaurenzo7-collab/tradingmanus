import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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
  DollarSign,
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
  Menu,
  X,
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
type NavGroup = { 
  label: string; 
  icon: typeof LayoutDashboard; 
  items: NavItem[];
};

/**
 * Navigation structure for horizontal top nav with dropdowns
 */
const navigationGroups: NavGroup[] = [
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

/** Derive current page label from the current URL path */
function getCurrentPageLabel(location: string): string | null {
  if (location === "/" || location === "/dashboard") return "Dashboard";
  if (location === "/chat") return "Chat";
  
  for (const group of navigationGroups) {
    for (const item of group.items) {
      if (location === item.path) {
        return item.label;
      }
    }
  }
  return null;
}

/** Check if a nav group has an active route */
function isGroupActive(group: NavGroup, location: string): boolean {
  return group.items.some((item) => location === item.path);
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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

  const accountStatusQuery = trpc.kalshi.getKalshiAccountStatus.useQuery(undefined, {
    enabled: Boolean(user),
    refetchInterval: 30000, // Refresh every 30 seconds
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
  const accountStatus = accountStatusQuery.data;
  const equity = accountStatus?.equity || 0;
  const currentPageLabel = getCurrentPageLabel(location);

  useEffect(() => {
    document.title = "Laurenzo · Financial Command Center";
  }, [user]);

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location]);

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
            <p className="text-sm text-muted-foreground/80 tracking-wide">Financial Command Center</p>
          </div>

          {/* Premium glassmorphism login card */}
          <div className="group relative">
            {/* Animated glow effect */}
            <div className="absolute -inset-1 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-indigo-600 rounded-3xl blur-xl opacity-40 group-hover:opacity-60 transition-opacity duration-1000 animate-pulse-glow" />
            
            <div className="relative glass-panel rounded-3xl space-y-5 p-8">
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
                    className="h-12 text-base font-medium transition-all duration-300"
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
                    className="h-12 text-base font-medium transition-all duration-300"
                  />
                </div>
                {loginError ? (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
                    <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                    <p className="text-sm text-destructive-foreground font-medium">{loginError}</p>
                  </div>
                ) : null}
              </div>
              <Button
                type="submit"
                disabled={loginMutation.isPending || !email.trim() || !password}
                size="lg"
                className="w-full h-12 bg-gradient-to-r from-primary via-accent to-primary bg-[length:200%_auto] hover:bg-[position:100%_center] transition-all duration-500 text-base font-bold tracking-wide"
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
            <span>Founder-only access · Kalshi & Polymarket</span>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation Bar */}
      <nav className="glass-panel sticky top-0 z-50 border-b border-border/50">
        <div className="px-4 lg:px-6">
          <div className="flex items-center justify-between h-16">
            {/* Brand */}
            <Link href="/dashboard" className="flex items-center gap-2.5 shrink-0">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-primary via-accent to-primary shadow-lg">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <div className="hidden sm:flex flex-col">
                <span className="text-lg font-bold text-gradient leading-none">LAURENZO</span>
                <span className="text-[10px] text-muted-foreground tracking-widest uppercase leading-none">Command Center</span>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center gap-1">
              <Link href="/dashboard">
                <Button
                  variant={location === "/" || location === "/dashboard" ? "secondary" : "ghost"}
                  size="sm"
                  className="gap-2"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Dashboard
                </Button>
              </Link>
              <Link href="/chat">
                <Button
                  variant={location === "/chat" ? "secondary" : "ghost"}
                  size="sm"
                  className="gap-2"
                >
                  <MessageSquare className="w-4 h-4" />
                  Chat
                </Button>
              </Link>

              {/* Navigation Dropdowns */}
              {navigationGroups.map((group) => {
                const Icon = group.icon;
                const isActive = isGroupActive(group, location);
                
                return (
                  <DropdownMenu key={group.label}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant={isActive ? "secondary" : "ghost"}
                        size="sm"
                        className="gap-2"
                      >
                        <Icon className="w-4 h-4" />
                        {group.label}
                        <ChevronDown className="w-3 h-3 ml-auto" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                      {group.items.map((item) => {
                        const ItemIcon = item.icon;
                        const isItemActive = location === item.path;
                        
                        return (
                          <Link key={item.path} href={item.path}>
                            <DropdownMenuItem
                              className={`cursor-pointer ${isItemActive ? "bg-accent" : ""}`}
                            >
                              <ItemIcon className="w-4 h-4 mr-2" />
                              {item.label}
                            </DropdownMenuItem>
                          </Link>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })}
            </div>

            {/* Right Side Actions */}
            <div className="flex items-center gap-2">
              {/* Status Indicators (Desktop) */}
              <div className="hidden md:flex items-center gap-2">
                {liveTradingArmed && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-destructive/10 border border-destructive/30">
                    <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                    <span className="text-xs font-semibold text-destructive-foreground">Live Armed</span>
                  </div>
                )}
                {liveTradingArmed && (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={killSwitchMutation.isPending}
                    onClick={() => {
                      const confirmed = window.confirm(
                        "Activate kill switch? This will disarm live trading and submit close orders for all positions."
                      );
                      if (confirmed) killSwitchMutation.mutate();
                    }}
                    className="gap-1.5"
                  >
                    {killSwitchMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    )}
                    Kill Switch
                  </Button>
                )}
              </div>

              <ThemeToggle />
              
              {/* User Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent transition-colors">
                    <Avatar className="w-8 h-8 ring-2 ring-primary/30">
                      <AvatarFallback className="text-xs font-bold bg-gradient-to-br from-primary to-accent text-white">
                        {user?.name?.charAt(0).toUpperCase() || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="hidden lg:flex flex-col items-start">
                      <span className="text-sm font-semibold leading-none">{user?.name || "User"}</span>
                      <span className="text-xs text-muted-foreground leading-none mt-0.5">Founder</span>
                    </div>
                    <ChevronDown className="hidden lg:block w-3 h-3 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <div className="px-3 py-2 border-b border-border">
                    <p className="text-sm font-semibold">{user?.name || "User"}</p>
                    <p className="text-xs text-muted-foreground truncate">{user?.email || ""}</p>
                  </div>
                  <DropdownMenuItem
                    onClick={() => logout()}
                    className="flex items-center gap-2 cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Mobile Menu Toggle */}
              <Button
                variant="ghost"
                size="sm"
                className="lg:hidden"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-border/50 bg-card/95 backdrop-blur-xl">
            <div className="px-4 py-4 space-y-2 max-h-[calc(100vh-4rem)] overflow-y-auto">
              <Link href="/dashboard">
                <Button
                  variant={location === "/" || location === "/dashboard" ? "secondary" : "ghost"}
                  size="sm"
                  className="w-full justify-start gap-2"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Dashboard
                </Button>
              </Link>
              <Link href="/chat">
                <Button
                  variant={location === "/chat" ? "secondary" : "ghost"}
                  size="sm"
                  className="w-full justify-start gap-2"
                >
                  <MessageSquare className="w-4 h-4" />
                  Chat
                </Button>
              </Link>

              {navigationGroups.map((group) => {
                const Icon = group.icon;
                
                return (
                  <div key={group.label} className="space-y-1">
                    <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                      <Icon className="w-3 h-3" />
                      {group.label}
                    </div>
                    {group.items.map((item) => {
                      const ItemIcon = item.icon;
                      const isItemActive = location === item.path;
                      
                      return (
                        <Link key={item.path} href={item.path}>
                          <Button
                            variant={isItemActive ? "secondary" : "ghost"}
                            size="sm"
                            className="w-full justify-start gap-2 pl-6"
                          >
                            <ItemIcon className="w-4 h-4" />
                            {item.label}
                          </Button>
                        </Link>
                      );
                    })}
                  </div>
                );
              })}

              {liveTradingArmed && (
                <div className="pt-3 border-t border-border mt-3">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={killSwitchMutation.isPending}
                    onClick={() => {
                      const confirmed = window.confirm(
                        "Activate kill switch? This will disarm live trading and submit close orders for all positions."
                      );
                      if (confirmed) killSwitchMutation.mutate();
                    }}
                    className="w-full gap-2"
                  >
                    {killSwitchMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <AlertTriangle className="h-4 w-4" />
                    )}
                    Kill Switch
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* Status Bar - Key Metrics */}
      {user && accountStatus && (
        <div className="glass-panel border-b border-border/50 px-4 lg:px-6 py-2">
          <div className="flex items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-6 overflow-x-auto">
              <div className="flex items-center gap-2 whitespace-nowrap">
                <DollarSign className="w-3.5 h-3.5 text-primary" />
                <span className="text-muted-foreground">Balance:</span>
                <span className="font-bold text-foreground tabular-nums">${equity.toFixed(2)}</span>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted/50">
              <div className={`w-1.5 h-1.5 rounded-full ${liveTradingArmed ? 'bg-destructive animate-pulse' : 'bg-success'}`} />
              <span className="font-semibold">{liveTradingArmed ? 'Armed' : 'Disarmed'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="p-4 lg:p-6">
        {children}
      </main>

      <CommandPalette />
      <KeyboardShortcuts />
    </div>
  );
}
