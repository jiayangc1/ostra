import type { ReactNode } from "react";
import type { Account, Label, VirtualFolder } from "@ostra/core";
import { Archive, File, Inbox, Moon, Plus, Send, Settings, ShieldAlert, Sun, Trash2, type LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { OstraLogo } from "../brand/logo.tsx";
import { Dot } from "../components/Dot.tsx";
import { Tooltip } from "../components/Tooltip.tsx";
import { cn } from "../lib/cn.ts";
import { useTheme } from "../theme.tsx";
import type { View } from "../app/store.ts";

export const FOLDERS: { folder: Exclude<VirtualFolder, "snoozed">; name: string; icon: LucideIcon; shortcut?: string }[] = [
  { folder: "inbox", name: "Inbox", icon: Inbox, shortcut: "g i" },
  { folder: "sent", name: "Sent", icon: Send, shortcut: "g s" },
  { folder: "drafts", name: "Drafts", icon: File, shortcut: "g d" },
  { folder: "spam", name: "Spam", icon: ShieldAlert },
  { folder: "trash", name: "Trash", icon: Trash2 },
  { folder: "archive", name: "Archive", icon: Archive },
];

interface Props {
  view: View;
  counts: Record<string, number>;
  labels: Label[];
  accounts: Account[];
  collapsed: boolean;
  hrefFor: (v: View) => string;
}

export function Sidebar({ view, counts, labels, accounts, collapsed, hrefFor }: Props) {
  const { resolved, setPreference } = useTheme();
  const accountId = view.kind === "folder" ? view.accountId : undefined;
  const folder = view.kind === "folder" ? view.folder : null;

  return (
    <nav aria-label="Mailboxes" className="flex h-full flex-col gap-5 overflow-y-auto px-2 py-3">
      <div className={cn("flex h-8 items-center px-2", collapsed && "justify-center px-0")}>
        <Link to={hrefFor({ kind: "folder", folder: "inbox" })} className="rounded-control" aria-label="Ostra inbox">
          <OstraLogo collapsed={collapsed} />
        </Link>
      </div>

      <ul className="flex flex-col gap-px">
        {FOLDERS.map((f) => (
          <li key={f.folder}>
            <NavItem
              to={hrefFor({ kind: "folder", folder: f.folder, accountId })}
              active={folder === f.folder}
              icon={<f.icon size={15} strokeWidth={1.75} />}
              label={f.name}
              count={counts[f.folder]}
              collapsed={collapsed}
              shortcut={f.shortcut}
            />
          </li>
        ))}
      </ul>

      <Section title="Labels" collapsed={collapsed} action={<Link to="/settings/labels" aria-label="Add label" className="o-press rounded-[4px] p-0.5 text-fg-3 hover:bg-hover hover:text-fg"><Plus size={12} /></Link>}>
        {labels.length === 0 && !collapsed && (
          <Link to="/settings/labels" className="px-2 text-[13px] text-fg-3 hover:text-fg">
            Add labels
          </Link>
        )}
        {labels.map((l) => (
          <NavItem
            key={l.id}
            to={hrefFor({ kind: "label", labelId: l.id })}
            active={view.kind === "label" && view.labelId === l.id}
            icon={<Dot color={l.color} />}
            label={l.name}
            collapsed={collapsed}
          />
        ))}
      </Section>

      <Section title="Accounts" collapsed={collapsed} action={<Link to="/settings/accounts" aria-label="Connect account" className="o-press rounded-[4px] p-0.5 text-fg-3 hover:bg-hover hover:text-fg"><Plus size={12} /></Link>}>
        {accounts.map((a) => (
          <NavItem
            key={a.id}
            to={hrefFor({ kind: "folder", folder: folder ?? "inbox", accountId: accountId === a.id ? undefined : a.id })}
            active={accountId === a.id}
            icon={<Dot color={a.color} />}
            label={a.displayName}
            collapsed={collapsed}
            hint={a.status === "needs_reauth" ? "!" : undefined}
            title={accountId === a.id ? "Show all accounts" : `Only ${a.displayName}`}
          />
        ))}
      </Section>

      <div className={cn("mt-auto flex items-center gap-1 px-1", collapsed && "flex-col")}>
        <Tooltip content="Settings" side="top">
          <Link to="/settings" aria-label="Settings" className="o-press flex h-7 w-7 items-center justify-center rounded-control text-fg-3 hover:bg-hover hover:text-fg">
            <Settings size={15} strokeWidth={1.75} />
          </Link>
        </Tooltip>
        <Tooltip content={resolved === "dark" ? "Light theme" : "Dark theme"} side="top">
          <button
            type="button"
            aria-label="Toggle theme"
            onClick={() => setPreference(resolved === "dark" ? "light" : "dark")}
            className="o-press flex h-7 w-7 items-center justify-center rounded-control text-fg-3 hover:bg-hover hover:text-fg"
          >
            {resolved === "dark" ? <Sun size={15} strokeWidth={1.75} /> : <Moon size={15} strokeWidth={1.75} />}
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}

function Section({ title, collapsed, action, children }: { title: string; collapsed: boolean; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-px">
      {!collapsed && (
        <div className="group flex h-6 items-center justify-between px-2">
          <h2 className="font-mono text-[11px] font-normal uppercase tracking-wide text-fg-3">{title}</h2>
          <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">{action}</span>
        </div>
      )}
      {children}
    </section>
  );
}

function NavItem({
  to,
  active,
  icon,
  label,
  count,
  collapsed,
  shortcut,
  hint,
  title,
}: {
  to: string;
  active: boolean;
  icon: ReactNode;
  label: string;
  count?: number | undefined;
  collapsed: boolean;
  shortcut?: string | undefined;
  hint?: string | undefined;
  title?: string | undefined;
}) {
  const link = (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      title={title}
      className={cn(
        "group o-press relative flex h-7 w-full items-center gap-2.5 rounded-control px-2 text-[13px]",
        active ? "bg-active text-fg" : "text-fg-2 hover:bg-hover hover:text-fg",
        collapsed && "justify-center px-0",
      )}
    >
      <span className={cn("flex w-4 shrink-0 items-center justify-center transition-transform duration-[var(--motion-fast)] ease-spring group-hover:translate-x-px", active ? "text-fg" : "text-fg-3")}>
        {icon}
      </span>
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && hint && <span className="font-mono text-[11px] text-amber">{hint}</span>}
      {!collapsed && !!count && <span className="font-mono text-[11px] text-fg-3">{count}</span>}
      {collapsed && !!count && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-blue" />}
    </Link>
  );
  if (shortcut && !collapsed)
    return (
      <Tooltip content={label} shortcut={shortcut} side="right" delay={700} className="flex w-full">
        {link}
      </Tooltip>
    );
  return link;
}
