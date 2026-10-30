import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn.ts";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
  className?: string;
  /** Vertical placement: command bars sit high, forms sit centered. */
  placement?: "top" | "center";
}

/** Modal surface with backdrop fade, scale-in content, focus trap and Esc to close. */
export function Dialog({ open, onClose, children, label, className, placement = "center" }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement | null;
    const t = requestAnimationFrame(() => {
      const el = panel.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea, button, [tabindex='0']");
      el?.focus();
    });
    return () => {
      cancelAnimationFrame(t);
      restore.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const focusable = [...panel.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input, textarea, select, [tabindex='0']")];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className={cn("fixed inset-0 z-50 flex justify-center px-4", placement === "top" ? "items-start pt-[12vh]" : "items-center")}
      onKeyDown={onKeyDown}
    >
      <div className="absolute inset-0 animate-fade-in bg-overlay backdrop-blur-[2px]" onMouseDown={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn("relative w-full max-w-lg animate-pop-in rounded-window bg-surface shadow-window", className)}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
