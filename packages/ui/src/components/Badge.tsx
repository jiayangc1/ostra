import type { Color } from "@ostra/core";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { BADGE_CLASSES } from "../lib/colors.ts";

export interface BadgeProps {
  color?: Color;
  children: ReactNode;
  className?: string;
  /** Shown as a small sparkle when the label was applied by AI. */
  title?: string;
}

/** Pill-shaped label badge: tinted background, bright text, Geist Mono 11px. */
export function Badge({ color = "gray", children, className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-[18px] max-w-36 shrink-0 items-center truncate rounded-full px-1.5 font-mono text-[11px] leading-none",
        BADGE_CLASSES[color],
        className,
      )}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}
