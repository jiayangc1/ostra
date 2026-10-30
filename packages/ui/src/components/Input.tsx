import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn.ts";

interface FieldProps {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  size?: "sm" | "md";
}

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> & FieldProps;

const control =
  "w-full rounded-control border border-line bg-canvas text-fg placeholder:text-fg-3 transition-[border-color,box-shadow] duration-[var(--motion-fast)] ease-out hover:border-line-hover focus-within:border-line-strong focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--o-focus)_22%,transparent)]";

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, description, error, prefix, suffix, size = "md", className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const descId = description ? `${inputId}-desc` : undefined;
  const errId = error ? `${inputId}-err` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={inputId} className="text-[13px] font-medium text-fg-2">
          {label}
        </label>
      )}
      <div
        className={cn(
          control,
          "flex items-center gap-2 px-3",
          size === "sm" ? "h-8 text-[13px]" : "h-9 text-sm",
          !!error && "border-red hover:border-red focus-within:border-red",
        )}
      >
        {prefix && <span className="flex shrink-0 text-fg-3">{prefix}</span>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={[descId, errId].filter(Boolean).join(" ") || undefined}
          className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-3 focus-visible:outline-none"
          {...rest}
        />
        {suffix && <span className="flex shrink-0 text-fg-3">{suffix}</span>}
      </div>
      {description && !error && (
        <p id={descId} className="text-[13px] text-fg-3">
          {description}
        </p>
      )}
      {error && (
        <p id={errId} className="animate-slide-down text-[13px] text-red">
          {error}
        </p>
      )}
    </div>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & Omit<FieldProps, "prefix" | "suffix" | "size">;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, description, error, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={inputId} className="text-[13px] font-medium text-fg-2">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={cn(control, "min-h-24 px-3 py-2 text-sm leading-relaxed outline-none focus-visible:outline-none", !!error && "border-red")}
        {...rest}
      />
      {description && !error && <p className="text-[13px] text-fg-3">{description}</p>}
      {error && <p className="text-[13px] text-red">{error}</p>}
    </div>
  );
});
