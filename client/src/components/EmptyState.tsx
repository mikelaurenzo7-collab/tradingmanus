import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  iconGradient?: string;
}

/** Consistent empty-state used across the app. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  iconGradient = "from-violet-500/20 to-indigo-500/20",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center gap-4 py-16 px-6 rounded-2xl border border-dashed border-white/10 bg-white/[0.015]",
        className,
      )}
    >
      {Icon ? (
        <div
          className={cn(
            "w-16 h-16 rounded-2xl border border-violet-400/20 flex items-center justify-center bg-gradient-to-br",
            iconGradient,
          )}
        >
          <Icon className="w-8 h-8 text-violet-300" />
        </div>
      ) : null}
      <div className="space-y-1.5 max-w-md">
        <p className="text-lg font-semibold text-white/90">{title}</p>
        {description ? (
          <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export default EmptyState;
