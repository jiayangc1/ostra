import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/cn.ts";

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & { size?: "sm" | "md" };

/** Native select (keyboard and mobile pickers for free) dressed like the Input. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, size = "md", children, ...rest }, ref) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        ref={ref}
        className={cn(
          "w-full cursor-pointer appearance-none truncate rounded-control border border-line bg-transparent pl-3 pr-8 text-fg",
          "transition-[border-color,box-shadow] duration-[var(--motion-fast)] ease-out hover:border-line-hover",
          "focus-visible:border-line-strong focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--o-focus)_22%,transparent)] focus-visible:outline-none",
          "[&>option]:bg-elevated",
          size === "sm" ? "h-8 text-[13px]" : "h-9 text-sm",
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden="true" />
    </span>
  );
});
