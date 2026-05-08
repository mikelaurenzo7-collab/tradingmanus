import { Link } from "wouter";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SetupStatus } from "@/lib/setupStatus";

interface SetupStatusPillProps {
  status: SetupStatus;
}

/**
 * Setup-status pill rendered in the Topbar.
 *
 * - Hidden entirely when all four steps are complete (the live-armed pill
 *   takes over visually at that point).
 * - Otherwise shows progress (X/4) + the next step's short label, linking
 *   to /setup so the user can act on it in one click.
 */
export function SetupStatusPill({ status }: SetupStatusPillProps) {
  if (status.allComplete) return null;

  const next = status.nextStep;
  const fraction = `${status.completedCount}/${status.steps.length}`;

  return (
    <Link
      href="/setup"
      className={cn(
        "hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full",
        "bg-amber-500/10 border border-amber-400/40 text-amber-300",
        "hover:bg-amber-500/20 hover:border-amber-400/60",
        "transition-colors",
      )}
      aria-label="Open setup checklist"
    >
      {status.completedCount > 0 ? (
        <CheckCircle2 className="w-3.5 h-3.5" />
      ) : (
        <ArrowRight className="w-3.5 h-3.5" />
      )}
      <span className="text-[11px] font-semibold uppercase tracking-wider">
        Setup {fraction}
      </span>
      {next && (
        <span className="text-[11px] hidden md:inline opacity-80">
          · next: {next.shortLabel}
        </span>
      )}
    </Link>
  );
}
