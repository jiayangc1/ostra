import { useEffect, useRef } from "react";

export interface Hotkey {
  /** "j", "#", "mod+k", "mod+enter", or a two-key sequence "g i". */
  keys: string;
  run: (e: KeyboardEvent) => void;
  /** Fire even while typing in an input (e.g. mod+enter, escape). */
  inInputs?: boolean;
  enabled?: boolean;
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

function matches(combo: string, e: KeyboardEvent): boolean {
  const parts = combo.toLowerCase().split("+");
  const key = parts[parts.length - 1]!;
  const mod = parts.includes("mod");
  const shift = parts.includes("shift");
  const wantMod = mod ? e.metaKey || e.ctrlKey : !(e.metaKey || e.ctrlKey);
  if (!wantMod || e.altKey) return false;
  const k = e.key.toLowerCase();
  const named: Record<string, string> = { enter: "enter", escape: "escape", esc: "escape", tab: "tab", up: "arrowup", down: "arrowdown" };
  if (named[key]) return k === named[key] && (shift ? e.shiftKey : !e.shiftKey || key === "tab");
  // Symbols like # and ! already encode shift.
  if (key.length === 1 && !/[a-z0-9]/.test(key)) return e.key === key;
  return k === key && (shift ? e.shiftKey : !e.shiftKey);
}

/**
 * Global keyboard shortcuts with two-key sequences (g i). The latest
 * bindings are read through a ref so callers can pass inline closures.
 */
export function useHotkeys(bindings: Hotkey[], enabled = true) {
  const ref = useRef(bindings);
  useEffect(() => {
    ref.current = bindings;
  });

  useEffect(() => {
    if (!enabled) return;
    let pending: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const typing = isTyping(e);
      const list = ref.current.filter((b) => b.enabled !== false && (!typing || b.inInputs));
      if (pending) {
        const seq = list.find((b) => b.keys.includes(" ") && b.keys.split(" ")[0] === pending && matches(b.keys.split(" ")[1]!, e));
        pending = null;
        if (timer) clearTimeout(timer);
        if (seq) {
          e.preventDefault();
          seq.run(e);
          return;
        }
      }
      const starter = list.find((b) => b.keys.includes(" ") && matches(b.keys.split(" ")[0]!, e));
      if (starter && !typing) {
        pending = starter.keys.split(" ")[0]!;
        timer = setTimeout(() => (pending = null), 1200);
        return;
      }
      const hit = list.find((b) => !b.keys.includes(" ") && matches(b.keys, e));
      if (hit) {
        e.preventDefault();
        hit.run(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);
}
