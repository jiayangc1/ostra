import type { CSSProperties } from "react";
import { cn } from "../lib/cn.ts";

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={cn("o-skeleton block", className)} style={style} />;
}

/** Placeholder rows for the message list. */
export function ListSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading messages" className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-3" style={{ width: `${30 + ((i * 37) % 30)}%` }} />
            <Skeleton className="ml-auto h-3 w-8" />
          </div>
          <Skeleton className="h-3" style={{ width: `${55 + ((i * 53) % 35)}%` }} />
        </div>
      ))}
    </div>
  );
}
