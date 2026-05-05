import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { LayoutDashboard, TrendingUp, ListChecks, BarChart2, Activity, BarChart3, Play, Zap, SlidersHorizontal } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

const pages = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: TrendingUp, label: "Signals", path: "/signals" },
  { icon: ListChecks, label: "Positions", path: "/positions" },
  { icon: BarChart3, label: "Performance", path: "/performance" },
  { icon: SlidersHorizontal, label: "Trading Autonomy", path: "/autonomy" },
  { icon: Activity, label: "Trades", path: "/trades" },
  { icon: BarChart2, label: "Analytics", path: "/analytics" },
];

const actions = [
  { icon: Play, label: "Start Trading", path: "/autonomy" },
  { icon: Zap, label: "Generate Signals", path: "/signals" },
  { icon: BarChart2, label: "View Positions", path: "/positions" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

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

  const handleSelect = useCallback((path: string) => {
    navigate(path);
    setOpen(false);
  }, [navigate]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      className="border border-white/10 bg-slate-900/80 backdrop-blur-xl shadow-2xl"
    >
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Pages">
          {pages.map((item) => (
            <CommandItem
              key={item.path + item.label}
              value={item.label}
              onSelect={() => handleSelect(item.path)}
            >
              <item.icon className="mr-2 h-4 w-4 opacity-70" />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          {actions.map((item) => (
            <CommandItem
              key={item.label}
              value={item.label}
              onSelect={() => handleSelect(item.path)}
            >
              <item.icon className="mr-2 h-4 w-4 opacity-70" />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export default CommandPalette;
