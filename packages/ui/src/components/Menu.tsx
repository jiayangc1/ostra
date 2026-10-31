import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { usePresence } from "../lib/presence.ts";
import { Kbd } from "./Kbd.tsx";

export type MenuEntry =
  | {
      id: string;
      label: ReactNode;
      icon?: ReactNode;
      shortcut?: string;
      hint?: ReactNode;
      checked?: boolean;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { id: string; separator: true }
  | { id: string; heading: ReactNode };

type Item = Extract<MenuEntry, { onSelect: () => void }>;
const isItem = (e: MenuEntry): e is Item => "onSelect" in e;

export interface MenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
}

export interface MenuProps {
  trigger: (props: MenuTriggerProps, open: boolean) => ReactNode;
  items: MenuEntry[];
  side?: "bottom" | "top";
  align?: "start" | "end";
  /** Fixed width; defaults to the trigger's width, at least 200px. */
  width?: number;
  label: string;
}

/**
 * Dropdown menu in a portal (never clipped by scrolling sidebars), positioned
 * from the trigger, with arrow keys, Home/End, typeahead and an exit animation.
 */
export function Menu({ trigger, items, side = "bottom", align = "start", width, label }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [pos, setPos] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const { mounted, closing } = usePresence(open, 120);
  const actionable = items.filter(isItem);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const w = width ?? Math.max(200, r.width);
      const style: CSSProperties = { width: w };
      if (side === "bottom") style.top = r.bottom + 4;
      else style.bottom = window.innerHeight - r.top + 4;
      if (align === "start") style.left = Math.min(r.left, window.innerWidth - w - 8);
      else style.right = Math.max(8, window.innerWidth - r.right);
      setPos(style);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, side, align, width]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) close(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("blur", () => close(false), { once: true });
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const select = (item: Item | undefined) => {
    if (!item || item.disabled) return;
    close();
    item.onSelect();
  };

  const move = (delta: number) => {
    if (actionable.length === 0) return;
    let i = cursor;
    for (let n = 0; n < actionable.length; n++) {
      i = (i + delta + actionable.length) % actionable.length;
      if (!actionable[i]!.disabled) break;
    }
    setCursor(i);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "Home") setCursor(0);
    else if (e.key === "End") setCursor(actionable.length - 1);
    else if (e.key === "Enter" || e.key === " ") select(actionable[cursor]);
    else if (e.key === "Escape" || e.key === "Tab") close(e.key === "Escape");
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const k = e.key.toLowerCase();
      const hit = actionable.findIndex((a, i) => i > cursor && typeof a.label === "string" && a.label.toLowerCase().startsWith(k));
      const wrap = actionable.findIndex((a) => typeof a.label === "string" && a.label.toLowerCase().startsWith(k));
      if (hit >= 0 || wrap >= 0) setCursor(hit >= 0 ? hit : wrap);
      return;
    } else return;
    e.preventDefault();
  };

  const origin = `${side === "bottom" ? "top" : "bottom"} ${align === "start" ? "left" : "right"}`;

  return (
    <>
      {trigger(
        {
          ref: triggerRef,
          onClick: () => {
            setCursor(-1);
            setOpen((o) => !o);
          },
          "aria-haspopup": "menu",
          "aria-expanded": open,
          "aria-controls": open ? id : undefined,
        },
        open,
      )}
      {mounted &&
        createPortal(
          <div
            ref={menuRef}
            id={id}
            role="menu"
            aria-label={label}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            aria-activedescendant={cursor >= 0 && actionable[cursor] ? `${id}-${actionable[cursor].id}` : undefined}
            style={{ ...pos, transformOrigin: origin }}
            className={cn(
              "fixed z-[55] flex flex-col rounded-card bg-elevated p-1 shadow-menu outline-none",
              closing ? "pointer-events-none animate-pop-out" : "animate-pop-in",
            )}
          >
            {items.map((entry) => {
              if ("separator" in entry) return <div key={entry.id} role="separator" className="-mx-1 my-1 h-px bg-line" />;
              if ("heading" in entry)
                return (
                  <div key={entry.id} className="truncate px-2 pb-1 pt-1.5 text-[12px] text-fg-3">
                    {entry.heading}
                  </div>
                );
              const index = actionable.indexOf(entry);
              const active = index === cursor;
              return (
                <div
                  key={entry.id}
                  id={`${id}-${entry.id}`}
                  role={entry.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                  aria-checked={entry.checked}
                  aria-disabled={entry.disabled || undefined}
                  onPointerMove={() => cursor !== index && setCursor(index)}
                  onPointerLeave={() => setCursor(-1)}
                  onClick={() => select(entry)}
                  className={cn(
                    "flex h-8 cursor-default select-none items-center gap-2.5 rounded-[5px] px-2 text-[13px] transition-colors duration-[var(--motion-instant)]",
                    entry.danger ? "text-red" : "text-fg",
                    active && (entry.danger ? "bg-red-bg" : "bg-active"),
                    entry.disabled && "opacity-50",
                  )}
                >
                  {entry.icon && <span className={cn("flex w-4 shrink-0 justify-center", entry.danger ? "text-red" : "text-fg-2")}>{entry.icon}</span>}
                  <span className="flex-1 truncate">{entry.label}</span>
                  {entry.hint && <span className="text-[12px] text-fg-3">{entry.hint}</span>}
                  {entry.shortcut && <Kbd keys={entry.shortcut} />}
                  {entry.checked && <Check size={14} className="shrink-0 text-fg" aria-hidden="true" />}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
