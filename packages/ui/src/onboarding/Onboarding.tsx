import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { Color, LabelTemplate } from "@ostra/core";
import { Check, Moon, Monitor, Sun, X } from "lucide-react";
import { OstraLogo } from "../brand/logo.tsx";
import { Badge } from "../components/Badge.tsx";
import { Button } from "../components/Button.tsx";
import { Dot } from "../components/Dot.tsx";
import { Toggle } from "../components/Toggle.tsx";
import { cn } from "../lib/cn.ts";
import { useTheme, type ThemePreference } from "../theme.tsx";
import { useMailStore, useStore } from "../app/store.ts";
import { ConnectAccount } from "../settings/ConnectAccount.tsx";
import { nextColor } from "../settings/ColorPicker.tsx";

const STEPS = ["Accounts", "Labels", "Finish"] as const;

export function Onboarding({ openExternal }: { openExternal?: (url: string) => void }) {
  const [search, setSearch] = useSearchParams();
  const step = Math.min(Math.max(Number(search.get("step") ?? 0), 0), 2);
  const go = (n: number) => setSearch({ step: String(n) });
  const store = useMailStore();

  useEffect(() => {
    document.title = "Welcome · Ostra";
  }, []);

  // Back from OAuth.
  useEffect(() => {
    const error = search.get("error");
    const connected = search.get("connected");
    if (!error && !connected) return;
    if (error) store.notify(error, { tone: "error" });
    void store.loadBootstrap();
    setSearch({ step: "0" }, { replace: true });
  }, [search, setSearch, store]);

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-line bg-canvas/80 px-6 backdrop-blur-md">
        <OstraLogo />
        <ol className="flex items-center gap-2 font-mono text-[11px] text-fg-3" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full border transition-colors duration-[var(--motion-normal)]",
                  i < step ? "border-transparent bg-primary text-primary-fg" : i === step ? "border-line-strong text-fg" : "border-line",
                )}
              >
                {i < step ? <Check size={11} strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn("hidden sm:inline", i === step && "text-fg")}>{s}</span>
              {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-line" aria-hidden="true" />}
            </li>
          ))}
        </ol>
        <span
          aria-hidden="true"
          className="absolute inset-x-0 -bottom-px h-px origin-left bg-fg transition-transform duration-[var(--motion-slow)] ease-out"
          style={{ transform: `scaleX(${(step + 1) / STEPS.length})` }}
        />
      </header>
      <main className="flex flex-1 justify-center px-4 py-12">
        <div key={step} className="flex w-full max-w-2xl animate-slide-up flex-col gap-8">
          {step === 0 && <AccountsStep onNext={() => go(1)} openExternal={openExternal} />}
          {step === 1 && <LabelsStep onBack={() => go(0)} onNext={() => go(2)} />}
          {step === 2 && <FinishStep onBack={() => go(1)} />}
        </div>
      </main>
    </div>
  );
}

function StepHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl tracking-[-0.03em]">{title}</h1>
      <p className="max-w-lg text-sm text-fg-2">{children}</p>
    </div>
  );
}

function AccountsStep({ onNext, openExternal }: { onNext: () => void; openExternal?: ((url: string) => void) | undefined }) {
  const store = useMailStore();
  const accounts = useStore((s) => s.boot?.accounts) ?? [];
  const [adding, setAdding] = useState(accounts.length === 0);

  return (
    <>
      <StepHeader title="Bring every inbox">Connect the addresses you use. Ostra merges them into one list and keeps track of which one each email came to.</StepHeader>
      {accounts.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-window border border-line" aria-label="Connected accounts">
          {accounts.map((a) => (
            <li key={a.id} className="flex animate-slide-down items-center gap-3 px-4 py-3">
              <Dot color={a.color} size={10} />
              <span className="flex-1 truncate text-sm">{a.displayName}</span>
              <span className="font-mono text-[11px] text-fg-3">{a.provider}</span>
              <Check size={14} className="text-green" aria-label="Connected" />
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <section className="rounded-window border border-line p-5">
          <ConnectAccount
            defaultColor={nextColor(accounts.map((a) => a.color as Color))}
            returnTo="/onboarding?step=0"
            openExternal={openExternal}
            onConnected={() => {
              setAdding(false);
              void store.loadBootstrap();
            }}
          />
        </section>
      ) : (
        <Button className="self-start" onClick={() => setAdding(true)}>
          Connect another account
        </Button>
      )}
      <div className="flex items-center justify-end gap-3 border-t border-line pt-6">
        {accounts.length === 0 && (
          <Button variant="tertiary" onClick={onNext}>
            Skip for now
          </Button>
        )}
        <Button variant="primary" disabled={accounts.length === 0} onClick={onNext}>
          Continue
        </Button>
      </div>
    </>
  );
}

function LabelsStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const store = useMailStore();
  const boot = useStore((s) => s.boot);
  const templates = boot?.templates ?? [];
  const [selected, setSelected] = useState<Set<string>>(() => new Set(boot?.labels.map((l) => l.sourceTemplate).filter((t): t is string => !!t)));
  const [custom, setCustom] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [autoLabel, setAutoLabel] = useState(boot?.settings.autoLabel ?? true);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addCustom = (e: FormEvent) => {
    e.preventDefault();
    const name = draft.trim();
    if (name && !custom.some((c) => c.toLowerCase() === name.toLowerCase())) setCustom((c) => [...c, name]);
    setDraft("");
  };

  const save = async () => {
    setBusy(true);
    try {
      const colors: Color[] = ["blue", "purple", "green", "amber", "pink", "teal"];
      await store.api.post("/labels/templates", { templateIds: [...selected], custom: custom.map((name, i) => ({ name, color: colors[i % colors.length] })) });
      await store.updateSettings({ autoLabel });
      await store.loadBootstrap();
      onNext();
    } catch (err) {
      store.notify(err instanceof Error ? err.message : "Couldn't save labels.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <StepHeader title="Set up labels">Pick a starting set. Labels work across all your accounts, and Ostra applies them as mail arrives.</StepHeader>
      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Label templates">
        {templates.map((t: LabelTemplate) => {
          const on = selected.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              data-template={t.id}
              onClick={() => toggle(t.id)}
              className={cn(
                "group o-lift relative flex flex-col gap-3 rounded-card border p-4 text-left",
                on ? "border-line-strong bg-hover shadow-[0_0_0_1px_var(--o-line-strong)]" : "border-line bg-surface hover:border-line-hover",
              )}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-fg">{t.name}</span>
                  <span className="text-[13px] text-fg-3">{t.blurb}</span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all duration-[var(--motion-normal)] ease-spring",
                    on ? "scale-100 border-transparent bg-primary text-primary-fg" : "scale-90 border-line-hover",
                  )}
                >
                  {on && <Check size={11} strokeWidth={3} />}
                </span>
              </span>
              <span className="flex flex-wrap gap-1">
                {t.labels.map((l) => (
                  <Badge key={l.name} color={l.color}>
                    {l.name}
                  </Badge>
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <form onSubmit={addCustom} className="flex flex-col gap-2">
        <label htmlFor="custom-label" className="text-[13px] font-medium text-fg-2">
          Your own labels
        </label>
        <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-control border border-line bg-canvas px-2 py-1.5 transition-[border-color,box-shadow] duration-[var(--motion-fast)] hover:border-line-hover focus-within:border-line-strong focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--o-focus)_22%,transparent)]">
          {custom.map((c) => (
            <span key={c} className="flex animate-pop-in items-center gap-1 rounded-full bg-gray-bg py-0.5 pl-2 pr-1 text-[12px] font-medium text-gray">
              {c}
              <button type="button" aria-label={`Remove ${c}`} onClick={() => setCustom((x) => x.filter((y) => y !== c))} className="rounded-full p-0.5 hover:text-fg">
                <X size={10} />
              </button>
            </span>
          ))}
          <input
            id="custom-label"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={custom.length ? "" : "Type a label and press Enter"}
            maxLength={40}
            className="h-6 min-w-32 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-3 focus-visible:outline-none"
          />
        </div>
      </form>

      <div className="rounded-window border border-line p-4">
        <Toggle checked={autoLabel} onChange={setAutoLabel} label="Auto-label incoming mail" description="Press l on any message to fix a label. Ostra learns from it." />
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-6">
        <Button variant="tertiary" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" loading={busy} onClick={() => void save()}>
          Continue
        </Button>
      </div>
    </>
  );
}

function FinishStep({ onBack }: { onBack: () => void }) {
  const store = useMailStore();
  const navigate = useNavigate();
  const boot = useStore((s) => s.boot);
  const { preference, setPreference } = useTheme();
  const identities = boot?.identities ?? [];
  const accounts = new Map((boot?.accounts ?? []).map((a) => [a.id, a]));
  const [identityId, setIdentityId] = useState(boot?.settings.defaultIdentityId ?? identities[0]?.id ?? null);
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    try {
      await store.updateSettings({ defaultIdentityId: identityId, theme: preference, onboarded: true });
      navigate("/inbox", { replace: true });
    } catch (err) {
      store.notify(err instanceof Error ? err.message : "Couldn't save.", { tone: "error" });
      setBusy(false);
    }
  };

  const themes: { id: ThemePreference; name: string; icon: ReactNode }[] = [
    { id: "dark", name: "Dark", icon: <Moon size={14} /> },
    { id: "light", name: "Light", icon: <Sun size={14} /> },
    { id: "system", name: "System", icon: <Monitor size={14} /> },
  ];

  return (
    <>
      <StepHeader title="Last touches">Choose the address new mail comes from, and how Ostra looks. Replies always come from the address they were sent to.</StepHeader>
      {identities.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13px] font-medium text-fg-2">Default from address</legend>
          <div className="flex flex-col divide-y divide-line rounded-window border border-line" role="radiogroup">
            {identities.map((i) => (
              <label key={i.id} className={cn("flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors duration-[var(--motion-fast)] hover:bg-hover", identityId === i.id && "bg-hover")}>
                <input type="radio" name="identity" checked={identityId === i.id} onChange={() => setIdentityId(i.id)} className="peer sr-only" />
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-[var(--motion-fast)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
                    identityId === i.id ? "border-fg bg-fg" : "border-line-strong",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full bg-canvas transition-transform duration-[var(--motion-normal)] ease-spring", identityId === i.id ? "scale-100" : "scale-0")} />
                </span>
                {accounts.get(i.accountId) && <Dot color={accounts.get(i.accountId)!.color} />}
                <span className="flex-1 truncate text-sm">{i.address}</span>
                {i.displayName && <span className="text-[13px] text-fg-3">{i.displayName}</span>}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[13px] font-medium text-fg-2">Theme</legend>
        <div className="grid grid-cols-3 gap-2" role="radiogroup">
          {themes.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={preference === t.id}
              onClick={() => setPreference(t.id)}
              className={cn("o-lift flex h-10 items-center justify-center gap-2 rounded-card border text-sm", preference === t.id ? "border-line-strong bg-hover text-fg shadow-[0_0_0_1px_var(--o-line-strong)]" : "border-line text-fg-2 hover:border-line-hover")}
            >
              {t.icon}
              {t.name}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center justify-between gap-3 border-t border-line pt-6">
        <Button variant="tertiary" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" loading={busy} onClick={() => void finish()}>
          Open my inbox
        </Button>
      </div>
    </>
  );
}
