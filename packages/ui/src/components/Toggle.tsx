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

/** Switch. role="switch", animated thumb, label on the left. */
export function Toggle({ checked, onChange, label, description, disabled, size = "md", className, id }: ToggleProps) {
  const autoId = useId();
  const switchId = id ?? autoId;
  const track = size === "sm" ? "h-4 w-7" : "h-5 w-9";
  const thumb = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  const travel = size === "sm" ? "translate-x-3" : "translate-x-4";
  const button = (
    <button
      id={switchId}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "o-press relative inline-flex shrink-0 cursor-pointer items-center rounded-full border p-px",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-transparent bg-primary" : "border-line-hover bg-active",
        track,
      )}
    >
      <span
        className={cn(
          "pointer-events-none block rounded-full shadow-sm transition-transform duration-[var(--motion-normal)] ease-spring",
          checked ? cn(travel, "bg-primary-fg") : "translate-x-0 bg-fg-2",
          thumb,
        )}
      />
    </button>
  );
  if (!label) return <span className={className}>{button}</span>;
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <label htmlFor={switchId} className="flex cursor-pointer flex-col gap-0.5">
        <span className="text-sm font-medium text-fg">{label}</span>
        {description && <span className="text-[13px] text-fg-3">{description}</span>}
      </label>
      {button}
    </div>
  );
}
