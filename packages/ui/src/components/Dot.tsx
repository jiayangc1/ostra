import type { Color } from "@ostra/core";
import { cn } from "../lib/cn.ts";
import { DOT_CLASSES } from "../lib/colors.ts";

export function Dot({ color, size = 8, className, label }: { color: Color; size?: number; className?: string; label?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      className={cn("inline-block shrink-0 rounded-full", DOT_CLASSES[color], className)}
      style={{ width: size, height: size }}
    />
  );
}

/** Overlapping dots when one thread landed in several accounts. */
export function DotStack({ colors, labels }: { colors: Color[]; labels?: string[] }) {
  return (
    <span className="inline-flex shrink-0 items-center" aria-label={labels?.join(", ")}>
      {colors.map((c, i) => (
        <Dot key={i} color={c} className={cn(i > 0 && "-ml-[3px] ring-2 ring-canvas")} />
      ))}
    </span>
  );
}
