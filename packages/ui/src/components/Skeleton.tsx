import type { CSSProperties } from "react";
import { cn } from "../lib/cn.ts";

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={cn("o-skeleton block", className)} style={style} />;
}

/** Placeholder rows for the message list, shaped like real rows and faded in one after another. */
export function ListSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading messages" className="flex flex-col gap-px py-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="mx-2 flex animate-fade-in gap-3 px-3 py-2.5" style={{ animationDelay: `${i * 40}ms`, opacity: 1 - i * 0.07 }}>
          <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2 pt-0.5">
            <div className="flex items-center gap-2">
              <Skeleton className="h-3" style={{ width: `${30 + ((i * 37) % 30)}%` }} />
              <Skeleton className="ml-auto h-2.5 w-7" />
            </div>
            <Skeleton className="h-2.5" style={{ width: `${55 + ((i * 53) % 35)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
