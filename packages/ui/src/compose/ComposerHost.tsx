import { useState, type ReactNode } from "react";
import { useMailStore, useStore } from "../app/store.ts";
import type { ComposeRequest } from "../shell/Shell.tsx";
import { AiDraftLine } from "./AiDraftLine.tsx";
import { Composer } from "./Composer.tsx";
import { draftFor } from "./model.ts";

/** Owns the open composer; hands `compose` and the AI draft line to the shell. */
export function ComposerHost({ children }: { children: (api: { compose: (r: ComposeRequest) => void; readerFooter: (threadId: string) => ReactNode }) => ReactNode }) {
  const store = useMailStore();
  const own = useStore((s) => s.boot?.identities)?.map((i) => i.address) ?? [];
  const [open, setOpen] = useState<(ComposeRequest & { key: number }) | null>(null);

  const compose = (r: ComposeRequest) => setOpen((prev) => ({ ...r, key: (prev?.key ?? 0) + 1 }));

  const readerFooter = (threadId: string) => (
    <AiDraftLine
      threadId={threadId}
      onAccept={(draft) => {
        const last = store.getState().details[threadId]?.messages.at(-1);
        if (last) compose({ mode: "reply", message: last, threadId, body: draft });
      }}
    />
  );

  const initial = open ? { ...draftFor(open.mode, open.message, own), ...(open.body ? { body: open.body } : {}) } : null;

  return (
    <>
      {children({ compose, readerFooter })}
      {open && initial && <Composer key={open.key} mode={open.mode} initial={initial} threadId={open.threadId} onClose={() => setOpen(null)} />}
    </>
  );
}
