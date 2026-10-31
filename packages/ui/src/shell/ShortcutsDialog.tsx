import { X } from "lucide-react";
import { Button } from "../components/Button.tsx";
import { Dialog } from "../components/Dialog.tsx";
import { Kbd } from "../components/Kbd.tsx";

const GROUPS: { title: string; items: { keys: string; label: string }[] }[] = [
  {
    title: "Navigate",
    items: [
      { keys: "j", label: "Next conversation" },
      { keys: "k", label: "Previous conversation" },
      { keys: "enter", label: "Open" },
      { keys: "esc", label: "Close / back" },
      { keys: "g i", label: "Go to Inbox" },
      { keys: "g s", label: "Go to Sent" },
      { keys: "g d", label: "Go to Drafts" },
      { keys: "g a", label: "Go to Archive" },
    ],
  },
  {
    title: "Act",
    items: [
      { keys: "e", label: "Archive" },
      { keys: "#", label: "Move to trash" },
      { keys: "!", label: "Mark as spam" },
      { keys: "shift+i", label: "Mark as read" },
      { keys: "shift+u", label: "Mark as unread" },
      { keys: "l", label: "Label" },
      { keys: "y", label: "Change category" },
    ],
  },
  {
    title: "Write",
    items: [
      { keys: "c", label: "New message" },
      { keys: "r", label: "Reply" },
      { keys: "a", label: "Reply all" },
      { keys: "f", label: "Forward" },
      { keys: "mod+enter", label: "Send" },
      { keys: "mod+j", label: "AI writing" },
    ],
  },
  {
    title: "App",
    items: [
      { keys: "mod+k", label: "Command bar" },
      { keys: "[", label: "Toggle sidebar" },
      { keys: "?", label: "This list" },
    ],
  },
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} label="Keyboard shortcuts" className="max-w-2xl">
      <div className="flex items-center justify-between border-b border-line py-3 pl-6 pr-3">
        <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
        <Button variant="tertiary" size="sm" iconOnly aria-label="Close" onClick={onClose}>
          <X size={15} />
        </Button>
      </div>
      <div className="grid max-h-[70vh] gap-x-10 gap-y-6 overflow-y-auto p-6 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title} className="flex flex-col gap-1">
            <h3 className="mb-1 text-[12px] font-medium text-fg-3">{g.title}</h3>
            {g.items.map((i) => (
              <div key={i.keys} className="flex h-7 items-center justify-between gap-4 text-[13px]">
                <span className="text-fg-2">{i.label}</span>
                <Kbd keys={i.keys} />
              </div>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  );
}
