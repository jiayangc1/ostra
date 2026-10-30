# ostra

Every inbox, one place. Ostra merges every email account you own (Gmail, Outlook, any IMAP host, and custom domains through Resend) into one fast, keyboard-first list, puts real mail from real people on top, and keeps newsletters, notifications and promotions out of the way.

It also pulls the useful bits out of mail: one-time sign-in codes get a one-tap copy button (and `⇧C` from anywhere), and calendar invites or plans like "dinner Thursday at 7" become event cards you can add to Google Calendar, Outlook or Apple Calendar in one click.

## Layout

```
apps/
  web/        React 19 + Vite SPA (React Router 7, Tailwind 4)
  api/        Hono HTTP + WebSocket API, sync workers, webhooks
  desktop/    Tauri v2 shell around the web build (SQLite cache)
  site/       Astro marketing site for heyostra.com
packages/
  core/       Normalized Message/Thread model, provider interface, folder
              mapping, Message-ID dedupe, smart "from", MIME (Node-only subpaths)
  ui/         Every screen and component (Geist design system)
  db/         Drizzle schema + migrations (Postgres, or embedded PGlite)
  ai/         LLMProvider, heuristics, categorize, auto-label, writing, pre-send check, event finding
  calendar/   Google Calendar, Outlook (Graph) and CalDAV (iCloud) clients behind one interface
  sync-gmail, sync-outlook, sync-imap, sync-resend
              One MailProvider per provider
```

## Run it

Requires Node 22+ and pnpm 10.

```sh
pnpm install
pnpm dev            # API on :8787 (demo mode) + web on :5173
```

Open http://localhost:5173, continue as the dev user, and press `⌘K`.

Without any configuration the API uses an embedded Postgres (PGlite) under `.data/`, an in-process job queue, a local encrypted blob store, and development sign-in. `pnpm dev` turns on demo mode, so you can load realistic mail across three accounts:

```sh
curl -X POST -H "Authorization: Bearer dev:you" localhost:8787/api/dev/seed
```

Copy `.env.example` to `.env` and fill in what you need: `DATABASE_URL`, `REDIS_URL`, `OSTRA_MASTER_KEY`, Clerk keys, Google and Microsoft OAuth clients, S3, and `ANTHROPIC_API_KEY`. Production refuses to start without Clerk and a master key, and never honors demo mode or development sign-in. The API and the web app both read `.env` and then `.env.local` at the repo root.

### Clerk

```sh
npx clerk auth login
npx clerk link --app <application_id>
npx clerk env pull --file .env.local   # CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY
```

With keys present, sign-in is Clerk's and `dev:` tokens are refused. To load demo mail as your Clerk user, copy a session token from the browser console (`await Clerk.session.getToken()`) and use it in place of `dev:you` above. End-to-end tests blank the keys and keep using development sign-in.

## Test

```sh
pnpm test           # unit + integration (node:test) in every package
pnpm test:e2e       # Playwright against the demo API and the web app
pnpm typecheck
pnpm lint
```

## Desktop

```sh
pnpm --filter @ostra/desktop dev     # needs Rust and the Tauri prerequisites
pnpm --filter @ostra/desktop build
```

## Keyboard

| Key | | Key | |
|---|---|---|---|
| `⌘K` | command bar | `r` / `a` / `f` | reply / reply all / forward |
| `j` `k` | move | `c` | compose |
| `Enter` / `Esc` | open / back | `l` | label |
| `e` | archive | `y` | change category (then `1`–`4`) |
| `#` | trash | `Tab` | open the AI draft |
| `!` | spam | `⌘Enter` | send |
| `⇧C` | copy the latest sign-in code | | |
| `g i` `g s` `g d` | inbox / sent / drafts | `⌘J` | AI in the composer |

See [docs/DECISIONS.md](docs/DECISIONS.md) for the choices the build prompt left open.
