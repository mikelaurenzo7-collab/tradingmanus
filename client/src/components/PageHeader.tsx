import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Tailwind gradient classes (e.g. "from-violet-500 to-indigo-500") for the icon tile */
  iconGradient?: string;
}

/**
 * Consistent page header used across the dashboard. Renders a gradient icon
 * tile, gradient title, optional description, optional badge, and optional
 * right-aligned actions.
 */
export function PageHeader({
  icon: Icon,
  title,
  description,
  badge,
  actions,
  className,
  iconGradient = "from-violet-500 to-indigo-500",
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-4 pb-6 mb-2 border-b border-white/5",
        className,
      )}
    >
      <div className="flex items-start gap-4 min-w-0 flex-1">
        {Icon ? (
          <div
            className={cn(
              "flex items-center justify-center w-12 h-12 rounded-2xl shadow-lg shadow-violet-500/20 shrink-0 bg-gradient-to-br",
              iconGradient,
            )}
          >
            <Icon className="w-6 h-6 text-white" />
          </div>
        ) : null}
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold gradient-text leading-tight">{title}</h1>
            {badge}
          </div>
          {description ? (
            <p className="text-sm text-muted-foreground mt-1.5 max-w-3xl leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2 flex-wrap">{actions}</div> : null}
    </div>
  );
}

export default PageHeader;
