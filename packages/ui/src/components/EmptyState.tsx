import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex animate-slide-up flex-col items-center justify-center gap-3 px-6 py-16 text-center", className)}>
      {icon && <div className="text-fg-3">{icon}</div>}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        {description && <p className="max-w-64 text-[13px] text-fg-3">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
