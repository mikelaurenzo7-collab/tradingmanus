import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  LogOut,
  Menu,
  RefreshCw,
  Search,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import { findNavMatch, getPageLabel } from "./navigation";

interface TopbarProps {
  user: { name?: string | null; email?: string | null } | null;
  liveTradingArmed: boolean;
  killSwitchPending: boolean;
  onKillSwitch: () => void;
  onLogout: () => void;
  onOpenMobileNav: () => void;
  /** Optional refresh handler (page-aware) — when null, button is hidden. */
  onRefresh?: () => void;
  refreshing?: boolean;
}

/**
 * Slim, sticky top bar (56px). Replaces the previous nav-heavy top bar.
 *
 * Contents:
 *  - Mobile menu trigger + page title + section breadcrumb
 *  - Right side: search trigger (⌘K), live-armed pill, kill switch, refresh,
 *    theme toggle, user menu.
 */
export function Topbar({
  user,
  liveTradingArmed,
  killSwitchPending,
  onKillSwitch,
  onLogout,
  onOpenMobileNav,
  onRefresh,
  refreshing,
}: TopbarProps) {
  const [location] = useLocation();
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
    }
  }, []);

  const match = findNavMatch(location);
  const pageLabel = getPageLabel(location);
  const sectionLabel = match?.section.label ?? null;
  const userInitial = user?.name?.charAt(0).toUpperCase() || "U";

  const triggerCommandPalette = () => {
    if (typeof window === "undefined") return;
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      ctrlKey: !isMac,
      bubbles: true,
    });
    document.dispatchEvent(event);
  };

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="flex items-center h-full gap-3 px-4 lg:px-6">
        {/* Mobile menu */}
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden -ml-2"
          onClick={onOpenMobileNav}
          aria-label="Open navigation"
        >
          <Menu className="w-5 h-5" />
        </Button>

        {/* Breadcrumb / page title */}
        <div className="flex flex-col leading-tight min-w-0">
          {sectionLabel && (
            <span className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground/80">
              {sectionLabel}
            </span>
          )}
          <h1 className="text-base font-semibold text-foreground truncate">
            {pageLabel}
          </h1>
        </div>

        {/* Search / command palette trigger */}
        <button
          type="button"
          onClick={triggerCommandPalette}
          className={cn(
            "ml-auto hidden md:flex items-center gap-2 h-9 px-3 rounded-md",
            "border border-border/60 bg-card/60 hover:bg-card transition-colors",
            "text-sm text-muted-foreground min-w-[260px]",
          )}
        >
          <Search className="w-4 h-4" />
          <span>Search or jump…</span>
          <kbd className="ml-auto inline-flex items-center gap-0.5 rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            <span className="font-mono">{isMac ? "⌘" : "Ctrl"}</span>
            <span className="font-mono">K</span>
          </kbd>
        </button>

        {/* Mobile search button */}
        <button
          type="button"
          onClick={triggerCommandPalette}
          className="md:hidden ml-auto flex items-center justify-center w-9 h-9 rounded-md border border-border/60 bg-card/60 text-muted-foreground"
          aria-label="Search"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* Live armed pill (when armed) */}
        {liveTradingArmed && (
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-destructive/10 border border-destructive/30">
            <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-destructive-foreground">
              Live
            </span>
          </div>
        )}

        {/* Kill switch (only visible when armed) */}
        {liveTradingArmed && (
          <Button
            variant="destructive"
            size="sm"
            disabled={killSwitchPending}
            onClick={onKillSwitch}
            className="hidden sm:inline-flex h-9 gap-1.5"
          >
            {killSwitchPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5" />
            )}
            <span className="hidden lg:inline">Kill Switch</span>
            <span className="lg:hidden">Kill</span>
          </Button>
        )}

        {/* Refresh */}
        {onRefresh && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh"
            className="h-9 w-9"
          >
            <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
          </Button>
        )}

        <ThemeToggle />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-accent/40 transition-colors">
              <Avatar className="w-7 h-7 ring-2 ring-primary/30">
                <AvatarFallback className="text-xs font-bold bg-gradient-to-br from-primary to-accent text-white">
                  {userInitial}
                </AvatarFallback>
              </Avatar>
              <ChevronDown className="hidden lg:block w-3 h-3 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <div className="px-3 py-2 border-b border-border">
              <p className="text-sm font-semibold truncate">{user?.name || "User"}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email || ""}</p>
            </div>
            <DropdownMenuItem
              onClick={onLogout}
              className="flex items-center gap-2 cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
