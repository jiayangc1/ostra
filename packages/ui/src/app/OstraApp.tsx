import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { useToast } from "../components/Toast.tsx";
import { ListSkeleton } from "../components/Skeleton.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { Button } from "../components/Button.tsx";
import { useTheme } from "../theme.tsx";
import { Shell, type ShellExtensions } from "../shell/Shell.tsx";
import { SettingsPage } from "../settings/SettingsPage.tsx";
import { createApi } from "./api.ts";
import { useAuthState } from "./auth.tsx";
import type { CacheFactory } from "./cache.ts";
import { RealtimeClient } from "./realtime.ts";
import { MailStore, StoreContext, parseViewKey, useMailStore, useStore } from "./store.ts";

export interface OstraAppProps {
  /** "" for same-origin; absolute in the desktop shell. */
  apiBase: string;
  /** ws(s)://host/ws */
  wsUrl: string;
  cacheFactory: CacheFactory;
  /** Extra routes and shell features from later layers (onboarding, settings, composer). */
  routes?: ReactNode;
  shell?: ShellExtensions;
  /** Wraps the shell, e.g. to mount the composer next to it. */
  ShellFrame?: (props: { children: ReactNode }) => ReactNode;
  /** Open a URL outside the app (desktop shell: the system browser). */
  openExternal?: (url: string) => void;
}

/** The signed-in app: owns the store, cache and realtime connection for one user. */
export function OstraApp(props: OstraAppProps) {
  const auth = useAuthState();
  const toast = useToast();
  const userKey = auth.user?.email ?? "anonymous";

  const store = useMemo(() => {
    const api = createApi(props.apiBase, auth.getToken);
    return new MailStore({
      api,
      cache: props.cacheFactory(userKey),
      notify: (message, opts) => toast({ message, tone: opts?.tone === "error" ? "error" : "default", action: opts?.action }),
    });
    // One store per signed-in user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userKey]);

  useEffect(() => {
    let alive = true;
    void store.hydrate().then(() => {
      if (alive) void store.loadBootstrap().catch(() => {});
    });
    const rt = new RealtimeClient(props.wsUrl, auth.getToken, {
      onEvent: (e) => store.applyEvent(e),
      onStatus: (s) => store.setConnection(s),
      onReady: () => {
        const visible = Object.keys(store.getState().lists).map(parseViewKey).slice(0, 4);
        void store.reconcile(visible);
      },
    });
    rt.start();
    return () => {
      alive = false;
      rt.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  return (
    <StoreContext.Provider value={store}>
      <Gate {...props} />
    </StoreContext.Provider>
  );
}

function Gate({ routes, shell, ShellFrame, openExternal }: OstraAppProps) {
  const bootStatus = useStore((s) => s.bootStatus);
  const settings = useStore((s) => s.boot?.settings);
  const location = useLocation();
  const { setPreference, preference } = useTheme();

  // The theme roams with the account: the server's value applies once on load,
  // and later local changes (sidebar toggle, ⌘K) are saved back.
  const store = useMailStore();
  const themeSynced = useRef(false);
  useEffect(() => {
    if (!settings) return;
    if (!themeSynced.current) {
      themeSynced.current = true;
      if (settings.theme !== preference) setPreference(settings.theme);
      return;
    }
    if (settings.theme !== preference) void store.updateSettings({ theme: preference }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.theme, preference]);

  if (bootStatus === "loading") {
    return (
      <div className="grid h-full grid-cols-[200px_340px_1fr]" aria-busy="true">
        <div className="border-r border-line" />
        <div className="border-r border-line">
          <ListSkeleton rows={10} />
        </div>
        <div />
      </div>
    );
  }
  if (bootStatus === "error") {
    return <EmptyState className="h-full" title="Couldn't reach Ostra" description="Check your connection and try again." action={<Button onClick={() => location.pathname && window.location.reload()}>Try again</Button>} />;
  }
  if (settings && !settings.onboarded && !location.pathname.startsWith("/onboarding") && !location.pathname.startsWith("/settings") && routes) {
    return <Navigate to="/onboarding" replace />;
  }

  const shellEl = <Shell ext={shell} />;
  return (
    <Routes>
      {routes}
      <Route path="/settings/:section?" element={<SettingsPage openExternal={openExternal} />} />
      <Route path="/" element={<Navigate to="/inbox" replace />} />
      <Route path="/label/:labelId/:threadId?" element={ShellFrame ? <ShellFrame>{shellEl}</ShellFrame> : shellEl} />
      <Route path="/:folder/:threadId?" element={ShellFrame ? <ShellFrame>{shellEl}</ShellFrame> : shellEl} />
    </Routes>
  );
}
