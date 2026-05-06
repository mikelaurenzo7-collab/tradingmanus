import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  CheckCircle2,
  Cpu,
  FileText,
  LayoutDashboard,
  LineChart,
  ListChecks,
  MessageSquare,
  Network,
  PieChart,
  Plug,
  Shield,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";

export type NavItem = {
  icon: typeof LayoutDashboard;
  label: string;
  path: string;
  /** Optional short description used by the command palette / tooltips */
  hint?: string;
};

export type NavSection = {
  /** Uppercase section heading shown in the sidebar */
  label: string;
  items: NavItem[];
};

/**
 * Flat, grouped navigation. Replaces the previous 4-level dropdown structure.
 * Designed for a vertical sidebar with at-a-glance access to every page.
 */
export const navSections: NavSection[] = [
  {
    label: "Overview",
    items: [
      { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard", hint: "Home + key metrics" },
      { icon: MessageSquare, label: "Chat", path: "/chat", hint: "Talk to the desk AI" },
    ],
  },
  {
    label: "Trading",
    items: [
      { icon: Zap, label: "Signals", path: "/signals", hint: "Latest reviewed signals" },
      { icon: ListChecks, label: "Positions", path: "/positions", hint: "Open positions" },
      { icon: Activity, label: "Trades", path: "/trades", hint: "Trade history" },
      { icon: Bot, label: "Strategies", path: "/strategies", hint: "User-defined strategies" },
    ],
  },
  {
    label: "Analytics",
    items: [
      { icon: BarChart3, label: "Performance", path: "/performance", hint: "PnL and risk-adjusted metrics" },
      { icon: PieChart, label: "Markets", path: "/analytics", hint: "Liquidity and microstructure" },
      { icon: Brain, label: "Sentiment", path: "/sentiment", hint: "Multi-source sentiment" },
      { icon: Network, label: "Cluster Monitor", path: "/cluster-monitor", hint: "Wash-trade detection" },
      { icon: LineChart, label: "Backtesting", path: "/backtest", hint: "Historical simulation" },
      { icon: Briefcase, label: "Portfolio", path: "/portfolio", hint: "Kelly / mean-variance" },
    ],
  },
  {
    label: "Control",
    items: [
      { icon: Cpu, label: "Autonomy", path: "/autonomy", hint: "Autonomy mode + thresholds" },
      { icon: Shield, label: "Risk Controls", path: "/risk-controls", hint: "Guardrails and alerts" },
      { icon: BookOpen, label: "Training", path: "/training", hint: "Custom rules and filters" },
      { icon: FileText, label: "Audit Log", path: "/audit", hint: "Immutable event ledger" },
    ],
  },
  {
    label: "Account",
    items: [
      { icon: Plug, label: "Connect", path: "/connect", hint: "Exchange API credentials" },
      { icon: Wallet, label: "Funding", path: "/funding", hint: "Deposit and withdraw" },
      { icon: CheckCircle2, label: "Readiness", path: "/trading-readiness", hint: "Pre-live checklist" },
    ],
  },
];

/** Flat list of every nav item — convenient for command palette / breadcrumbs */
export const allNavItems: NavItem[] = navSections.flatMap((section) => section.items);

/** Resolve a route to its NavItem (and the section it lives in) */
export function findNavMatch(path: string): { section: NavSection; item: NavItem } | null {
  const normalized = path === "/" ? "/dashboard" : path;
  for (const section of navSections) {
    for (const item of section.items) {
      if (item.path === normalized) return { section, item };
    }
  }
  return null;
}

/** Friendly label for the current path */
export function getPageLabel(path: string): string {
  return findNavMatch(path)?.item.label ?? "Laurenzo";
}
