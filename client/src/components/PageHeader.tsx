import { ReactNode } from "react";
import { LucideIcon, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
  breadcrumbs?: BreadcrumbItem[];
  /** Tailwind color classes for the icon (e.g. "text-primary") */
  iconColor?: string;
}

/**
 * Consistent page header used across the dashboard. Renders an icon,
 * gradient title, optional breadcrumbs, optional description, optional badge,
 * and optional right-aligned actions.
 */
export function PageHeader({
  icon: Icon,
  title,
  description,
  badge,
  actions,
  className,
  breadcrumbs,
  iconColor = "text-primary",
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 pb-6 mb-6 border-b border-border/50",
        className,
      )}
    >
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {breadcrumbs.map((item, index) => (
            <div key={index} className="flex items-center gap-2">
              {item.href ? (
                <a href={item.href} className="hover:text-foreground transition-colors">
                  {item.label}
                </a>
              ) : (
                <span className={index === breadcrumbs.length - 1 ? "text-foreground font-medium" : ""}>
                  {item.label}
                </span>
              )}
              {index < breadcrumbs.length - 1 && (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Header Content */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0 flex-1">
          {Icon && (
            <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/20 shrink-0">
              <Icon className={cn("w-6 h-6", iconColor)} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold text-gradient leading-tight">{title}</h1>
              {badge}
            </div>
            {description && (
              <p className="text-sm text-muted-foreground mt-2 max-w-3xl leading-relaxed">
                {description}
              </p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
    </div>
  );
}

export default PageHeader;
