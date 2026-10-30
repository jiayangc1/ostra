import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { Account, Color, Label } from "@ostra/core";
import { ArrowLeft, RefreshCw, Trash2, User } from "lucide-react";
import { Badge } from "../components/Badge.tsx";
import { Button } from "../components/Button.tsx";
import { Dialog } from "../components/Dialog.tsx";
import { Dot } from "../components/Dot.tsx";
import { Input } from "../components/Input.tsx";
import { Toggle } from "../components/Toggle.tsx";
import { cn } from "../lib/cn.ts";
import { useTheme, type ThemePreference } from "../theme.tsx";
import { useAuthState } from "../app/auth.tsx";
import { useHotkeys } from "../app/hotkeys.ts";
import { useMailStore, useStore } from "../app/store.ts";
import { ColorPicker, nextColor } from "./ColorPicker.tsx";
import { ConnectAccount, ResendWebhookStep } from "./ConnectAccount.tsx";

const SECTIONS = [
  { id: "accounts", name: "Accounts" },
  { id: "labels", name: "Labels" },
  { id: "preferences", name: "Preferences" },
] as const;

export function SettingsPage({ openExternal }: { openExternal?: (url: string) => void }) {
  const { section = "accounts" } = useParams();
  const navigate = useNavigate();
  const auth = useAuthState();
  useHotkeys([{ keys: "escape", run: () => navigate("/inbox") }]);

  useEffect(() => {
    document.title = "Settings · Ostra";
  }, []);

  return (
    <div className="flex h-full flex-col bg-canvas md:flex-row">
      <nav aria-label="Settings" className="flex shrink-0 flex-col gap-1 border-b border-line p-3 md:w-56 md:border-b-0 md:border-r">
        <Link to="/inbox" className="o-press mb-3 flex h-8 items-center gap-2 rounded-control px-2 text-[13px] text-fg-3 hover:bg-hover hover:text-fg">
          <ArrowLeft size={14} /> Back to mail
        </Link>
        <div className="flex gap-1 md:flex-col">
          {SECTIONS.map((s) => (
            <Link
              key={s.id}
              to={`/settings/${s.id}`}
              aria-current={section === s.id ? "page" : undefined}
              className={cn("o-press flex h-8 items-center rounded-control px-2 text-[13px]", section === s.id ? "bg-active text-fg" : "text-fg-2 hover:bg-hover hover:text-fg")}
            >
              {s.name}
            </Link>
          ))}
          {auth.openProfile && (
            <button type="button" onClick={auth.openProfile} className="o-press flex h-8 items-center gap-2 rounded-control px-2 text-left text-[13px] text-fg-2 hover:bg-hover hover:text-fg">
              <User size={13} /> Your Ostra account
            </button>
          )}
        </div>
      </nav>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-10">
          {section === "accounts" && <AccountsSection openExternal={openExternal} />}
          {section === "labels" && <LabelsSection />}
          {section === "preferences" && <PreferencesSection />}
        </div>
      </main>
    </div>
  );
}

function Header({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl">{title}</h1>
        <p className="text-[13px] text-fg-3">{description}</p>
      </div>
      {action}
    </header>
  );
}

const PROVIDER_NAMES: Record<Account["provider"], string> = { gmail: "Gmail", outlook: "Outlook", imap: "IMAP", resend: "Resend" };
const STATUS: Record<Account["status"], { text: string; tone: string }> = {
  connecting: { text: "connecting", tone: "text-fg-3" },
  syncing: { text: "syncing", tone: "text-blue" },
  active: { text: "in sync", tone: "text-fg-3" },
  needs_reauth: { text: "needs sign-in", tone: "text-amber" },
  error: { text: "error", tone: "text-red" },
  disconnected: { text: "disconnected", tone: "text-fg-3" },
};

function AccountsSection({ openExternal }: { openExternal?: ((url: string) => void) | undefined }) {
  const store = useMailStore();
  const boot = useStore((s) => s.boot);
  const [search, setSearch] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Account | null>(null);
  const [webhookFor, setWebhookFor] = useState<{ id: string; url: string } | null>(null);
  const accounts = boot?.accounts ?? [];

  // Returning from OAuth.
  useEffect(() => {
    const error = search.get("error");
    const connected = search.get("connected");
    if (!error && !connected) return;
    if (error) store.notify(error, { tone: "error" });
    if (connected) store.notify("Account connected. Syncing your mail now.");
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
    } else {
      store.notify("Remove the account and connect it again with the new password.");
    }
  };

  const showWebhook = async (a: Account) => {
    const { data } = await store.api.get<{ url: string }>(`/accounts/connect/resend/${a.id}/webhook`);
    setWebhookFor({ id: a.id, url: data.url });
  };

  return (
    <>
      <Header
        title="Accounts"
        description="Every address you own, in one inbox."
        action={!adding && accounts.length > 0 ? <Button onClick={() => setAdding(true)}>Connect account</Button> : undefined}
      />
      {(adding || accounts.length === 0) && (
        <section className="animate-slide-up rounded-window border border-line p-5">
          <ConnectAccount
            defaultColor={nextColor(accounts.map((a) => a.color))}
            returnTo="/settings/accounts"
            openExternal={openExternal}
            onConnected={() => {
              setAdding(false);
              void store.loadBootstrap();
              store.notify("Account connected. Syncing your mail now.");
            }}
          />
        </section>
      )}
      {webhookFor && (
        <Dialog open onClose={() => setWebhookFor(null)} label="Resend webhook" className="p-6">
          <ResendWebhookStep accountId={webhookFor.id} url={webhookFor.url} onDone={() => setWebhookFor(null)} />
        </Dialog>
      )}
      <ul className="flex flex-col divide-y divide-line rounded-window border border-line">
        {accounts.map((a) => (
          <li key={a.id} className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-3">
              <Dot color={a.color} size={10} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{a.displayName}</span>
                <span className="font-mono text-[11px] text-fg-3">
                  {PROVIDER_NAMES[a.provider]} · <span className={STATUS[a.status].tone}>{STATUS[a.status].text}</span>
                  {a.lastSyncedAt && ` · ${new Date(a.lastSyncedAt).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}`}
                </span>
              </div>
              {a.status === "needs_reauth" && (
                <Button size="sm" variant="primary" onClick={() => void reconnect(a)}>
                  Reconnect
                </Button>
              )}
              <Button size="sm" variant="tertiary" iconOnly aria-label={`Sync ${a.displayName} now`} onClick={() => void store.api.post(`/accounts/${a.id}/sync`).then(() => store.notify("Syncing."))}>
                <RefreshCw size={14} />
              </Button>
              <Button size="sm" variant="tertiary" iconOnly aria-label={`Remove ${a.displayName}`} onClick={() => setRemoving(a)}>
                <Trash2 size={14} />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pl-[22px]">
              <ColorPicker value={a.color} onChange={(color) => void update(a, { color })} label={`Color for ${a.displayName}`} />
              <Toggle size="sm" checked={a.aiEnabled} onChange={(aiEnabled) => void update(a, { aiEnabled })} label="AI for this account" />
              {a.provider === "resend" && (
                <button type="button" onClick={() => void showWebhook(a)} className="text-[13px] text-fg-3 underline decoration-line-strong underline-offset-2 hover:text-fg">
                  Receiving webhook
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={!!removing} onClose={() => setRemoving(null)} label="Remove account" className="flex flex-col gap-4 p-6">
        <h2 className="text-base">Remove {removing?.displayName}?</h2>
        <p className="text-[13px] text-fg-2">Ostra stops syncing it and deletes the mail it stored from this account. Nothing changes in the mailbox itself.</p>
        <div className="flex justify-end gap-2">
          <Button variant="tertiary" onClick={() => setRemoving(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              const a = removing!;
              setRemoving(null);
              await store.api.delete(`/accounts/${a.id}`);
              await store.loadBootstrap();
              store.notify(`Removed ${a.displayName}.`);
            }}
          >
            Remove
          </Button>
        </div>
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

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      await store.api.post("/labels", { name: name.trim(), color, description: description.trim() || null });
      setName("");
      setDescription("");
      await store.loadBootstrap();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the label.");
    }
  };

  const patch = async (l: Label, body: Partial<Label>) => {
    await store.api.patch(`/labels/${l.id}`, body);
    await store.loadBootstrap();
  };

  return (
    <div className="flex flex-col gap-4">
      {labels.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-window border border-line">
          {labels.map((l) => (
            <li key={l.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-center gap-3">
                <Badge color={l.color}>{l.name}</Badge>
                <span className="min-w-0 flex-1 truncate text-[13px] text-fg-3">{l.description}</span>
                {!compact && <ColorPicker value={l.color} onChange={(c) => void patch(l, { color: c })} label={`Color for ${l.name}`} />}
                <Button
                  size="sm"
                  variant="tertiary"
                  iconOnly
                  aria-label={`Delete ${l.name}`}
                  onClick={async () => {
                    await store.api.delete(`/labels/${l.id}`);
                    await store.loadBootstrap();
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-col gap-3 rounded-window border border-dashed border-line-hover p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
          <Input size="sm" label="New label" value={name} onChange={(e) => setName(e.target.value)} placeholder="Press" maxLength={40} error={error ?? undefined} />
          <Input size="sm" label="What belongs here" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Journalists and podcast invites" description="Helps auto-labeling." />
        </div>
        <div className="flex items-center justify-between gap-3">
          <ColorPicker value={color} onChange={setColor} label="New label color" />
          <Button type="submit" size="sm" disabled={!name.trim()}>
            Add label
          </Button>
        </div>
      </form>
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
      <Header title="Preferences" description="How Ostra looks and what its AI may do." />
      <section className="flex flex-col gap-5 rounded-window border border-line p-5">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Theme</span>
          <div role="radiogroup" aria-label="Theme" className="flex w-fit gap-1 rounded-control border border-line p-0.5">
            {(["dark", "light", "system"] as ThemePreference[]).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={preference === t}
                onClick={() => setPreference(t)}
                className={cn("o-press h-7 rounded-[4px] px-3 text-[13px] capitalize", preference === t ? "bg-active text-fg" : "text-fg-3 hover:text-fg")}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Default from address</span>
          <span className="text-[13px] text-fg-3">Used for new mail to people you haven't written to before.</span>
          <select
            value={s.defaultIdentityId ?? ""}
            onChange={(e) => save({ defaultIdentityId: e.target.value || null })}
            className="h-9 w-full max-w-sm rounded-control border border-line bg-canvas px-2 text-sm text-fg hover:border-line-hover"
          >
            <option value="">First connected account</option>
            {boot.identities.map((i) => (
              <option key={i.id} value={i.id}>
                {i.displayName ? `${i.displayName} <${i.address}>` : i.address}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section className="flex flex-col gap-5 rounded-window border border-line p-5">
        <Toggle checked={s.aiEnabled} onChange={(aiEnabled) => save({ aiEnabled })} label="AI features" description="Sorting, auto-labels, drafts and the pre-send check. Off means no mail content is sent to a model." />
        <Toggle checked={s.autoLabel} disabled={!s.aiEnabled} onChange={(autoLabel) => save({ autoLabel })} label="Auto-label incoming mail" description="Applies your labels as mail arrives. You can turn AI off per account and per label too." />
        {!boot.ai.available && <p className="font-mono text-[11px] text-fg-3">AI isn't configured on this server: Ostra sorts with rules only.</p>}
      </section>
    </>
  );
}
