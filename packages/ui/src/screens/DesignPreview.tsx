import type { ReactNode } from "react";
import { useState } from "react";
import { Archive, Inbox, Mail, Moon, Sun, Tag } from "lucide-react";
import { COLORS } from "@ostra/core";
import { OstraLogo } from "../brand/logo.tsx";
import { Badge } from "../components/Badge.tsx";
import { Button } from "../components/Button.tsx";
import { CommandBar } from "../components/CommandBar.tsx";
import { Dot } from "../components/Dot.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { Input } from "../components/Input.tsx";
import { Kbd } from "../components/Kbd.tsx";
import { ListRow } from "../components/ListRow.tsx";
import { ListSkeleton } from "../components/Skeleton.tsx";
import { useToast } from "../components/Toast.tsx";
import { Toggle } from "../components/Toggle.tsx";
import { Tooltip } from "../components/Tooltip.tsx";
import { useTheme } from "../theme.tsx";

/** Living reference for the design system. Mounted at /design in development. */
export function DesignPreview() {
  const { resolved, setPreference } = useTheme();
  const toast = useToast();
  const [on, setOn] = useState(true);
  const [cmd, setCmd] = useState(false);
  const [active, setActive] = useState(1);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-10">
      <header className="flex items-center justify-between">
        <OstraLogo />
        <Button
          variant="tertiary"
          iconOnly
          aria-label="Toggle theme"
          onClick={() => setPreference(resolved === "dark" ? "light" : "dark")}
        >
          {resolved === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
      </header>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Send</Button>
          <Button>Secondary</Button>
          <Button variant="tertiary">Tertiary</Button>
          <Button variant="danger">Delete</Button>
          <Button variant="primary" loading>
            Sending
          </Button>
          <Button disabled>Disabled</Button>
          <Button size="sm" prefix={<Archive size={14} />}>
            Archive
          </Button>
          <Tooltip content="Archive" shortcut="e">
            <Button iconOnly aria-label="Archive" variant="tertiary">
              <Archive size={16} />
            </Button>
          </Tooltip>
        </div>
      </Section>

      <Section title="Inputs">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Email" placeholder="you@company.com" description="We'll use this to sign you in." />
          <Input label="IMAP host" defaultValue="imap.example" error="Couldn't reach this host." />
        </div>
      </Section>

      <Section title="Badges and dots">
        <div className="flex flex-wrap items-center gap-2">
          {COLORS.map((c) => (
            <Badge key={c} color={c}>
              {c}
            </Badge>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {COLORS.map((c) => (
            <Dot key={c} color={c} label={c} />
          ))}
        </div>
      </Section>

      <Section title="Toggle and keys">
        <Toggle checked={on} onChange={setOn} label="Auto-label incoming mail" description="Labels are applied as mail arrives." />
        <div className="flex items-center gap-3">
          <Kbd keys="mod+k" />
          <Kbd keys="g i" />
          <Kbd keys="#" />
          <Kbd keys="mod+enter" />
        </div>
      </Section>

      <Section title="List rows">
        <div role="listbox" className="overflow-hidden rounded-card border border-line">
          {["Ada Lovelace", "Linus", "Grace Hopper"].map((name, i) => (
            <ListRow key={name} active={i === active} selected={i === 0} unread={i !== 2} onClick={() => setActive(i)} leading={<Dot color={COLORS[i]!} className="mt-1.5" />}>
              <div className="flex items-baseline gap-2">
                <span className="truncate font-medium">{name}</span>
                <span className="ml-auto font-mono text-[11px] text-fg-3">{i + 2}m</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] text-fg-2">Re: Launch plan for next week</span>
                <Badge color="purple">Investors</Badge>
              </div>
            </ListRow>
          ))}
          <ListRow leading={<Mail size={14} className="mt-0.5 text-fg-3" />}>
            <span className="text-[13px] text-fg-2">
              Newsletters <span className="font-mono text-fg-3">· 12</span>
            </span>
          </ListRow>
        </div>
        <div className="overflow-hidden rounded-card border border-line">
          <ListSkeleton rows={3} />
        </div>
      </Section>

      <Section title="Overlays">
        <div className="flex gap-2">
          <Button onClick={() => setCmd(true)} suffix={<Kbd keys="mod+k" />}>
            Command bar
          </Button>
          <Button onClick={() => toast({ message: "Archived", action: { label: "Undo", onClick: () => {} } })}>Toast</Button>
          <Button onClick={() => toast({ message: "Couldn't archive. Restored.", tone: "error" })}>Error toast</Button>
        </div>
        <CommandBar
          open={cmd}
          onClose={() => setCmd(false)}
          items={[
            { id: "inbox", title: "Go to Inbox", group: "Navigate", shortcut: "g i", icon: <Inbox size={14} />, run: () => {} },
            { id: "label", title: "Label…", group: "Actions", shortcut: "l", icon: <Tag size={14} />, run: () => {} },
            { id: "archive", title: "Archive", group: "Actions", shortcut: "e", icon: <Archive size={14} />, run: () => {} },
          ]}
        />
      </Section>

      <Section title="Empty state">
        <div className="rounded-card border border-line">
          <EmptyState icon={<Inbox size={20} />} title="You're caught up." description="New mail from every account lands here." />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-mono text-[11px] font-normal uppercase tracking-wide text-fg-3">{title}</h2>
      {children}
    </section>
  );
}
