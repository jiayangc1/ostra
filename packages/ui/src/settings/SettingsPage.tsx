import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { COLORS, type Account, type Color, type Label } from "@ostra/core";
import { ArrowLeft, AtSign, Globe, LogOut, Mail, Monitor, Moon, MoreHorizontal, Plus, RefreshCw, Server, SlidersHorizontal, Sun, Tag, Trash2, User, Webhook } from "lucide-react";
import { Badge } from "../components/Badge.tsx";
import { Button } from "../components/Button.tsx";
import { Dialog, DialogBody, DialogFooter } from "../components/Dialog.tsx";
import { Dot } from "../components/Dot.tsx";
import { Input } from "../components/Input.tsx";
import { Menu, type MenuEntry } from "../components/Menu.tsx";
import { Segmented } from "../components/Segmented.tsx";
import { Select } from "../components/Select.tsx";
import { Toggle } from "../components/Toggle.tsx";
import { cn } from "../lib/cn.ts";
import { useTheme, type ThemePreference } from "../theme.tsx";
import { useAuthState } from "../app/auth.tsx";
import { useHotkeys } from "../app/hotkeys.ts";
import { useMailStore, useStore } from "../app/store.ts";
import { ColorPicker, nextColor } from "./ColorPicker.tsx";
import { ConnectAccount, ResendWebhookStep } from "./ConnectAccount.tsx";

const SECTIONS = [
  { id: "accounts", name: "Accounts", icon: Mail },
  { id: "labels", name: "Labels", icon: Tag },
  { id: "preferences", name: "Preferences", icon: SlidersHorizontal },
] as const;

export function SettingsPage({ openExternal }: { openExternal?: (url: string) => void }) {
  const { section = "accounts" } = useParams();
  const navigate = useNavigate();
  const auth = useAuthState();
  const store = useMailStore();
  useHotkeys([{ keys: "escape", run: () => navigate("/inbox") }]);

  useEffect(() => {
    document.title = "Settings · Ostra";
  }, []);

  const navItem = "o-press flex h-8 shrink-0 items-center gap-2.5 rounded-control px-2 text-[13px]";

  return (
    <div className="flex h-full flex-col bg-frame md:flex-row">
      <nav aria-label="Settings" className="flex shrink-0 flex-col gap-1 px-3 pb-2 pt-3 md:w-[240px] md:pb-3">
        <Link to="/inbox" className={cn(navItem, "group mb-2 text-fg-2 hover:bg-hover hover:text-fg")}>
          <ArrowLeft size={15} strokeWidth={1.75} className="transition-transform duration-[var(--motion-fast)] ease-spring group-hover:-translate-x-0.5" />
          Back to mail
        </Link>
        <p className="hidden px-2 pb-1 text-[12px] font-medium text-fg-3 md:block">Settings</p>
        <div className="-mx-3 flex gap-1 overflow-x-auto px-3 md:mx-0 md:flex-col md:overflow-visible md:px-0">
          {SECTIONS.map((s) => (
            <Link
              key={s.id}
              to={`/settings/${s.id}`}
              aria-current={section === s.id ? "page" : undefined}
              className={cn(navItem, section === s.id ? "bg-active font-medium text-fg" : "text-fg-2 hover:bg-hover hover:text-fg")}
            >
              <s.icon size={15} strokeWidth={1.75} className={section === s.id ? "text-fg" : "text-fg-3"} />
              {s.name}
            </Link>
          ))}
          <span className="mx-1 hidden h-px bg-line md:my-2 md:block" aria-hidden="true" />
          {auth.openProfile && (
            <button type="button" onClick={auth.openProfile} className={cn(navItem, "text-left text-fg-2 hover:bg-hover hover:text-fg")}>
              <User size={15} strokeWidth={1.75} className="text-fg-3" /> Your Ostra account
            </button>
          )}
          <button type="button" onClick={() => void store.clearCache().then(() => auth.signOut())} className={cn(navItem, "text-left text-fg-2 hover:bg-hover hover:text-fg")}>
            <LogOut size={15} strokeWidth={1.75} className="text-fg-3" /> Sign out
          </button>
        </div>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 p-0 sm:p-2 md:pl-0">
        <main className="min-h-0 flex-1 overflow-y-auto bg-panel shadow-panel sm:rounded-[10px]">
          <div key={section} className="mx-auto flex max-w-[680px] animate-slide-up flex-col gap-8 px-5 py-8 sm:px-8 sm:py-12">
            {section === "accounts" && <AccountsSection openExternal={openExternal} />}
            {section === "labels" && <LabelsSection />}
            {section === "preferences" && <PreferencesSection />}
          </div>
        </main>
      </div>
    </div>
  );
}

function Header({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
      <div className="flex max-w-[420px] flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">{title}</h1>
        <p className="text-[13px] leading-relaxed text-fg-2">{description}</p>
      </div>
      {action}
    </header>
  );
}

/** A titled group of settings rows inside one bordered surface. */
function Group({ title, description, children }: { title?: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      {(title || description) && (
        <div className="flex flex-col gap-0.5">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {description && <p className="text-[13px] text-fg-3">{description}</p>}
        </div>
      )}
      <div className="flex flex-col divide-y divide-line overflow-hidden rounded-window border border-line">{children}</div>
    </section>
  );
}

/** Label and description on the left, the control on the right; stacks on phones. */
function SettingRow({ label, description, children, htmlFor }: { label: ReactNode; description?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg">
          {label}
        </label>
        {description && <p className="text-[13px] leading-relaxed text-fg-3">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const PROVIDER: Record<Account["provider"], { name: string; icon: ReactNode }> = {
  gmail: { name: "Gmail", icon: <AtSign size={15} strokeWidth={1.75} /> },
  outlook: { name: "Outlook", icon: <Mail size={15} strokeWidth={1.75} /> },
  imap: { name: "IMAP", icon: <Server size={15} strokeWidth={1.75} /> },
  resend: { name: "Resend", icon: <Globe size={15} strokeWidth={1.75} /> },
};

const STATUS: Record<Account["status"], { text: string; dot: string; pulse?: boolean }> = {
  connecting: { text: "Connecting", dot: "bg-fg-3", pulse: true },
  syncing: { text: "Syncing", dot: "bg-blue", pulse: true },
  active: { text: "In sync", dot: "bg-green" },
  needs_reauth: { text: "Needs sign-in", dot: "bg-amber" },
  error: { text: "Error", dot: "bg-red" },
  disconnected: { text: "Disconnected", dot: "bg-fg-3" },
};

function StatusPill({ status }: { status: Account["status"] }) {
  const s = STATUS[status];
  return (
    <span className="inline-flex h-5 items-center gap-1.5 rounded-full border border-line px-2 text-[11px] font-medium text-fg-2">
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot, s.pulse && "animate-pulse")} />
      {s.text}
    </span>
  );
}

function AccountsSection({ openExternal }: { openExternal?: ((url: string) => void) | undefined }) {
  const store = useMailStore();
  const boot = useStore((s) => s.boot);
  const [search, setSearch] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Account | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [webhookFor, setWebhookFor] = useState<{ id: string; url: string } | null>(null);
  const [passwordFor, setPasswordFor] = useState<Account | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const accounts = boot?.accounts ?? [];

  // Returning from OAuth.
  useEffect(() => {
    const error = search.get("error");
    const connected = search.get("connected");
    if (!error && !connected) return;
    if (error) store.notify(error, { tone: "error" });
    if (connected) store.notify("Account connected. Syncing your mail now.", { tone: "success" });
    void store.loadBootstrap();
    setSearch({}, { replace: true });
  }, [search, setSearch, store]);

  const update = async (a: Account, patch: Partial<Pick<Account, "color" | "displayName" | "aiEnabled">>) => {
    try {
      await store.api.patch(`/accounts/${a.id}`, patch);
      await store.loadBootstrap();
    } catch (err) {
      store.notify(err instanceof Error ? err.message : "Couldn't save.", { tone: "error" });
    }
  };

  const reconnect = async (a: Account) => {
    if (a.provider === "gmail" || a.provider === "outlook") {
      const { data } = await store.api.post<{ url: string }>(`/accounts/oauth/${a.provider}/start`, { reconnectAccountId: a.id, returnTo: "/settings/accounts" });
      (openExternal ?? ((u: string) => window.location.assign(u)))(data.url);
    } else if (a.provider === "imap") {
      setPassword("");
      setPasswordError(null);
      setPasswordFor(a);
    } else {
      store.notify("Check the API key in Resend, then remove and connect this domain again.");
    }
  };

  // From the inbox banner: start reconnecting right away.
  const reconnectId = search.get("reconnect");
  useEffect(() => {
    if (!reconnectId) return;
    const a = accounts.find((x) => x.id === reconnectId);
    if (!a) return;
    const t = setTimeout(() => {
      setSearch({}, { replace: true });
      void reconnect(a);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnectId, accounts.length]);

  const showWebhook = async (a: Account) => {
    try {
      const { data } = await store.api.get<{ url: string }>(`/accounts/connect/resend/${a.id}/webhook`);
      setWebhookFor({ id: a.id, url: data.url });
    } catch (err) {
      store.notify(err instanceof Error ? err.message : "Couldn't load the webhook.", { tone: "error" });
    }
  };

  const sync = (a: Account) =>
    void store.api.post(`/accounts/${a.id}/sync`).then(
      () => store.notify(`Syncing ${a.displayName}.`),
      (err: Error) => store.notify(err.message, { tone: "error" }),
    );

  return (
    <>
      <Header
        title="Accounts"
        description="Every address you own, in one inbox. Each keeps its own color so you can tell at a glance where mail arrived."
        action={
          !adding && accounts.length > 0 ? (
            <Button variant="primary" prefix={<Plus size={14} />} onClick={() => setAdding(true)}>
              Connect account
            </Button>
          ) : undefined
        }
      />
      {(adding || accounts.length === 0) && (
        <section className="flex animate-slide-down flex-col gap-4 rounded-window border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Connect an account</h2>
            {accounts.length > 0 && (
              <Button size="sm" variant="tertiary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            )}
          </div>
          <ConnectAccount
            defaultColor={nextColor(accounts.map((a) => a.color))}
            returnTo="/settings/accounts"
            openExternal={openExternal}
            onConnected={() => {
              setAdding(false);
              void store.loadBootstrap();
              store.notify("Account connected. Syncing your mail now.", { tone: "success" });
            }}
          />
        </section>
      )}
      {webhookFor && (
        <Dialog open onClose={() => setWebhookFor(null)} label="Resend webhook">
          <DialogBody>
            <ResendWebhookStep accountId={webhookFor.id} url={webhookFor.url} onDone={() => setWebhookFor(null)} />
          </DialogBody>
        </Dialog>
      )}
      {accounts.length > 0 && (
        <ul className="flex flex-col gap-3">
          {accounts.map((a) => {
            const actions: MenuEntry[] = [
              { id: "sync", label: "Sync now", icon: <RefreshCw size={14} />, onSelect: () => sync(a) },
              ...(a.provider === "resend" ? [{ id: "webhook", label: "Receiving webhook", icon: <Webhook size={14} />, onSelect: () => void showWebhook(a) }] : []),
              ...(a.status === "needs_reauth" || a.status === "error" ? [{ id: "reconnect", label: "Reconnect", icon: <RefreshCw size={14} />, onSelect: () => void reconnect(a) }] : []),
              { id: "sep", separator: true as const },
              { id: "remove", label: "Remove account", icon: <Trash2 size={14} />, danger: true, onSelect: () => setRemoving(a) },
            ];
            return (
              <li key={a.id} className="overflow-hidden rounded-window border border-line bg-panel shadow-raised">
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-fg-2">
                    {PROVIDER[a.provider].icon}
                    <span className="absolute -bottom-0.5 -right-0.5 flex rounded-full ring-2 ring-panel">
                      <Dot color={a.color} size={9} />
                    </span>
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-sm font-medium">{a.displayName}</span>
                    <span className="flex flex-wrap items-center gap-2 text-[12px] text-fg-3">
                      <span>{PROVIDER[a.provider].name}</span>
                      <StatusPill status={a.status} />
                      {a.lastSyncedAt && (
                        <span className="font-mono text-[11px]">
                          {new Date(a.lastSyncedAt).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}
                        </span>
                      )}
                    </span>
                  </div>
                  {a.status === "needs_reauth" && (
                    <Button size="sm" variant="primary" onClick={() => void reconnect(a)}>
                      Reconnect
                    </Button>
                  )}
                  <Menu
                    label={`${a.displayName} actions`}
                    items={actions}
                    align="end"
                    width={200}
                    trigger={(props, open) => (
                      <Button {...props} size="sm" variant="tertiary" iconOnly aria-label={`Actions for ${a.displayName}`} className={cn(open && "bg-hover text-fg")}>
                        <MoreHorizontal size={15} />
                      </Button>
                    )}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line bg-surface px-4 py-2.5">
                  <ColorPicker value={a.color} onChange={(color) => void update(a, { color })} label={`Color for ${a.displayName}`} />
                  <Toggle size="sm" checked={a.aiEnabled} onChange={(aiEnabled) => void update(a, { aiEnabled })} label="AI for this account" />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={!!passwordFor} onClose={() => setPasswordFor(null)} label="Reconnect account">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setPasswordBusy(true);
            setPasswordError(null);
            try {
              await store.api.put(`/accounts/connect/imap/${passwordFor!.id}/password`, { password });
              setPasswordFor(null);
              await store.loadBootstrap();
              store.notify("Reconnected. Syncing now.", { tone: "success" });
            } catch (err) {
              setPasswordError(err instanceof Error ? err.message : "Couldn't reconnect.");
            } finally {
              setPasswordBusy(false);
            }
          }}
        >
          <DialogBody title={`Reconnect ${passwordFor?.displayName ?? ""}`} description="Ostra checks the new password with your mail server before saving it.">
            <Input label="New password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} error={passwordError ?? undefined} />
          </DialogBody>
          <DialogFooter>
            <Button variant="tertiary" onClick={() => setPasswordFor(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={passwordBusy}>
              Reconnect
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
      <Dialog open={!!removing} onClose={() => setRemoving(null)} label="Remove account">
        <DialogBody
          title={`Remove ${removing?.displayName ?? "account"}?`}
          description="Ostra stops syncing it and deletes the mail it stored from this account. Nothing changes in the mailbox itself."
        />
        <DialogFooter>
          <Button variant="tertiary" onClick={() => setRemoving(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={removeBusy}
            onClick={async () => {
              const a = removing!;
              setRemoveBusy(true);
              try {
                await store.api.delete(`/accounts/${a.id}`);
                await store.loadBootstrap();
                setRemoving(null);
                store.notify(`Removed ${a.displayName}.`);
              } catch (err) {
                store.notify(err instanceof Error ? err.message : "Couldn't remove the account.", { tone: "error" });
              } finally {
                setRemoveBusy(false);
              }
            }}
          >
            Remove account
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

export function LabelsEditor({ compact = false }: { compact?: boolean }) {
  const store = useMailStore();
  const labels = useStore((s) => s.boot?.labels) ?? [];
  const [name, setName] = useState("");
  const [color, setColor] = useState<Color>("blue");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Label | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await store.api.post("/labels", { name: name.trim(), color, description: description.trim() || null });
      setName("");
      setDescription("");
      await store.loadBootstrap();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the label.");
    } finally {
      setBusy(false);
    }
  };

  const patch = async (l: Label, body: Partial<Label>) => {
    try {
      await store.api.patch(`/labels/${l.id}`, body);
      await store.loadBootstrap();
    } catch (err) {
      store.notify(err instanceof Error ? err.message : "Couldn't save.", { tone: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={add} className="flex flex-col gap-3 rounded-window border border-line bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
          <Input size="sm" label="New label" value={name} onChange={(e) => setName(e.target.value)} placeholder="Press" maxLength={40} error={error ?? undefined} />
          <Input size="sm" label="What belongs here" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Journalists and podcast invites" description="Helps auto-labeling." />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ColorPicker value={color} onChange={setColor} label="New label color" />
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!name.trim()} prefix={<Plus size={13} />}>
            Add label
          </Button>
        </div>
      </form>
      {labels.length > 0 && (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-window border border-line">
          {labels.map((l) => (
            <li key={l.id} className="group flex animate-fade-in items-center gap-3 px-4 py-3 transition-colors hover:bg-hover">
              <Badge color={l.color}>{l.name}</Badge>
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg-3">{l.description}</span>
              {!compact && (
                <Menu
                  label={`Color for ${l.name}`}
                  align="end"
                  width={168}
                  items={COLORS.map((c) => ({ id: c, label: c[0]!.toUpperCase() + c.slice(1), icon: <Dot color={c} />, checked: l.color === c, onSelect: () => void patch(l, { color: c }) }))}
                  trigger={(props) => (
                    <button {...props} type="button" aria-label={`Color for ${l.name}`} className="o-press flex h-7 items-center gap-1.5 rounded-control px-2 text-fg-3 hover:bg-active hover:text-fg">
                      <Dot color={l.color} size={10} />
                    </button>
                  )}
                />
              )}
              <Button size="sm" variant="tertiary" iconOnly aria-label={`Delete ${l.name}`} className="hover:text-red" onClick={() => setDeleting(l)}>
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!deleting} onClose={() => setDeleting(null)} label="Delete label">
        <DialogBody title={`Delete “${deleting?.name ?? ""}”?`} description="It comes off every conversation it's on. The mail itself stays where it is." />
        <DialogFooter>
          <Button variant="tertiary" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              const l = deleting!;
              setDeleting(null);
              try {
                await store.api.delete(`/labels/${l.id}`);
                await store.loadBootstrap();
                store.notify(`Deleted ${l.name}.`);
              } catch (err) {
                store.notify(err instanceof Error ? err.message : "Couldn't delete the label.", { tone: "error" });
              }
            }}
          >
            Delete label
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

function LabelsSection() {
  return (
    <>
      <Header title="Labels" description="Shared across all your accounts. Ostra applies them automatically as mail arrives; press l on any message to fix one." />
      <LabelsEditor />
    </>
  );
}

function PreferencesSection() {
  const store = useMailStore();
  const boot = useStore((s) => s.boot);
  const { preference, setPreference } = useTheme();
  if (!boot) return null;
  const s = boot.settings;
  const save = (patch: Parameters<typeof store.updateSettings>[0]) => void store.updateSettings(patch).catch((err: Error) => store.notify(err.message, { tone: "error" }));

  return (
    <>
      <Header title="Preferences" description="How Ostra looks, where new mail comes from, and what its AI may do." />
      <Group title="Appearance">
        <SettingRow label="Theme" description="System follows your device.">
          <Segmented<ThemePreference>
            label="Theme"
            value={preference}
            onChange={setPreference}
            options={[
              { value: "dark", label: "Dark", icon: <Moon size={13} /> },
              { value: "light", label: "Light", icon: <Sun size={13} /> },
              { value: "system", label: "System", icon: <Monitor size={13} /> },
            ]}
          />
        </SettingRow>
      </Group>
      <Group title="Sending">
        <SettingRow label="Default from address" description="Used for new mail to people you haven't written to before." htmlFor="default-from">
          <Select id="default-from" size="sm" value={s.defaultIdentityId ?? ""} onChange={(e) => save({ defaultIdentityId: e.target.value || null })} className="w-full sm:w-64">
            <option value="">First connected account</option>
            {boot.identities.map((i) => (
              <option key={i.id} value={i.id}>
                {i.displayName ? `${i.displayName} <${i.address}>` : i.address}
              </option>
            ))}
          </Select>
        </SettingRow>
      </Group>
      <Group title="AI" description={!boot.ai.available ? "AI isn't configured on this server, so Ostra sorts with rules only." : undefined}>
        <div className="px-4 py-4">
          <Toggle checked={s.aiEnabled} onChange={(aiEnabled) => save({ aiEnabled })} label="AI features" description="Sorting, auto-labels, drafts and the pre-send check. Off means no mail content is sent to a model." />
        </div>
        <div className="px-4 py-4">
          <Toggle
            checked={s.autoLabel}
            disabled={!s.aiEnabled}
            onChange={(autoLabel) => save({ autoLabel })}
            label="Auto-label incoming mail"
            description="Applies your labels as mail arrives. You can turn AI off per account and per label too."
          />
        </div>
      </Group>
    </>
  );
}
