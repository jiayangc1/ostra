import { useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { Kbd } from "./Kbd.tsx";

export interface TooltipProps {
  content: ReactNode;
  shortcut?: string;
  side?: "top" | "bottom" | "right";
  children: ReactNode;
  delay?: number;
  /** Classes for the wrapper, e.g. "flex w-full" for full-width nav items. */
  className?: string;
}

/** Hover/focus tooltip with an optional shortcut key cap. Secondary information only. */
export function Tooltip({ content, shortcut, side = "bottom", children, delay = 400, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <span className={cn("relative inline-flex", className)} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onMouseDown={hide}>
      {children}
      {open && (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-50 flex animate-pop-in items-center gap-2 whitespace-nowrap rounded-control bg-surface px-2 py-1 text-xs text-fg shadow-menu",
            side === "bottom" && "left-1/2 top-full mt-1.5 -translate-x-1/2",
            side === "top" && "bottom-full left-1/2 mb-1.5 -translate-x-1/2",
            side === "right" && "left-full top-1/2 ml-1.5 -translate-y-1/2",
          )}
        >
          {content}
          {shortcut && <Kbd keys={shortcut} />}
        </span>
      )}
    </span>
  );
}
