import { COLORS, type Color } from "@ostra/core";
import { cn } from "../lib/cn.ts";
import { DOT_CLASSES } from "../lib/colors.ts";

export function ColorPicker({ value, onChange, label = "Color" }: { value: Color; onChange: (c: Color) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1.5">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn(
            "o-press flex h-6 w-6 items-center justify-center rounded-full border transition-colors",
            value === c ? "border-line-strong" : "border-transparent hover:border-line-hover",
          )}
        >
          <span className={cn("h-3 w-3 rounded-full transition-transform duration-[var(--motion-fast)] ease-spring", DOT_CLASSES[c], value === c && "scale-110")} />
        </button>
      ))}
    </div>
  );
}

/** Next unused color, so each new account gets its own dot. */
export function nextColor(used: Color[]): Color {
  return COLORS.find((c) => !used.includes(c) && c !== "gray") ?? "gray";
}
