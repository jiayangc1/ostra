import { cn } from "../lib/cn.ts";

const SYMBOLS: Record<string, string> = {
  mod: isMac() ? "⌘" : "Ctrl",
  cmd: "⌘",
  shift: "⇧",
  alt: isMac() ? "⌥" : "Alt",
  enter: "↵",
  esc: "Esc",
  tab: "Tab",
  up: "↑",
  down: "↓",
  backspace: "⌫",
};

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** Pretty key caps for a shortcut like "mod+k", "g i", "#". */
export function Kbd({ keys, className }: { keys: string; className?: string }) {
  const sequence = keys.split(" ");
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {sequence.map((combo, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          {combo.split("+").map((k, j) => (
            <kbd
              key={j}
              className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line bg-hover px-1 font-sans text-[11px] font-medium leading-none text-fg-3"
            >
              {SYMBOLS[k.toLowerCase()] ?? (k.length === 1 ? k.toUpperCase() : k)}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  );
}
