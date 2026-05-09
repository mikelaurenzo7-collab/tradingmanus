import {
  Activity,
  BarChart3,
  BookOpen,
  Compass,
  Cpu,
  LayoutDashboard,
  LineChart,
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
 * Single-owner navigation: trimmed to the pages that actually move the needle
 * day-to-day.  Every removed item still resolves as a deep link (the routes
 * are still wired in App.tsx) — only the sidebar surface shrinks.
 *
 * Removed from sidebar (still routable):
 *   - Chat (talk to desk AI)         · low utility for sole owner
 *   - Strategies (user-defined)      · folded conceptually into Autonomy
 *   - Sentiment (multi-source)       · Claude already factors this in review
 *   - Markets / Analytics            · Claude already factors microstructure
 *   - Portfolio (Kelly / MV)         · Kelly is automatic in autonomy
 *
 * Kept:
 *   - Setup, Dashboard               · onboarding + home
 *   - Signals, Activity              · daily trade surface
 *   - Performance, Backtesting       · "is it making money?" + tuning
 *   - Autonomy, Risk Controls,
 *     Training                       · the dials you'll touch most
 *   - Connect                        · Kalshi creds
 */
export const navSections: NavSection[] = [
  {
    label: "Start",
    items: [
      { icon: Compass, label: "Setup", path: "/setup", hint: "Connect Kalshi, fund, arm autonomy" },
      { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard", hint: "Home + key metrics across both platforms" },
    ],
  },
  {
    label: "Trade",
    items: [
      { icon: Zap, label: "Signals", path: "/signals", hint: "Latest reviewed signals (Kalshi)" },
      { icon: Activity, label: "Activity", path: "/activity", hint: "Open positions + trade history" },
    ],
  },
  {
    label: "Analyze",
    items: [
      { icon: BarChart3, label: "Performance", path: "/performance", hint: "P&L and risk-adjusted metrics" },
      { icon: LineChart, label: "Backtesting", path: "/backtest", hint: "Historical exit-strategy simulation" },
    ],
  },
  {
    label: "Configure",
    items: [
      { icon: Cpu, label: "Autonomy", path: "/autonomy", hint: "Mode + sizing + cadence" },
      { icon: Shield, label: "Risk Controls", path: "/risk-controls", hint: "Guardrails and drawdown breakers" },
      { icon: BookOpen, label: "Training", path: "/training", hint: "Custom rules and filters" },
    ],
  },
  {
    label: "Account",
    items: [
      { icon: Plug, label: "Connect", path: "/connect", hint: "Kalshi API credentials" },
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
