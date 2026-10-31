import { useId, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  id?: string;
}

/** Switch. role="switch", springy thumb that stretches while pressed, label on the left. */
export function Toggle({ checked, onChange, label, description, disabled, size = "md", className, id }: ToggleProps) {
  const autoId = useId();
  const switchId = id ?? autoId;
  const sm = size === "sm";
  const button = (
    <button
      id={switchId}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "group/switch relative inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5",
        "transition-[background-color,box-shadow] duration-[var(--motion-normal)] ease-out",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-active shadow-[inset_0_0_0_1px_var(--o-line-hover)] hover:bg-line-hover",
        sm ? "h-[18px] w-[30px]" : "h-[22px] w-[38px]",
      )}
    >
      <span
        className={cn(
          "pointer-events-none block rounded-full shadow-[0_1px_2px_rgb(0_0_0/0.3)]",
          "transition-[translate,width,background-color] duration-[var(--motion-normal)] ease-spring",
          checked ? "bg-primary-fg" : "bg-white",
          sm ? "h-3.5 w-3.5 group-active/switch:w-4" : "h-[18px] w-[18px] group-active/switch:w-[22px]",
          // Pinned to its edge, so the stretch grows toward the middle.
          checked ? (sm ? "translate-x-3 group-active/switch:translate-x-2.5" : "translate-x-4 group-active/switch:translate-x-3") : "translate-x-0",
        )}
      />
    </button>
  );
  if (!label) return <span className={cn("inline-flex", className)}>{button}</span>;
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <label htmlFor={switchId} className={cn("flex cursor-pointer flex-col gap-0.5", disabled && "cursor-not-allowed opacity-60")}>
        <span className={cn("font-medium text-fg", sm ? "text-[13px]" : "text-sm")}>{label}</span>
        {description && <span className="text-[13px] leading-relaxed text-fg-3">{description}</span>}
      </label>
      <span className="pt-px">{button}</span>
    </div>
  );
}
