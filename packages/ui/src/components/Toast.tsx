import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertCircle } from "lucide-react";
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

/** Bottom-center stack: the newest toast in front, older ones tucked behind it until hovered. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [hovered, setHovered] = useState(false);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 160);
  }, []);

  const toast = useCallback(
    (t: ToastOptions) => {
      const id = next.current++;
      setItems((list) => [...list.filter((x) => !x.leaving).slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), t.durationMs ?? (t.action ? 6000 : 4000));
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);
  const live = items.filter((t) => !t.leaving);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <div
            className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex justify-center px-4"
            aria-live="polite"
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
          >
            <ol className="relative grid w-full max-w-[380px] [grid-template-areas:'stack']">
              {items.map((t) => {
                // Depth from the front: 0 is the newest live toast.
                const depth = t.leaving ? 0 : live.length - 1 - live.indexOf(t);
                const offset = hovered ? depth * -52 : depth * -8;
                const scale = hovered ? 1 : 1 - depth * 0.05;
                return (
                  <li
                    key={t.id}
                    role={t.tone === "error" ? "alert" : "status"}
                    style={{ transform: `translateY(${offset}px) scale(${scale})`, zIndex: 10 - depth, opacity: depth > 2 ? 0 : 1 }}
                    className="pointer-events-auto origin-bottom self-end transition-[transform,opacity] duration-[var(--motion-normal)] ease-out [grid-area:stack]"
                  >
                    <div
                      className={cn(
                        "flex items-center gap-2.5 rounded-card bg-elevated py-2.5 pl-3.5 pr-2 text-[13px] shadow-window",
                        t.leaving ? "animate-pop-out" : "animate-sheet-in",
                      )}
                    >
                      {t.tone === "error" && <AlertCircle size={15} className="shrink-0 text-red" aria-hidden="true" />}
                      {t.tone === "success" && <SuccessIcon />}
                      <span className={cn("flex-1 py-0.5 text-fg", depth > 0 && !hovered && "opacity-0")}>{t.message}</span>
                      {t.action && (
                        <button
                          type="button"
                          className="o-press h-7 shrink-0 rounded-control border border-line px-2.5 text-[12px] font-medium text-fg hover:border-line-hover hover:bg-hover"
                          onClick={() => {
                            t.action!.onClick();
                            dismiss(t.id);
                          }}
                        >
                          {t.action.label}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

function SuccessIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="shrink-0 text-green" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.18" />
      <path d="M5 8.2 7.1 10.2 11 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" pathLength={24} className="o-check-draw" />
    </svg>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx.toast;
}
