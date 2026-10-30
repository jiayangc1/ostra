import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { fuzzyScore } from "../lib/fuzzy.ts";
import { Dialog } from "./Dialog.tsx";
import { Kbd } from "./Kbd.tsx";

export interface CommandItem {
  id: string;
  title: string;
  group?: string;
  shortcut?: string;
  icon?: ReactNode;
  /** Extra text that matches the search but isn't shown. */
  keywords?: string;
  /** Right-aligned hint (e.g. "applied"). */
  hint?: ReactNode;
  checked?: boolean;
  disabled?: boolean;
  run: () => void;
}

export interface CommandMenuProps {
  items: CommandItem[];
  placeholder?: string;
  onDone: () => void;
  /** Keep the menu open after running (multi-select pickers). */
  keepOpen?: boolean;
  emptyText?: string;
  footer?: ReactNode;
}

/** The searchable list used by ⌘K and pickers (label, category, move). */
export function CommandMenu({ items, placeholder = "Type a command or search…", onDone, keepOpen, emptyText = "No results", footer }: CommandMenuProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    return items
      .map((item) => ({ item, score: Math.max(fuzzyScore(query, item.title), fuzzyScore(query, `${item.group ?? ""} ${item.keywords ?? ""}`) - 50) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.item);
  }, [items, query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const run = (item: CommandItem | undefined) => {
    if (!item || item.disabled) return;
    item.run();
    if (!keepOpen) onDone();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[cursor]);
    } else if (!query && /^[1-9]$/.test(e.key)) {
      // Pickers with numbered items: one keystroke.
      const hit = items.find((i) => i.shortcut === e.key);
      if (hit) {
        e.preventDefault();
        run(hit);
      }
    }
  };

  // Group headers in display order, but only when not searching (search is ranked).
  const grouped = !query.trim();

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <Search size={16} className="shrink-0 text-fg-3" aria-hidden="true" />
        <input
          data-autofocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={filtered[cursor] ? `${listId}-${filtered[cursor].id}` : undefined}
          className="h-12 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-3 focus-visible:outline-none"
        />
        <Kbd keys="esc" />
      </div>
      <div ref={listRef} id={listId} role="listbox" className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
        {filtered.length === 0 && <p className="px-3 py-8 text-center text-[13px] text-fg-3">{emptyText}</p>}
        {filtered.map((item, index) => {
          const showGroup = grouped && item.group && item.group !== filtered[index - 1]?.group;
          return (
            <div key={item.id}>
              {showGroup && <div className="px-2.5 pb-1 pt-2.5 font-mono text-[11px] uppercase tracking-wide text-fg-3">{item.group}</div>}
              <div
                id={`${listId}-${item.id}`}
                role="option"
                aria-selected={index === cursor}
                aria-disabled={item.disabled || undefined}
                data-index={index}
                onMouseMove={() => setCursor(index)}
                onClick={() => run(item)}
                className={cn(
                  "flex h-9 cursor-default items-center gap-2.5 rounded-control px-2.5 text-sm transition-colors duration-[var(--motion-instant)]",
                  index === cursor ? "bg-active text-fg" : "text-fg-2",
                  item.disabled && "opacity-50",
                )}
              >
                {item.icon && (
                  <span className={cn("flex w-4 shrink-0 justify-center transition-transform duration-[var(--motion-fast)] ease-spring", index === cursor && "translate-x-0.5")}>
                    {item.icon}
                  </span>
                )}
                <span className="flex-1 truncate">{item.title}</span>
                {item.checked !== undefined && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-[4px] border text-[10px] transition-colors",
                      item.checked ? "border-transparent bg-primary text-primary-fg" : "border-line-hover",
                    )}
                  >
                    {item.checked ? "✓" : ""}
                  </span>
                )}
                {item.hint && <span className="font-mono text-[11px] text-fg-3">{item.hint}</span>}
                {item.shortcut && <Kbd keys={item.shortcut} />}
              </div>
            </div>
          );
        })}
      </div>
      {footer && <div className="border-t border-line px-4 py-2 text-[12px] text-fg-3">{footer}</div>}
    </div>
  );
}

export interface CommandBarProps extends Omit<CommandMenuProps, "onDone"> {
  open: boolean;
  onClose: () => void;
  label?: string;
}

export function CommandBar({ open, onClose, label = "Command bar", ...menu }: CommandBarProps) {
  return (
    <Dialog open={open} onClose={onClose} label={label} placement="top" className="max-w-xl overflow-hidden">
      <CommandMenu {...menu} onDone={onClose} />
    </Dialog>
  );
}
