import { GOOGLE_TOKEN_URL, MS_CALENDAR_SCOPES, googleCalendarAuthUrl, microsoftCalendarAuthUrl, msCalendarTokenUrl } from "@ostra/calendar";
import { buildIcs } from "@ostra/core";
import { exchangeCode, pkcePair } from "@ostra/core/oauth";
import { calendarConnections, eq } from "@ostra/db";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { HttpError, badRequest } from "../lib/errors.ts";
import {
  addEventToCalendar,
  connectCalDav,
  getConnection,
  messageEvent,
  refreshCalendars,
  removeConnection,
  saveConnection,
  toConnectionDto,
  type CalendarCredentials,
} from "../services/calendars.ts";
import type { Services } from "../services/context.ts";
import type { AppEnv } from "./api.ts";

type OAuthCalendar = "google" | "microsoft";

interface CalendarOAuthState {
  kind: "calendar";
  userId: string;
  provider: OAuthCalendar;
  verifier: string;
  returnTo: string;
  exp: number;
}

const redirectUri = (s: Services, p: OAuthCalendar) => `${s.config.publicUrl}/oauth/calendar/${p}/callback`;
const safeReturn = (p: string | undefined) => (p && /^\/[a-z0-9/_?=&-]*$/i.test(p) && !p.startsWith("//") ? p : "/settings/calendars");

function configured(s: Services, p: OAuthCalendar) {
  const cfg = p === "google" ? s.config.google : s.config.microsoft;
  if (!cfg) throw new HttpError(503, `${p === "google" ? "Google" : "Microsoft"} sign-in isn't configured on this server.`, "provider_unavailable");
  return cfg;
}

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const r = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!r.success) throw badRequest(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), "invalid_body");
  return r.data;
}

/** /api/calendars: connected calendar accounts. */
export function calendarRoutes(s: Services) {
  const r = new Hono<AppEnv>();

  r.get("/", async (c) => {
    const rows = await s.db.select().from(calendarConnections).where(eq(calendarConnections.userId, c.get("user").id)).orderBy(calendarConnections.createdAt);
    return c.json(rows.map((row) => toConnectionDto(s, row)));
  });

  r.post("/oauth/:provider/start", async (c) => {
    const provider = z.enum(["google", "microsoft"]).safeParse(c.req.param("provider"));
    if (!provider.success) throw badRequest("Unknown calendar provider");
    const b = await body(c, z.object({ returnTo: z.string().optional(), loginHint: z.string().email().optional() }));
    const cfg = configured(s, provider.data);
    const { verifier, challenge } = await pkcePair();
    const state: CalendarOAuthState = { kind: "calendar", userId: c.get("user").id, provider: provider.data, verifier, returnTo: safeReturn(b.returnTo), exp: Date.now() + 10 * 60_000 };
    const sealed = Buffer.from(s.envelope.encryptJson(state)).toString("base64url");
    const common = { clientId: cfg.clientId, redirectUri: redirectUri(s, provider.data), state: sealed, codeChallenge: challenge, loginHint: b.loginHint };
    const url = provider.data === "google" ? googleCalendarAuthUrl(common) : microsoftCalendarAuthUrl({ ...common, tenant: s.config.microsoft!.tenant });
    return c.json({ url });
  });

  /** Apple iCloud (app-specific password) or any CalDAV server. */
  r.post("/caldav", async (c) => {
    const b = await body(c, z.object({ serverUrl: z.string().trim().max(500).optional(), username: z.string().trim().min(1).max(320), password: z.string().min(1).max(500) }));
    const row = await connectCalDav(s, c.get("user").id, b);
    return c.json(toConnectionDto(s, row), 201);
  });

  r.post("/:id/refresh", async (c) => {
    const row = await getConnection(s, c.get("user").id, c.req.param("id"));
    return c.json(toConnectionDto(s, await refreshCalendars(s, row)));
  });

  r.delete("/:id", async (c) => {
    const user = c.get("user");
    await removeConnection(s, user.id, await getConnection(s, user.id, c.req.param("id")));
    return c.body(null, 204);
  });

  return r;
}

/** /api/messages/:id/events/:index/…: act on an event found in a message. */
export function messageEventRoutes(s: Services) {
  const r = new Hono<AppEnv>();
  const idx = (c: Context) => {
    const n = Number(c.req.param("index"));
    if (!Number.isInteger(n) || n < 0 || n > 50) throw badRequest("Unknown event");
    return n;
  };

  r.post("/:id/events/:index/add", async (c) => {
    const b = await body(c, z.object({ connectionId: z.string().uuid().optional(), calendarId: z.string().min(1).max(1024).optional() }));
    return c.json(await addEventToCalendar(s, c.get("user").id, c.req.param("id"), idx(c), b), 201);
  });

  /** The event as a file any calendar app opens (works with nothing connected). */
  r.get("/:id/events/:index/ics", async (c) => {
    const index = idx(c);
    const { message, event } = await messageEvent(s, c.get("user").id, c.req.param("id"), index);
    const ics = buildIcs(event, { uid: event.uid ?? `${message.id}-${index}@ostra`, method: "PUBLISH" });
    const name = (event.title.replace(/[^\w .-]+/g, "").trim() || "event").slice(0, 60);
    return c.body(ics, 200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.ics"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
  });

  return r;
}

/** GET /oauth/calendar/:provider/callback: public; the sealed state authenticates it. */
export function calendarCallbackRoutes(s: Services) {
  const r = new Hono();
  r.get("/:provider/callback", async (c) => {
    const back = (path: string, params: Record<string, string>) => c.redirect(`${s.config.appUrl}${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams(params)}`);
    let state: CalendarOAuthState;
    try {
      state = s.envelope.decryptJson<CalendarOAuthState>(Buffer.from(c.req.query("state") ?? "", "base64url").toString());
      if (state.kind !== "calendar") throw new Error("wrong state kind");
    } catch {
      return back("/settings/calendars", { error: "That sign-in link is invalid. Try again." });
    }
    if (state.exp < Date.now() || state.provider !== c.req.param("provider")) return back(state.returnTo, { error: "That sign-in took too long. Try again." });
    const code = c.req.query("code");
    if (!code) return back(state.returnTo, { error: c.req.query("error") === "access_denied" ? "Access wasn't granted." : "Sign-in was cancelled." });

    try {
      const cfg = configured(s, state.provider);
      const tokenUrl = state.provider === "google" ? GOOGLE_TOKEN_URL : msCalendarTokenUrl(s.config.microsoft!.tenant);
      const tokens = await exchangeCode(
        { tokenUrl, clientId: cfg.clientId, clientSecret: cfg.clientSecret },
        { code, redirectUri: redirectUri(s, state.provider), codeVerifier: state.verifier, ...(state.provider === "microsoft" ? { scope: MS_CALENDAR_SCOPES.join(" ") } : {}) },
      );
      const credentials: CalendarCredentials = { tokens };
      // Google lets people untick scopes on the consent screen; without the events scope nothing works.
      if (state.provider === "google" && tokens.scope && !tokens.scope.includes("calendar.events")) {
        return back(state.returnTo, { error: "Ostra needs permission to add events. Try again and leave that box ticked." });
      }
      const client = s.calendars({ provider: state.provider, credentials, save: async () => {} });
      const row = await saveConnection(s, state.userId, state.provider, credentials, client);
      return back(state.returnTo, { calendarConnected: row.id });
    } catch (err) {
      s.log.warn("calendar oauth callback failed", { provider: state.provider }, err);
      return back(state.returnTo, { error: err instanceof Error ? err.message : "Couldn't connect that calendar." });
    }
  });
  return r;
}
