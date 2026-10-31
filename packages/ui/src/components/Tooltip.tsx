import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { Kbd } from "./Kbd.tsx";

export interface TooltipProps {
  content: ReactNode;
  shortcut?: string;
  side?: "top" | "bottom" | "right";
  /** Horizontal alignment for top/bottom tooltips; "end" keeps edge buttons on screen. */
  align?: "center" | "start" | "end";
  children: ReactNode;
  delay?: number;
  /** Classes for the wrapper, e.g. "flex w-full" for full-width nav items. */
  className?: string;
}

/** Once one tooltip has shown, neighbours open instantly while the pointer sweeps across a toolbar. */
let warmUntil = 0;

/** Hover/focus tooltip with an optional shortcut key cap. Secondary information only. */
export function Tooltip({ content, shortcut, side = "bottom", align = "center", children, delay = 400, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), Date.now() < warmUntil ? 0 : delay);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    if (open) warmUntil = Date.now() + 400;
    setOpen(false);
  };

  return (
    <span
      className={cn("relative inline-flex", className)}
      onPointerEnter={(e) => e.pointerType === "mouse" && show()}
      onPointerLeave={hide}
      onFocus={(e) => e.target.matches(":focus-visible") && show()}
      onBlur={hide}
      onPointerDown={hide}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-50 flex animate-pop-in items-center gap-2 whitespace-nowrap rounded-control bg-elevated px-2 py-1 text-xs font-medium text-fg shadow-menu",
            side === "bottom" && "top-full mt-1.5",
            side === "top" && "bottom-full mb-1.5",
            side !== "right" && align === "center" && "left-1/2 -translate-x-1/2",
            side !== "right" && align === "start" && "left-0",
            side !== "right" && align === "end" && "right-0",
            side === "right" && "left-full top-1/2 ml-2 -translate-y-1/2",
          )}
        >
          {content}
          {shortcut && <Kbd keys={shortcut} />}
        </span>
      )}
    </span>
  );
}
