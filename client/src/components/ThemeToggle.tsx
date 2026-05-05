import { Moon, Monitor, Sun } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Animated theme toggle with three modes: light, dark, system.
 * Cycles on click and persists to localStorage under 'laurenzo-theme'.
 * Shows appropriate icon with smooth rotation transition.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const cycleTheme = () => {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("system");
    else setTheme("light");
  };

  const getIcon = () => {
    switch (theme) {
      case "light":
        return Sun;
      case "dark":
        return Moon;
      case "system":
        return Monitor;
    }
  };

  const getLabel = () => {
    switch (theme) {
      case "light":
        return "Light mode";
      case "dark":
        return "Dark mode";
      case "system":
        return "System theme";
    }
  };

  const Icon = getIcon();

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={cycleTheme}
            className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-sidebar-accent/20 transition-all duration-200 group"
            aria-label={`Current theme: ${getLabel()}. Click to cycle.`}
          >
            <Icon
              className="w-4.5 h-4.5 text-muted-foreground group-hover:text-foreground transition-all duration-300 group-hover:rotate-12"
              strokeWidth={1.5}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          <p>{getLabel()}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
