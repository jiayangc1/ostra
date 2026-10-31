import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Account, Label, VirtualFolder } from "@ostra/core";
import { Archive, ChevronDown, ChevronRight, File, Inbox, Keyboard, LogOut, Monitor, Moon, PenSquare, Plus, Search, Send, Settings, ShieldAlert, Sun, Trash2, User, type LucideIcon } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { Avatar } from "../components/Avatar.tsx";
import { Dot } from "../components/Dot.tsx";
import { Kbd } from "../components/Kbd.tsx";
import { Menu, type MenuEntry } from "../components/Menu.tsx";
import { Tooltip } from "../components/Tooltip.tsx";
import { cn } from "../lib/cn.ts";
import { useTheme } from "../theme.tsx";
import { useAuthState } from "../app/auth.tsx";
import { useMailStore, useStore, type View } from "../app/store.ts";

export const FOLDERS: { folder: Exclude<VirtualFolder, "snoozed">; name: string; icon: LucideIcon; shortcut?: string }[] = [
  { folder: "inbox", name: "Inbox", icon: Inbox, shortcut: "g i" },
  { folder: "sent", name: "Sent", icon: Send, shortcut: "g s" },
  { folder: "drafts", name: "Drafts", icon: File, shortcut: "g d" },
  { folder: "archive", name: "Archive", icon: Archive, shortcut: "g a" },
  { folder: "spam", name: "Spam", icon: ShieldAlert },
  { folder: "trash", name: "Trash", icon: Trash2 },
];

interface Props {
  view: View;
  counts: Record<string, number>;
  labels: Label[];
  accounts: Account[];
  hrefFor: (v: View) => string;
  onCompose?: (() => void) | undefined;
  onCommand: () => void;
  onShortcuts: () => void;
  /** Called after any navigation, so the mobile drawer can close. */
  onNavigate?: () => void;
}

const SECTIONS_KEY = "ostra:sidebar-sections";

function readSections(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function Sidebar({ view, counts, labels, accounts, hrefFor, onCompose, onCommand, onShortcuts, onNavigate }: Props) {
  const accountId = view.kind === "folder" ? view.accountId : undefined;
  const folder = view.kind === "folder" ? view.folder : null;
  const connection = useStore((s) => s.connection);
  const [sections, setSections] = useState(readSections);
  const content = useRef<HTMLDivElement>(null);
  const highlight = useRef<HTMLSpanElement>(null);

  const toggleSection = (id: string) =>
    setSections((s) => {
      const next = { ...s, [id]: !(s[id] ?? true) };
      try {
        localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });

  // One highlight slides between nav items instead of each item lighting up on its own.
  const activeKey = view.kind === "label" ? `label:${view.labelId}` : `${view.folder}@${view.accountId ?? ""}`;
  useLayoutEffect(() => {
    const root = content.current;
    const hl = highlight.current;
    if (!root || !hl) return;
    let first = !hl.dataset.placed;
    const place = () => {
      const el = root.querySelector<HTMLElement>("[data-nav-active]");
      const hidden = !el || el.closest<HTMLElement>(".o-expand")?.dataset.open === "false";
      if (!el || hidden) {
        hl.style.opacity = "0";
        return;
      }
      const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top;
      hl.style.transition = first ? "none" : "";
      hl.style.transform = `translateY(${top}px)`;
      hl.style.height = `${el.offsetHeight}px`;
      hl.style.opacity = "1";
      hl.dataset.placed = "1";
      first = false;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(root);
    return () => ro.disconnect();
  }, [activeKey, labels.length, accounts.length, sections]);

  const go = () => onNavigate?.();

  return (
    <nav aria-label="Mailboxes" className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 px-3 pb-2 pt-3">
        <UserMenu onShortcuts={onShortcuts} />
        {onCompose && (
          <Tooltip content="New message" shortcut="c" align="end">
            <button
              type="button"
              aria-label="New message"
              onClick={onCompose}
              className="o-press flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-line-hover bg-panel text-fg shadow-raised hover:border-line-strong hover:bg-hover"
            >
              <PenSquare size={15} strokeWidth={1.75} />
            </button>
          </Tooltip>
        )}
      </div>

      <div className="shrink-0 px-3 pb-3">
        <button
          type="button"
          onClick={onCommand}
          className="o-press group flex h-8 w-full items-center gap-2 rounded-control px-2 text-[13px] text-fg-3 hover:bg-hover hover:text-fg-2"
        >
          <Search size={15} strokeWidth={1.75} className="shrink-0" />
          <span className="flex-1 text-left">Search or jump to…</span>
          <Kbd keys="mod+k" className="opacity-80 transition-opacity group-hover:opacity-100" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div ref={content} className="relative flex flex-col gap-4">
          <span
            ref={highlight}
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 rounded-control bg-active opacity-0 transition-[transform,height,opacity] duration-[var(--motion-normal)] ease-out"
          />
          <ul className="flex flex-col gap-px">
            {FOLDERS.map((f) => (
              <li key={f.folder}>
                <NavItem
                  to={hrefFor({ kind: "folder", folder: f.folder, accountId })}
                  active={folder === f.folder}
                  icon={<f.icon size={15} strokeWidth={1.75} />}
                  label={f.name}
                  count={counts[f.folder]}
                  shortcut={f.shortcut}
                  onClick={go}
                />
              </li>
            ))}
          </ul>

          <Section
            id="labels"
            title="Labels"
            open={sections.labels ?? true}
            onToggle={() => toggleSection("labels")}
            action={
              <Link to="/settings/labels" aria-label="Manage labels" className="o-press flex h-5 w-5 items-center justify-center rounded-[4px] text-fg-3 hover:bg-hover hover:text-fg">
                <Plus size={13} />
              </Link>
            }
          >
            {labels.length === 0 && (
              <Link to="/settings/labels" className="flex h-7 items-center gap-2.5 rounded-control px-2 text-[13px] text-fg-3 hover:bg-hover hover:text-fg">
                <Plus size={14} className="w-4" /> Add a label
              </Link>
            )}
            {labels.map((l) => (
              <NavItem
                key={l.id}
                to={hrefFor({ kind: "label", labelId: l.id })}
                active={view.kind === "label" && view.labelId === l.id}
                icon={<Dot color={l.color} />}
                label={l.name}
                onClick={go}
              />
            ))}
          </Section>

          <Section
            id="accounts"
            title="Accounts"
            open={sections.accounts ?? true}
            onToggle={() => toggleSection("accounts")}
            action={
              <Link to="/settings/accounts" aria-label="Connect account" className="o-press flex h-5 w-5 items-center justify-center rounded-[4px] text-fg-3 hover:bg-hover hover:text-fg">
                <Plus size={13} />
              </Link>
            }
          >
            {accounts.length === 0 && (
              <Link to="/settings/accounts" className="flex h-7 items-center gap-2.5 rounded-control px-2 text-[13px] text-fg-3 hover:bg-hover hover:text-fg">
                <Plus size={14} className="w-4" /> Connect an account
              </Link>
            )}
            {accounts.map((a) => (
              <NavItem
                key={a.id}
                to={hrefFor({ kind: "folder", folder: folder ?? "inbox", accountId: accountId === a.id ? undefined : a.id })}
                active={accountId === a.id}
                icon={<Dot color={a.color} />}
                label={a.displayName}
                hint={a.status === "needs_reauth" ? <span className="h-1.5 w-1.5 rounded-full bg-amber" aria-label="Needs sign-in" /> : undefined}
                title={accountId === a.id ? "Show all accounts" : `Only ${a.displayName}`}
                onClick={go}
              />
            ))}
          </Section>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t border-line px-3 py-2">
        <span className="flex min-w-0 flex-1 items-center gap-2 px-2 text-[12px] text-fg-3" role="status">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-[var(--motion-slow)]",
              connection === "online" ? "bg-green" : connection === "connecting" ? "animate-pulse bg-amber" : "bg-fg-3",
            )}
          />
          <span className="truncate">{connection === "online" ? "Up to date" : connection === "connecting" ? "Connecting…" : "Offline"}</span>
        </span>
        <Tooltip content="Keyboard shortcuts" shortcut="?" side="top" align="end">
          <button type="button" aria-label="Keyboard shortcuts" onClick={onShortcuts} className="o-press flex h-7 w-7 items-center justify-center rounded-control text-fg-3 hover:bg-hover hover:text-fg">
            <Keyboard size={15} strokeWidth={1.75} />
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}

function UserMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const auth = useAuthState();
  const store = useMailStore();
  const navigate = useNavigate();
  const { preference, setPreference } = useTheme();
  const boot = useStore((s) => s.boot);
  const name = auth.user?.name || boot?.user.name || auth.user?.email?.split("@")[0] || "You";
  const email = auth.user?.email ?? boot?.user.email ?? "";

  const items: MenuEntry[] = [
    { id: "who", heading: email || name },
    { id: "settings", label: "Settings", icon: <Settings size={14} />, onSelect: () => navigate("/settings") },
    ...(auth.openProfile ? [{ id: "profile", label: "Your Ostra account", icon: <User size={14} />, onSelect: auth.openProfile }] : []),
    { id: "shortcuts", label: "Keyboard shortcuts", icon: <Keyboard size={14} />, shortcut: "?", onSelect: onShortcuts },
    { id: "sep1", separator: true },
    { id: "theme", heading: "Theme" },
    { id: "dark", label: "Dark", icon: <Moon size={14} />, checked: preference === "dark", onSelect: () => setPreference("dark") },
    { id: "light", label: "Light", icon: <Sun size={14} />, checked: preference === "light", onSelect: () => setPreference("light") },
    { id: "system", label: "System", icon: <Monitor size={14} />, checked: preference === "system", onSelect: () => setPreference("system") },
    { id: "sep2", separator: true },
    { id: "signout", label: "Sign out", icon: <LogOut size={14} />, onSelect: () => void store.clearCache().then(() => auth.signOut()) },
  ];

  return (
    <Menu
      label="Account"
      items={items}
      width={232}
      trigger={(props, open) => (
        <button
          {...props}
          type="button"
          className={cn("o-press flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control px-1.5 text-left hover:bg-hover", open && "bg-hover")}
        >
          <Avatar name={name} seed={email || name} size={22} imageUrl={auth.user?.imageUrl} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{name}</span>
          <ChevronDown size={14} className={cn("shrink-0 text-fg-3 transition-transform duration-[var(--motion-normal)] ease-spring", open && "rotate-180")} />
        </button>
      )}
    />
  );
}

function Section({ id, title, open, onToggle, action, children }: { id: string; title: string; open: boolean; onToggle: () => void; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col" aria-labelledby={`nav-${id}`}>
      <div className="group/section flex h-7 items-center justify-between pl-2 pr-1">
        <button
          id={`nav-${id}`}
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="o-press -ml-1 flex items-center gap-1 rounded-[4px] px-1 py-0.5 text-[12px] font-medium text-fg-3 hover:text-fg-2"
        >
          {title}
          <ChevronRight size={12} className={cn("transition-transform duration-[var(--motion-normal)] ease-spring", open && "rotate-90")} />
        </button>
        <span className="opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover/section:opacity-100 focus-within:opacity-100">{action}</span>
      </div>
      <div className="o-expand" data-open={open}>
        <div className="flex flex-col gap-px" inert={!open}>
          {children}
        </div>
      </div>
    </section>
  );
}

function NavItem({
  to,
  active,
  icon,
  label,
  count,
  shortcut,
  hint,
  title,
  onClick,
}: {
  to: string;
  active: boolean;
  icon: ReactNode;
  label: string;
  count?: number | undefined;
  shortcut?: string | undefined;
  hint?: ReactNode;
  title?: string | undefined;
  onClick?: () => void;
}) {
  const link = (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      data-nav-active={active || undefined}
      title={title}
      onClick={onClick}
      className={cn(
        "group/nav o-press relative flex h-7 w-full items-center gap-2.5 rounded-control px-2 text-[13px]",
        active ? "font-medium text-fg" : "text-fg-2 hover:bg-hover hover:text-fg",
      )}
    >
      <span className={cn("flex w-4 shrink-0 items-center justify-center transition-[translate,color] duration-[var(--motion-fast)] ease-spring group-hover/nav:translate-x-px", active ? "text-fg" : "text-fg-3 group-hover/nav:text-fg-2")}>
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {hint}
      {!!count && <span className={cn("font-mono text-[11px] tabular-nums", active ? "text-fg-2" : "text-fg-3")}>{count}</span>}
    </Link>
  );
  if (shortcut)
    return (
      <Tooltip content={label} shortcut={shortcut} side="right" delay={700} className="flex w-full">
        {link}
      </Tooltip>
    );
  return link;
}
