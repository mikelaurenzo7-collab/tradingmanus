import { Link, useLocation } from "wouter";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { navSections, type NavItem } from "./navigation";

type LiveStatus = {
  liveTradingArmed: boolean;
  equity: number | null;
  killSwitchPending: boolean;
  onKillSwitch: () => void;
};

interface SidebarProps extends LiveStatus {
  /** When true, sidebar is shown as a slide-in drawer on mobile */
  mobileOpen: boolean;
  onMobileClose: () => void;
  /** Persistent desktop collapsed state (lifted so layout can resize main) */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

/**
 * Vertical, collapsible sidebar. Replaces the old top-bar dropdown navigation.
 *
 * Behavior:
 *  - Desktop: persistent, 248px expanded, 68px collapsed (icon-only).
 *  - Mobile: hidden by default, slides in as a drawer when `mobileOpen` is true.
 *  - Collapsed state persists in localStorage.
 */
export function Sidebar({
  mobileOpen,
  onMobileClose,
  liveTradingArmed,
  equity,
  killSwitchPending,
  onKillSwitch,
  collapsed,
  onCollapsedChange,
}: SidebarProps) {
  const [location] = useLocation();

  const isItemActive = (item: NavItem) =>
    location === item.path ||
    (item.path === "/dashboard" && location === "/");

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onMobileClose}
          className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border/60 bg-card/80 backdrop-blur-xl",
          "transition-[width,transform] duration-200 ease-out",
          collapsed ? "lg:w-[68px]" : "lg:w-[248px]",
          "w-[248px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Brand */}
        <Link
          href="/dashboard"
          onClick={onMobileClose}
          className="flex items-center gap-2.5 px-4 h-16 border-b border-border/60 shrink-0"
        >
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-primary via-accent to-primary shadow-lg shrink-0">
            <Zap className="w-5 h-5 text-white" />
          </div>
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-base font-bold gradient-text leading-none truncate">
                LAURENZO
              </span>
              <span className="text-[10px] text-muted-foreground tracking-widest uppercase leading-none mt-1">
                Command Center
              </span>
            </div>
          )}
        </Link>

        {/* Nav scroll area */}
        <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-5">
          {navSections.map((section) => (
            <div key={section.label}>
              {!collapsed && (
                <div className="px-3 mb-1.5 text-[10px] font-semibold tracking-widest uppercase text-muted-foreground/70">
                  {section.label}
                </div>
              )}
              {collapsed && (
                <div className="mx-3 mb-1.5 h-px bg-border/50" />
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isItemActive(item);
                  const Icon = item.icon;
                  const button = (
                    <Link
                      key={item.path}
                      href={item.path}
                      onClick={onMobileClose}
                      className={cn(
                        "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors outline-none",
                        "focus-visible:ring-2 focus-visible:ring-primary/50",
                        active
                          ? "bg-primary/15 text-foreground font-semibold"
                          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                        collapsed && "justify-center px-0",
                      )}
                    >
                      <Icon
                        className={cn(
                          "w-4 h-4 shrink-0",
                          active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                        )}
                      />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {!collapsed && active && (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                      )}
                    </Link>
                  );

                  if (collapsed) {
                    return (
                      <li key={item.path}>
                        <Tooltip>
                          <TooltipTrigger asChild>{button}</TooltipTrigger>
                          <TooltipContent side="right" className="font-medium">
                            {item.label}
                            {item.hint && (
                              <span className="block text-xs text-muted-foreground mt-0.5">
                                {item.hint}
                              </span>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </li>
                    );
                  }
                  return <li key={item.path}>{button}</li>;
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Live status footer */}
        <div className="border-t border-border/60 p-3 space-y-2 shrink-0">
          {!collapsed ? (
            <div className="rounded-lg border border-border/60 bg-background/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full",
                      liveTradingArmed ? "bg-destructive animate-pulse" : "bg-success",
                    )}
                  />
                  <span className="text-xs font-semibold">
                    {liveTradingArmed ? "Live Armed" : "Disarmed"}
                  </span>
                </div>
                {equity !== null && (
                  <span className="text-xs font-bold tabular-nums text-foreground">
                    ${equity.toFixed(2)}
                  </span>
                )}
              </div>
              {liveTradingArmed && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={killSwitchPending}
                  onClick={onKillSwitch}
                  className="w-full gap-1.5 h-8"
                >
                  {killSwitchPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5" />
                  )}
                  Kill Switch
                </Button>
              )}
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "flex items-center justify-center w-full h-9 rounded-md border border-border/60",
                    liveTradingArmed
                      ? "bg-destructive/10 border-destructive/30"
                      : "bg-success/10 border-success/30",
                  )}
                >
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full",
                      liveTradingArmed ? "bg-destructive animate-pulse" : "bg-success",
                    )}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                {liveTradingArmed ? "Live Armed" : "Disarmed"}
                {equity !== null && (
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    ${equity.toFixed(2)}
                  </span>
                )}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Collapse toggle (desktop only) */}
          <Button
            variant="ghost"
            size="sm"
            className="hidden lg:flex w-full justify-center h-8"
            onClick={() => onCollapsedChange(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
            {!collapsed && (
              <span className="ml-2 text-xs text-muted-foreground">Collapse</span>
            )}
          </Button>
        </div>
      </aside>
    </>
  );
}

/** Width of the persistent desktop sidebar in pixels (expanded vs collapsed). */
export const SIDEBAR_WIDTH = { expanded: 248, collapsed: 68 } as const;

/** localStorage key for persisting the desktop collapsed state. */
export const SIDEBAR_COLLAPSED_KEY = "laurenzo.sidebar.collapsed";
