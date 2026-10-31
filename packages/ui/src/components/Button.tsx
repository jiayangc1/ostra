import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { LoadingDots } from "./LoadingDots.tsx";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "prefix"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** Icon-only buttons must pass an aria-label. */
  iconOnly?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover border border-transparent shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]",
  secondary: "bg-transparent text-fg border border-line-hover hover:border-line-strong hover:bg-hover",
  tertiary: "bg-transparent text-fg-2 border border-transparent hover:text-fg hover:bg-hover",
  danger: "bg-red text-white border border-transparent hover:brightness-110",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[13px] gap-1.5",
  md: "h-8 px-3 text-sm gap-2",
  lg: "h-10 px-4 text-sm gap-2",
};

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: "h-7 w-7",
  md: "h-8 w-8",
  lg: "h-10 w-10",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, prefix, suffix, iconOnly, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "o-press relative inline-flex shrink-0 select-none items-center justify-center rounded-control font-medium whitespace-nowrap",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-wait aria-busy:opacity-100",
        VARIANTS[variant],
        iconOnly ? ICON_SIZES[size] : SIZES[size],
        className,
      )}
      {...rest}
    >
      <span className={cn("inline-flex items-center gap-[inherit]", loading && "invisible")}>
        {prefix}
        {children}
        {suffix}
      </span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <LoadingDots />
        </span>
      )}
    </button>
  );
});
