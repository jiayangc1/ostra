import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Kbd } from "../components/Kbd.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { useMailStore, useStore } from "../app/store.ts";

/**
 * One muted line under the reader with a suggested reply. Tab opens it in
 * the composer. Only shown when AI is available and allowed for the thread.
 */
export function AiDraftLine({ threadId, onAccept }: { threadId: string; onAccept: (draft: string) => void }) {
  const store = useMailStore();
  const available = useStore((s) => !!s.boot?.ai.available && !!s.boot?.settings.aiEnabled);
  const category = useStore((s) => s.threads[threadId]?.category);
  const lastId = useStore((s) => s.details[threadId]?.messages.at(-1)?.id);
  const [state, setState] = useState<{ key: string; draft: string | null; loading: boolean } | null>(null);
  const key = `${threadId}:${lastId ?? ""}`;
  const enabled = available && category === "primary" && !!lastId;

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    store.api
      .get<{ draft: string | null }>(`/ai/suggestion/${threadId}`, { timeout: 60_000 })
      .then(({ data }) => alive && setState({ key, draft: data.draft, loading: false }))
      .catch(() => alive && setState({ key, draft: null, loading: false }));
    return () => {
      alive = false;
    };
  }, [enabled, key, threadId, store]);

  const current = state?.key === key ? state : { key, draft: null, loading: enabled };

  // Tab accepts, unless the user is tabbing between controls.
  useEffect(() => {
    if (!current.draft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const a = document.activeElement as HTMLElement | null;
      const onList = !a || a === document.body || !!a.closest("[role=listbox]") || a.tagName === "ARTICLE";
      if (!onList || document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      onAccept(current.draft!);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current.draft, onAccept]);

  if (!enabled || (!current.loading && !current.draft)) return null;
  return (
    <div className="shrink-0 border-t border-line px-6 py-3">
      {current.loading ? (
        <div className="flex items-center gap-3" aria-label="Drafting a reply">
          <Sparkles size={13} className="shrink-0 text-fg-3" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onAccept(current.draft!)}
          className="group flex w-full animate-fade-in items-center gap-3 text-left"
          aria-label="Open the suggested reply in the composer"
        >
          <Sparkles size={13} className="shrink-0 text-fg-3 transition-colors group-hover:text-fg" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-fg-3 transition-colors group-hover:text-fg-2">{current.draft!.replace(/\s+/g, " ")}</span>
          <Kbd keys="tab" />
        </button>
      )}
    </div>
  );
}
