import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn.ts";
import { usePresence } from "../lib/presence.ts";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
  className?: string;
  /** Vertical placement: command bars sit high, forms sit centered. */
  placement?: "top" | "center";
}

/** Modal surface: backdrop fade, scale-in and scale-out content, focus trap, Esc to close. */
export function Dialog({ open, onClose, children, label, className, placement = "center" }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const { mounted, closing } = usePresence(open, 140);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement | null;
    const t = requestAnimationFrame(() => {
      // Fields take focus; otherwise the panel does, so no button wears a focus ring on open.
      const el = panel.current?.querySelector<HTMLElement>("[data-autofocus], input:not([type=hidden]), textarea, select");
      (el ?? panel.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(t);
      restore.current?.focus?.();
    };
  }, [open]);

  if (!mounted) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (!closing) onClose();
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
      className={cn("fixed inset-0 z-50 flex justify-center px-4", placement === "top" ? "items-start pt-[12vh]" : "items-center", closing && "pointer-events-none")}
      onKeyDown={onKeyDown}
    >
      <div className={cn("absolute inset-0 bg-overlay", closing ? "animate-fade-out" : "animate-fade-in")} onMouseDown={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn("relative w-full max-w-lg overflow-hidden rounded-window bg-elevated shadow-window outline-none", closing ? "animate-pop-out" : "animate-pop-in", className)}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Standard modal layout: padded body with a title, then a footer bar for actions. */
export function DialogBody({ title, description, children, className }: { title?: ReactNode; description?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-4 p-6", className)}>
      {(title || description) && (
        <div className="flex flex-col gap-1.5">
          {title && <h2 className="text-base font-semibold text-fg">{title}</h2>}
          {description && <p className="text-[13px] leading-relaxed text-fg-2">{description}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex items-center justify-end gap-2 border-t border-line bg-surface px-6 py-3", className)}>{children}</div>;
}
