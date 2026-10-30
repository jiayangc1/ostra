import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn.ts";

export interface ToastOptions {
  message: string;
  tone?: "default" | "error" | "success";
  action?: { label: string; onClick: () => void };
  durationMs?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  leaving?: boolean;
}

const ToastContext = createContext<{ toast: (t: ToastOptions) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 160);
  }, []);

  const toast = useCallback(
    (t: ToastOptions) => {
      const id = next.current++;
      setItems((list) => [...list.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), t.durationMs ?? 4000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2" aria-live="polite">
            {items.map((t) => (
              <div
                key={t.id}
                role={t.tone === "error" ? "alert" : "status"}
                className={cn(
                  "pointer-events-auto flex min-w-64 max-w-sm items-center gap-3 rounded-card bg-surface px-3.5 py-2.5 text-[13px] shadow-menu",
                  "transition-[opacity,transform] duration-[var(--motion-fast)] ease-out",
                  t.leaving ? "translate-y-1 opacity-0" : "animate-pop-in",
                )}
              >
                {t.tone === "error" && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red" aria-hidden="true" />}
                {t.tone === "success" && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green" aria-hidden="true" />}
                <span className="flex-1 text-fg">{t.message}</span>
                {t.action && (
                  <button
                    type="button"
                    className="o-press rounded-[4px] px-1.5 py-0.5 font-medium text-fg hover:bg-hover"
                    onClick={() => {
                      t.action!.onClick();
                      dismiss(t.id);
                    }}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx.toast;
}
