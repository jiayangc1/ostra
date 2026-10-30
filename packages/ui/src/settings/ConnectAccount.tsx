import type { ReactNode } from "react";
import { useState, type FormEvent } from "react";
import { guessServers, presetById, presetForAddress, type Color, type ImapPreset } from "@ostra/core";
import { ArrowLeft, ArrowUpRight, AtSign, Check, Cloud, Copy, Globe, Mail, Server } from "lucide-react";
import { Button } from "../components/Button.tsx";
import { Input } from "../components/Input.tsx";
import { Toggle } from "../components/Toggle.tsx";
import { cn } from "../lib/cn.ts";
import { ApiError } from "../app/api.ts";
import { useMailStore } from "../app/store.ts";
import { ColorPicker } from "./ColorPicker.tsx";

type Kind = "gmail" | "outlook" | "icloud" | "yahoo" | "imap" | "resend";

const PROVIDERS: { kind: Kind; name: string; blurb: string; icon: ReactNode }[] = [
  { kind: "gmail", name: "Gmail", blurb: "Google Workspace or gmail.com", icon: <GoogleMark /> },
  { kind: "outlook", name: "Outlook", blurb: "Microsoft 365 or outlook.com", icon: <MicrosoftMark /> },
  { kind: "icloud", name: "iCloud Mail", blurb: "icloud.com, me.com or your iCloud+ domain", icon: <Cloud size={16} strokeWidth={1.75} /> },
  { kind: "yahoo", name: "Yahoo Mail", blurb: "yahoo.com or ymail.com", icon: <AtSign size={16} strokeWidth={1.75} /> },
  { kind: "imap", name: "Other (IMAP)", blurb: "Fastmail, Zoho, any mail host", icon: <Server size={16} strokeWidth={1.75} /> },
  { kind: "resend", name: "Resend", blurb: "Your domain, sent and received via Resend", icon: <Globe size={16} strokeWidth={1.75} /> },
];

/** Providers connected with just an address and an app password. */
const APP_PASSWORD: Partial<Record<Kind, string>> = { gmail: "gmail", icloud: "icloud", yahoo: "yahoo" };

export interface ConnectAccountProps {
  defaultColor: Color;
  /** Where OAuth providers send the user back to. */
  returnTo: string;
  onConnected: () => void;
  /** Opens a URL outside the app (desktop); defaults to navigating this window. */
  openExternal?: (url: string) => void;
}

/** Provider picker plus the per-provider connect forms. */
export function ConnectAccount({ defaultColor, returnTo, onConnected, openExternal }: ConnectAccountProps) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [color, setColor] = useState<Color>(defaultColor);
  const store = useMailStore();
  const [busy, setBusy] = useState<Kind | null>(null);

  const oauth = async (k: "gmail" | "outlook") => {
    setBusy(k);
    try {
      const { data } = await store.api.post<{ url: string }>(`/accounts/oauth/${k}/start`, { color, returnTo });
      (openExternal ?? ((u: string) => window.location.assign(u)))(data.url);
    } catch (err) {
      store.notify(err instanceof Error ? err.message : "Couldn't start sign-in.", { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  if (kind && kind !== "outlook") {
    const preset = APP_PASSWORD[kind] ? presetById(APP_PASSWORD[kind]) : null;
    return (
      <div className="flex animate-slide-up flex-col gap-5">
        <button type="button" onClick={() => setKind(null)} className="o-press flex w-fit items-center gap-1.5 rounded-control text-[13px] text-fg-3 hover:text-fg">
          <ArrowLeft size={14} /> All providers
        </button>
        {kind === "gmail" && (
          <>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">Gmail</h3>
                <p className="text-[13px] text-fg-3">Sign in with Google, or connect with an app password instead.</p>
              </div>
              <Button variant="secondary" loading={busy === "gmail"} prefix={<GoogleMark />} className="self-start" onClick={() => void oauth("gmail")}>
                Sign in with Google
              </Button>
            </div>
            <div className="flex items-center gap-3 text-[12px] text-fg-3">
              <span className="h-px flex-1 bg-line" />
              or use an app password
              <span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}
        {kind === "resend" ? (
          <ResendForm color={color} onColor={setColor} onDone={onConnected} />
        ) : (
          <ImapForm preset={preset} heading={kind !== "gmail"} color={color} onColor={setColor} onDone={onConnected} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {PROVIDERS.map((p) => (
          <button
            key={p.kind}
            type="button"
            disabled={busy !== null}
            onClick={() => (p.kind === "outlook" ? void oauth(p.kind) : setKind(p.kind))}
            className="group o-press flex items-start gap-3 rounded-card border border-line bg-surface p-4 text-left hover:-translate-y-px hover:border-line-hover hover:bg-hover disabled:opacity-60"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-line bg-canvas text-fg">{p.icon}</span>
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-fg">{busy === p.kind ? "Opening…" : p.name}</span>
              <span className="text-[13px] text-fg-3">{p.blurb}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[13px] text-fg-3">Account color</span>
        <ColorPicker value={color} onChange={setColor} label="Account color" />
      </div>
    </div>
  );
}

function errorText(err: unknown) {
  return err instanceof ApiError || err instanceof Error ? err.message : "Couldn't connect.";
}

/**
 * With `preset`, the servers are fixed and only the address and app password are
 * asked for (this also covers custom domains hosted there). Without it, servers
 * are guessed from the address and can be edited.
 */
function ImapForm({
  preset: fixed,
  heading = true,
  color,
  onColor,
  onDone,
}: {
  preset?: ImapPreset | null;
  heading?: boolean;
  color: Color;
  onColor: (c: Color) => void;
  onDone: () => void;
}) {
  const store = useMailStore();
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [servers, setServers] = useState(() => (fixed ? { imap: fixed.imap, smtp: fixed.smtp } : guessServers("")));
  const [touchedServers, setTouchedServers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preset = fixed ?? presetForAddress(address);

  const onAddress = (v: string) => {
    setAddress(v);
    if (!fixed && !touchedServers) {
      const p = presetForAddress(v);
      setServers(p ? { imap: p.imap, smtp: p.smtp } : guessServers(v));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // App passwords are often shown in groups ("abcd efgh ..."); the spaces aren't part of them.
    const pass = fixed ? password.replace(/\s+/g, "") : password;
    try {
      await store.api.post("/accounts/connect/imap", {
        address,
        displayName: name || null,
        color,
        imap: { ...servers.imap, user: address, pass },
        smtp: { ...servers.smtp, user: address, pass },
      });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const server = (which: "imap" | "smtp") => (
    <div className="grid grid-cols-[1fr_88px] gap-2">
      <Input
        size="sm"
        label={`${which.toUpperCase()} host`}
        value={servers[which].host}
        onChange={(e) => {
          setTouchedServers(true);
          setServers((s) => ({ ...s, [which]: { ...s[which], host: e.target.value } }));
        }}
      />
      <Input
        size="sm"
        label="Port"
        inputMode="numeric"
        value={String(servers[which].port)}
        onChange={(e) => {
          setTouchedServers(true);
          const port = Number(e.target.value) || 0;
          setServers((s) => ({ ...s, [which]: { ...s[which], port, secure: port === 993 || port === 465 } }));
        }}
      />
    </div>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {heading && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">{fixed ? fixed.name : "IMAP / SMTP"}</h3>
          <p className="text-[13px] text-fg-3">
            {fixed ? "Connect with your address and an app password." : "Your password is encrypted before it's stored and never logged."}
          </p>
        </div>
      )}
      <Input
        label="Email address"
        type="email"
        autoComplete="email"
        required
        value={address}
        onChange={(e) => onAddress(e.target.value)}
        placeholder={fixed ? `you@${fixed.domains[0]}` : "you@yourdomain.com"}
      />
      <Input label="Your name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shown to people you email" />
      <Input
        label={fixed ? "App password" : "Password"}
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        description={
          <>
            {preset?.passwordHint ?? "Most providers need an app password here, not your login password."}
            {preset?.passwordUrl && (
              <>
                {" "}
                <a href={preset.passwordUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-fg underline-offset-2 hover:underline">
                  Create one <ArrowUpRight size={12} />
                </a>
              </>
            )}
          </>
        }
      />
      {!fixed && <Toggle size="sm" checked={advanced} onChange={setAdvanced} label={preset ? `Server settings (${preset.name})` : "Server settings"} />}
      {!fixed && advanced && (
        <div className="flex animate-slide-down flex-col gap-3 rounded-card border border-line p-3">
          {server("imap")}
          {server("smtp")}
        </div>
      )}
      <div className="flex items-center gap-3">
        <span className="text-[13px] text-fg-3">Color</span>
        <ColorPicker value={color} onChange={onColor} />
      </div>
      {error && (
        <p role="alert" className="animate-slide-down rounded-control border border-red/30 bg-red-bg px-3 py-2 text-[13px] text-red">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" loading={busy} prefix={<Mail size={14} />} className="self-start">
        Connect
      </Button>
    </form>
  );
}

function ResendForm({ color, onColor, onDone }: { color: Color; onColor: (c: Color) => void; onDone: () => void }) {
  const store = useMailStore();
  const [apiKey, setApiKey] = useState("");
  const [domain, setDomain] = useState("");
  const [local, setLocal] = useState("hello");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; webhookUrl: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await store.api.post<{ id: string; webhookUrl: string }>("/accounts/connect/resend", {
        apiKey,
        domain,
        address: `${local}@${domain}`,
        displayName: name || null,
        color,
      });
      setCreated(data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (created) return <ResendWebhookStep accountId={created.id} url={created.webhookUrl} onDone={onDone} />;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Resend</h3>
        <p className="text-[13px] text-fg-3">Send and receive on a domain you've verified in Resend, with receiving turned on.</p>
      </div>
      <Input label="API key" type="password" required value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="re_…" description="Needs full access. Encrypted at rest." />
      <Input label="Domain" required value={domain} onChange={(e) => setDomain(e.target.value.trim().toLowerCase())} placeholder="yourdomain.com" />
      <Input label="Address" required value={local} onChange={(e) => setLocal(e.target.value.trim().toLowerCase())} suffix={<span className="font-mono text-[12px]">@{domain || "domain"}</span>} />
      <Input label="Your name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shown to people you email" />
      <div className="flex items-center gap-3">
        <span className="text-[13px] text-fg-3">Color</span>
        <ColorPicker value={color} onChange={onColor} />
      </div>
      {error && (
        <p role="alert" className="animate-slide-down rounded-control border border-red/30 bg-red-bg px-3 py-2 text-[13px] text-red">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" loading={busy} className="self-start">
        Continue
      </Button>
    </form>
  );
}

/** Step two for Resend: point an email.received webhook at Ostra and paste its signing secret. */
export function ResendWebhookStep({ accountId, url, onDone }: { accountId: string; url: string; onDone: () => void }) {
  const store = useMailStore();
  const [secret, setSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await store.api.put(`/accounts/connect/resend/${accountId}/webhook`, { signingSecret: secret });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="flex animate-slide-up flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Receive mail</h3>
        <p className="text-[13px] text-fg-3">
          In Resend, add a webhook for <span className="font-mono text-fg-2">email.received</span> with this URL, then paste its signing secret.
        </p>
      </div>
      <div className="flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg-2">{url}</code>
        <Button
          size="sm"
          variant="tertiary"
          iconOnly
          aria-label="Copy URL"
          onClick={() => {
            void navigator.clipboard?.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={14} className="text-green" /> : <Copy size={14} />}
        </Button>
      </div>
      <Input label="Signing secret" required value={secret} onChange={(e) => setSecret(e.target.value.trim())} placeholder="whsec_…" />
      {error && (
        <p role="alert" className={cn("rounded-control border border-red/30 bg-red-bg px-3 py-2 text-[13px] text-red")}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={busy}>
          Save
        </Button>
        <Button variant="tertiary" onClick={onDone}>
          Later
        </Button>
      </div>
    </form>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M21.35 11.1H12v2.98h5.35c-.23 1.43-1.64 4.2-5.35 4.2-3.22 0-5.85-2.67-5.85-5.96S8.78 6.36 12 6.36c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.68 3.8 14.53 2.8 12 2.8 6.92 2.8 2.8 6.92 2.8 12s4.12 9.2 9.2 9.2c5.31 0 8.83-3.73 8.83-8.99 0-.6-.07-1.06-.15-1.51z" />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M2 2h9.5v9.5H2zM12.5 2H22v9.5h-9.5zM2 12.5h9.5V22H2zM12.5 12.5H22V22h-9.5z" />
    </svg>
  );
}
