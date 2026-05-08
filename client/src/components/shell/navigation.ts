import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  Brain,
  Briefcase,
  Compass,
  Cpu,
  LayoutDashboard,
  LineChart,
  MessageSquare,
  PieChart,
  Plug,
  Shield,
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
 * Action-oriented navigation: section labels are verbs (START / TRADE /
 * ANALYZE / CONFIGURE), so users see *what they can do* rather than
 * *where things are filed*.
 *
 * Consolidation pass:
 *   - Positions + Trades → single "Activity" page (tabs: Open / History).
 *   - Audit Log moved to a topbar-accessible drawer, not a sidebar item.
 *   - Funding folded into Dashboard cards.
 *   - Trading Readiness folded into Setup as step 4.
 *   - All removed routes still resolve as deep links — only the sidebar
 *     surface shrinks, no functionality is lost.
 */
export const navSections: NavSection[] = [
  {
    label: "Start",
    items: [
      { icon: Compass, label: "Setup", path: "/setup", hint: "Get to live trading in 4 steps" },
      { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard", hint: "Home + key metrics" },
      { icon: MessageSquare, label: "Chat", path: "/chat", hint: "Talk to the desk AI" },
    ],
  },
  {
    label: "Trade",
    items: [
      { icon: Zap, label: "Signals", path: "/signals", hint: "Latest reviewed signals" },
      { icon: Activity, label: "Activity", path: "/activity", hint: "Open positions + trade history" },
    ],
  },
  {
    label: "Analyze",
    items: [
      { icon: BarChart3, label: "Performance", path: "/performance", hint: "P&L and risk-adjusted metrics" },
      { icon: PieChart, label: "Markets", path: "/analytics", hint: "Liquidity and microstructure" },
      { icon: Brain, label: "Sentiment", path: "/sentiment", hint: "Multi-source sentiment" },
      { icon: LineChart, label: "Backtesting", path: "/backtest", hint: "Historical simulation" },
      { icon: Briefcase, label: "Portfolio", path: "/portfolio", hint: "Kelly / mean-variance" },
    ],
  },
  {
    label: "Configure",
    items: [
      { icon: Cpu, label: "Autonomy", path: "/autonomy", hint: "Mode + sizing + cadence" },
      { icon: Bot, label: "Strategies", path: "/strategies", hint: "User-defined strategies" },
      { icon: BookOpen, label: "Training", path: "/training", hint: "Custom rules and filters" },
      { icon: Shield, label: "Risk Controls", path: "/risk-controls", hint: "Guardrails and alerts" },
    ],
  },
  {
    label: "Account",
    items: [
      { icon: Plug, label: "Connect", path: "/connect", hint: "Exchange API credentials" },
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
