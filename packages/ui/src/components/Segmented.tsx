import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  label: string;
  className?: string;
}

/** Radio group drawn as a segmented control; the selected thumb glides between options. */
export function Segmented<T extends string>({ value, onChange, options, label, className }: SegmentedProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = root.current?.querySelector<HTMLElement>("[aria-checked=true]");
    const t = thumb.current;
    if (!el || !t) return;
    const first = !t.dataset.placed;
    t.style.transition = first ? "none" : "";
    t.style.width = `${el.offsetWidth}px`;
    t.style.transform = `translateX(${el.offsetLeft - 2}px)`;
    t.dataset.placed = "1";
  }, [value, options.length]);

  return (
    <div
      ref={root}
      role="radiogroup"
      aria-label={label}
      className={cn("relative inline-flex w-fit gap-0.5 rounded-card border border-line bg-surface p-0.5", className)}
      onKeyDown={(e) => {
        const i = options.findIndex((o) => o.value === value);
        const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? i + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? i - 1 : null;
        if (next === null) return;
        e.preventDefault();
        const o = options[(next + options.length) % options.length]!;
        onChange(o.value);
        requestAnimationFrame(() => root.current?.querySelector<HTMLElement>("[aria-checked=true]")?.focus());
      }}
    >
      <span
        ref={thumb}
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-control bg-elevated shadow-raised transition-[transform,width] duration-[var(--motion-normal)] ease-spring"
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          onClick={() => onChange(o.value)}
          className={cn(
            "o-press relative z-10 flex h-7 items-center gap-1.5 rounded-control px-3 text-[13px] font-medium",
            value === o.value ? "text-fg" : "text-fg-3 hover:text-fg-2",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
