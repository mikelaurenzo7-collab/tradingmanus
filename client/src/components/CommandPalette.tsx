import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Sparkles, Zap, RefreshCw, ShieldAlert, Plug, Wallet } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { trpc } from "@/lib/trpc";
import { navSections } from "@/components/shell/navigation";

/**
 * Global command palette (⌘K / Ctrl+K).
 *
 * Includes every navigation route grouped by section, plus a few
 * high-leverage actions (kill switch, refresh, jump to onboarding).
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const handleNavigate = useCallback(
    (path: string) => {
      navigate(path);
      setOpen(false);
    },
    [navigate],
  );

  const handleKillSwitch = useCallback(() => {
    setOpen(false);
    if (
      window.confirm(
        "Activate kill switch? This will disarm live trading and submit close orders for all positions.",
      )
    ) {
      killSwitchMutation.mutate();
    }
  }, [killSwitchMutation]);

  const handleRefreshAll = useCallback(async () => {
    setOpen(false);
    await Promise.all([
      utils.kalshi.getKalshiAccountStatus.invalidate(),
      utils.kalshi.getPerformanceOverview.invalidate(),
      utils.kalshi.getTradingPreferences.invalidate(),
      utils.kalshi.getAutonomyActivity.invalidate(),
      utils.kalshi.getPositions.invalidate(),
      utils.kalshi.getCapital.invalidate(),
    ]);
  }, [utils]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      className="border border-white/10 bg-slate-900/80 backdrop-blur-xl shadow-2xl"
    >
      <CommandInput placeholder="Search pages or run an action…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Quick actions">
          <CommandItem
            value="Connect exchange Kalshi onboarding"
            onSelect={() => handleNavigate("/connect")}
          >
            <Plug className="mr-2 h-4 w-4 opacity-70" />
            Connect Kalshi
          </CommandItem>
          <CommandItem
            value="Fund deposit balance"
            onSelect={() => handleNavigate("/funding")}
          >
            <Wallet className="mr-2 h-4 w-4 opacity-70" />
            Fund account
          </CommandItem>
          <CommandItem
            value="Generate signals scan"
            onSelect={() => handleNavigate("/signals")}
          >
            <Sparkles className="mr-2 h-4 w-4 opacity-70" />
            View latest signals
          </CommandItem>
          <CommandItem
            value="Arm autonomy go live"
            onSelect={() => handleNavigate("/autonomy")}
          >
            <Zap className="mr-2 h-4 w-4 opacity-70" />
            Configure autonomy
          </CommandItem>
          <CommandItem value="Refresh dashboard data" onSelect={handleRefreshAll}>
            <RefreshCw className="mr-2 h-4 w-4 opacity-70" />
            Refresh all data
          </CommandItem>
          <CommandItem
            value="Kill switch panic disarm emergency"
            onSelect={handleKillSwitch}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <ShieldAlert className="mr-2 h-4 w-4" />
            Kill switch — disarm everything
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {navSections.map((section) => (
          <CommandGroup key={section.label} heading={section.label}>
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.path}
                  value={`${item.label} ${item.hint ?? ""}`}
                  onSelect={() => handleNavigate(item.path)}
                >
                  <Icon className="mr-2 h-4 w-4 opacity-70" />
                  <span>{item.label}</span>
                  {item.hint && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {item.hint}
                    </span>
                  )}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

export default CommandPalette;
