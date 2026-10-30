import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import type { CalendarConnection } from "@ostra/core";
import { Apple, ArrowLeft, CalendarDays, ExternalLink, RefreshCw, Server, Trash2 } from "lucide-react";
import { Button } from "../components/Button.tsx";
import { Dialog } from "../components/Dialog.tsx";
import { Input } from "../components/Input.tsx";
import { Toggle } from "../components/Toggle.tsx";
import { useMailStore, useStore } from "../app/store.ts";
import { GoogleMark, MicrosoftMark } from "./ConnectAccount.tsx";

type Kind = "google" | "microsoft" | "icloud" | "caldav";

const OPTIONS: { kind: Kind; name: string; blurb: string; icon: ReactNode }[] = [
  { kind: "google", name: "Google Calendar", blurb: "Sign in with Google", icon: <GoogleMark /> },
  { kind: "microsoft", name: "Outlook Calendar", blurb: "Microsoft 365 or outlook.com", icon: <MicrosoftMark /> },
  { kind: "icloud", name: "Apple Calendar", blurb: "iCloud, with an app-specific password", icon: <Apple size={16} strokeWidth={1.75} /> },
  { kind: "caldav", name: "Other CalDAV", blurb: "Fastmail, Nextcloud, any CalDAV server", icon: <Server size={16} strokeWidth={1.75} /> },
];

const PROVIDER: Record<CalendarConnection["provider"], string> = { google: "Google", microsoft: "Outlook", caldav: "CalDAV" };

export function CalendarsSection({ openExternal, header }: { openExternal?: ((url: string) => void) | undefined; header: (title: string, description: string, action?: ReactNode) => ReactNode }) {
  const store = useMailStore();
  const boot = useStore((s) => s.boot);
  const calendars = useStore((s) => s.calendars);
  const [search, setSearch] = useSearchParams();
  const [form, setForm] = useState<"icloud" | "caldav" | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [removing, setRemoving] = useState<CalendarConnection | null>(null);
  const list = calendars ?? [];
  const settings = boot?.settings;

  useEffect(() => {
    void store.loadCalendars().catch(() => {});
  }, [store]);

  // Returning from Google or Microsoft sign-in.
  useEffect(() => {
    const error = search.get("error");
    const connected = search.get("calendarConnected");
    if (!error && !connected) return;
    if (error) store.notify(error, { tone: "error" });
    if (connected) store.notify("Calendar connected.");
    void store.loadCalendars().catch(() => {});
    void store.loadBootstrap().catch(() => {});
    setSearch({}, { replace: true });
  }, [search, setSearch, store]);

  const oauth = async (provider: "google" | "microsoft", loginHint?: string) => {
    setBusy(provider);
    try {
      const { data } = await store.api.post<{ url: string }>(`/calendars/oauth/${provider}/start`, { returnTo: "/settings/calendars", ...(loginHint ? { loginHint } : {}) });
      (openExternal ?? ((u: string) => window.location.assign(u)))(data.url);
    } catch (err) {
      store.notify(err instanceof Error ? err.message : "Couldn't start sign-in.", { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const connected = async () => {
    setForm(null);
    setAdding(false);
    await Promise.all([store.loadCalendars(), store.loadBootstrap()]).catch(() => {});
    store.notify("Calendar connected.");
  };

  const reconnect = (c: CalendarConnection) => {
    if (c.provider === "google" || c.provider === "microsoft") return void oauth(c.provider, c.account);
    setForm(c.serverLabel === "iCloud" ? "icloud" : "caldav");
    setAdding(true);
  };

  const allCalendars = list.flatMap((conn) => conn.calendars.map((cal) => ({ conn, cal })));
  const defaultValue = settings?.defaultCalendar ? `${settings.defaultCalendar.connectionId}|${settings.defaultCalendar.calendarId}` : "";
  const save = (patch: Parameters<typeof store.updateSettings>[0]) => void store.updateSettings(patch).catch((err: Error) => store.notify(err.message, { tone: "error" }));
  const showPicker = adding || (calendars !== null && list.length === 0);

  return (
    <>
      {header("Calendars", "Add events from your mail to Google, Outlook or Apple Calendar.", !showPicker && list.length > 0 ? <Button onClick={() => setAdding(true)}>Connect calendar</Button> : undefined)}

      {showPicker && (
        <section className="flex animate-slide-up flex-col gap-4 rounded-window border border-line p-5">
          {form ? (
            <>
              <button type="button" onClick={() => setForm(null)} className="o-press flex w-fit items-center gap-1.5 rounded-control text-[13px] text-fg-3 hover:text-fg">
                <ArrowLeft size={14} /> All calendars
              </button>
              <CalDavForm kind={form} onDone={() => void connected()} />
            </>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {OPTIONS.map((o) => (
                <button
                  key={o.kind}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => (o.kind === "google" || o.kind === "microsoft" ? void oauth(o.kind) : setForm(o.kind))}
                  className="group o-press flex items-start gap-3 rounded-card border border-line bg-surface p-4 text-left hover:-translate-y-px hover:border-line-hover hover:bg-hover disabled:opacity-60"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-line bg-canvas text-fg">{o.icon}</span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-fg">{busy === o.kind ? "Opening…" : o.name}</span>
                    <span className="text-[13px] text-fg-3">{o.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="text-[12px] text-fg-3">Ostra only adds events you choose. It doesn't read what's already on your calendar.</p>
        </section>
      )}

      {list.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-window border border-line">
          {list.map((c) => (
            <li key={c.id} className="flex items-center gap-3 p-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-line bg-surface text-fg">
                {c.provider === "google" ? <GoogleMark /> : c.provider === "microsoft" ? <MicrosoftMark /> : c.serverLabel === "iCloud" ? <Apple size={15} strokeWidth={1.75} /> : <CalendarDays size={15} strokeWidth={1.75} />}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{c.account}</span>
                <span className="truncate font-mono text-[11px] text-fg-3">
                  {c.serverLabel ?? PROVIDER[c.provider]} · {c.calendars.length} {c.calendars.length === 1 ? "calendar" : "calendars"}
                  {c.status === "needs_reauth" && <span className="text-amber"> · needs sign-in</span>}
                </span>
              </div>
              {c.status === "needs_reauth" && (
                <Button size="sm" variant="primary" onClick={() => reconnect(c)}>
                  Reconnect
                </Button>
              )}
              <Button
                size="sm"
                variant="tertiary"
                iconOnly
                aria-label={`Refresh calendars for ${c.account}`}
                onClick={() =>
                  void store.api.post(`/calendars/${c.id}/refresh`).then(
                    () => store.loadCalendars(),
                    (err: Error) => {
                      store.notify(err.message, { tone: "error" });
                      return store.loadCalendars();
                    },
                  )
                }
              >
                <RefreshCw size={14} />
              </Button>
              <Button size="sm" variant="tertiary" iconOnly aria-label={`Remove ${c.account}`} onClick={() => setRemoving(c)}>
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {settings && (
        <section className="flex flex-col gap-5 rounded-window border border-line p-5">
          {allCalendars.length > 0 && (
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Default calendar</span>
              <span className="text-[13px] text-fg-3">“Add to calendar” puts events here. Pick another one from the arrow next to it.</span>
              <select
                value={defaultValue}
                onChange={(e) => {
                  const [connectionId, calendarId] = e.target.value.split("|");
                  save({ defaultCalendar: connectionId && calendarId ? { connectionId, calendarId } : null });
                }}
                className="h-9 w-full max-w-sm rounded-control border border-line bg-canvas px-2 text-sm text-fg hover:border-line-hover"
              >
                {list.map((conn) => (
                  <optgroup key={conn.id} label={conn.serverLabel ? `${conn.account} (${conn.serverLabel})` : conn.account}>
                    {conn.calendars.map((cal) => (
                      <option key={cal.id} value={`${conn.id}|${cal.id}`}>
                        {cal.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          )}
          <Toggle
            checked={settings.findEvents}
            disabled={!settings.aiEnabled}
            onChange={(findEvents) => save({ findEvents })}
            label="Find events in message text"
            description="Spots plans like “dinner Thursday at 7” using AI. Calendar invites (.ics) are always read, and verification codes are found without AI."
          />
          {!boot.ai.available && <p className="font-mono text-[11px] text-fg-3">AI isn't configured on this server: only invites become events.</p>}
        </section>
      )}

      <Dialog open={!!removing} onClose={() => setRemoving(null)} label="Remove calendar" className="flex flex-col gap-4 p-6">
        <h2 className="text-base">Remove {removing?.account}?</h2>
        <p className="text-[13px] text-fg-2">Ostra forgets this login. Events you already added stay on the calendar.</p>
        <div className="flex justify-end gap-2">
          <Button variant="tertiary" onClick={() => setRemoving(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              const c = removing!;
              setRemoving(null);
              try {
                await store.api.delete(`/calendars/${c.id}`);
                await Promise.all([store.loadCalendars(), store.loadBootstrap()]);
              } catch (err) {
                store.notify(err instanceof Error ? err.message : "Couldn't remove it.", { tone: "error" });
              }
            }}
          >
            Remove
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function CalDavForm({ kind, onDone }: { kind: "icloud" | "caldav"; onDone: () => void }) {
  const store = useMailStore();
  const [serverUrl, setServerUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const apple = kind === "icloud";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await store.api.post("/calendars/caldav", { username, password, ...(apple ? {} : { serverUrl }) });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't connect.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base">{apple ? "Apple Calendar" : "CalDAV calendar"}</h2>
        {apple ? (
          <p className="text-[13px] text-fg-3">
            Apple doesn't offer sign-in for other apps, so iCloud uses an app-specific password: a separate password just for Ostra that you can revoke any time.
          </p>
        ) : (
          <p className="text-[13px] text-fg-3">Most servers list their CalDAV address in their help pages. Use an app password if your provider has them.</p>
        )}
      </div>
      {apple && (
        <ol className="flex list-decimal flex-col gap-1 rounded-card border border-line bg-surface py-3 pl-8 pr-4 text-[13px] text-fg-2">
          <li>
            Go to{" "}
            <a href="https://account.apple.com/account/manage" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-fg underline decoration-line-strong underline-offset-2">
              account.apple.com <ExternalLink size={11} />
            </a>{" "}
            and sign in.
          </li>
          <li>Open Sign-In and Security, then App-Specific Passwords.</li>
          <li>Create one named “Ostra” and paste it below.</li>
        </ol>
      )}
      {!apple && <Input label="Server" placeholder="caldav.fastmail.com" required value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} autoComplete="url" />}
      <Input label={apple ? "Apple ID" : "Username"} type={apple ? "email" : "text"} placeholder={apple ? "you@icloud.com" : undefined} required value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
      <Input
        label={apple ? "App-specific password" : "Password"}
        type="password"
        placeholder={apple ? "xxxx-xxxx-xxxx-xxxx" : undefined}
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="off"
        error={error ?? undefined}
        description="Checked with the server, then stored encrypted."
      />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={busy}>
          Connect
        </Button>
      </div>
    </form>
  );
}
