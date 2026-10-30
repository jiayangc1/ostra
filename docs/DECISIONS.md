# Decisions

Choices the v1 build prompt left open, and why. Newest last within each section.

## Stack

- **API framework: Hono** (the prompt allowed Hono or Fastify). Small, typed, Web-standard `Request`/`Response`, so `app.request()` drives the integration tests without a socket. `@hono/node-ws` for WebSockets.
- **Router: React Router 7** (the prompt allowed TanStack Router). Library mode with `createBrowserRouter`.
- **Versions** follow the owner's preferred majors: React 19, React Router 7, Vite 7, Tailwind 4, ESLint 9. TypeScript is pinned to 5.9 because drizzle-kit and Astro still drive the TypeScript compiler API, which TypeScript 7 changes.
- **Packages ship TypeScript source** (`exports` → `src/*.ts`). Vite bundles it for the browser; the API runs under `tsx`. No per-package build step.
- **Tests use `node:test`** (the owner's rule) with `tsx`; end-to-end tests use Playwright as the prompt asks.
- **Geist components:** Vercel doesn't publish its Geist React components, so `@ostra/ui` implements the needed set on the Geist tokens, with the official `geist` font package and `lucide-react` icons.

## Running without infrastructure

Every external dependency has a local stand-in, so `pnpm dev` works on a bare machine:

| Concern | Production | Local |
|---|---|---|
| Postgres | `DATABASE_URL` via `pg` | PGlite (embedded Postgres) under `.data/pglite` |
| Queue | BullMQ on `REDIS_URL` | in-process queue with the same retry and backoff behavior |
| Realtime fan-out | Redis pub/sub across API and worker processes | in-process hub |
| Object storage | S3-compatible (`S3_BUCKET`) | `.data/blobs` |
| Master key | `OSTRA_MASTER_KEY` | generated key file in `.data/` |
| Auth | Clerk | `dev:<name>` tokens, refused when `NODE_ENV=production` |
| Mail | real providers | demo mode (`OSTRA_DEMO=true`): seeded accounts behind a local provider |

## Data model additions

- `messages.user_id` and `messages.dedupe_key` (denormalized) make dedupe a unique index: `(user_id, dedupe_key)` where the key is the normalized Message-ID, or a content hash when the header is missing.
- `message_accounts` also stores each account's own `provider_message_id` and folder, because archiving a deduped message has to happen in every account it landed in, using that account's id.
- `sender_rules` stores learned "always use this category for this sender" rules (two corrections to the same category).
- `corrections` snapshots sender, subject and snippet so they still work as few-shot examples after the message is deleted.
- `accounts.webhook_token` is a per-account secret: Graph `clientState`, and the path segment of the account's Resend webhook URL.
- `labels.ai_enabled` lets a label opt out of auto-labeling.

## Mail behavior

- **Threads.** A message joins a thread when it references a known Message-ID (In-Reply-To/References). Replies that arrive before their parent are handled too. Within one account, the provider thread id (Gmail threadId, Graph conversationId) also groups messages. Threads never merge on subject alone.
- **Folder of a thread.** A thread shows in a folder when any of its messages is in that folder, so a thread you replied to is in both Inbox and Sent. A message held by several accounts shows in the most visible of their folders (inbox over archive over trash).
- **Thread actions** change the database first, then call every provider involved. If any call fails, everything rolls back and the API answers 502; the client already updated optimistically, so it rolls back and shows a toast.
- **Category is per thread.** It comes from the latest incoming message; a user's choice (`y`) sticks for that thread until they change it again.
- **Initial sync windows:** IMAP takes the 300 most recent messages per folder, Gmail and Outlook the last 90 days (Gmail capped at 500). Older mail is out of scope for v1.
- **Resend** has no mailbox, so archive, trash and read state for Resend domains live in Ostra only. Ostra sets its own `Message-ID` header on Resend sends so replies thread. *Assumption:* Resend keeps a custom `Message-ID`. If it rewrites it, replies to Resend-sent mail still arrive but start a new thread.
- **Resend receiving** needs a webhook the user creates in the Resend dashboard, pointing at a per-account URL with its own signing secret. Ostra shows the URL right after connecting.
- **Drafts** in the composer live in the composer until sent. The Drafts folder shows provider drafts; two-way draft sync is not in v1.
- **Undo** after archive, trash or spam is offered when the thread came from the inbox (it moves it back).

## AI

- **Models:** `claude-haiku-5-5` sorts and labels; `claude-opus-5-5` drafts, rewrites and writes the one-line suggestion. Classification uses structured outputs at low effort. Everything goes through `LLMProvider`, so another vendor is one class.
- **Heuristics first:** threads you replied in, people you've written to, GitHub and auto-submitted headers, `List-Unsubscribe` and bulk headers (with offer wording meaning promotion), and automated sender addresses. At ≥ 0.85 confidence no model is called. Without an API key Ostra still sorts with these rules.
- **Privacy:** content reaches a model only if AI is on in Preferences *and* on for every account involved. Labels can opt out individually. Email text is wrapped as untrusted data in every prompt.
- **Pre-send check** runs on ⌘Enter. Wrong account and missing attachment are local rules; tone is a fast-model call that's skipped when AI isn't allowed. It never blocks: "Send anyway" is always one key away.
- **The AI draft line** under the reader appears only for primary threads whose last message is incoming. It's cached per thread and latest message.

## Security

- Credentials and bodies are envelope-encrypted (AES-256-GCM, a fresh data key per record, rotatable master keys). The logger takes no message content and reduces errors to name + message.
- OAuth uses PKCE. The `state` is encrypted and authenticated, expires after 10 minutes, and its return path is restricted to app-relative routes (no open redirects).
- Webhooks: Clerk and Resend (Svix signatures over the raw body), Gmail Pub/Sub (Google-signed OIDC token, checked audience), Graph (validation echo plus a constant-time `clientState` compare, matched by subscription id).
- User-supplied IMAP/SMTP hosts are resolved and must be public addresses before every connection (SSRF guard). Self-hosted setups opt in with `ALLOW_PRIVATE_MAIL_HOSTS=true`.
- HTML mail renders in a sandboxed iframe without `allow-scripts`, under a CSP that allows only https/data/cid images and inline styles.
- WebSockets authenticate with the first message (`{type:"auth", token}`) so tokens never appear in URLs or proxy logs.

## Desktop

- Clerk has no official Tauri SDK. The desktop app runs Clerk's web flow inside the webview, so `tauri://localhost` (macOS/Linux) and `http://tauri.localhost` (Windows) must be allowed origins in Clerk. The API's `CLERK_AUTHORIZED_PARTIES` includes them by default.
- Google and Microsoft block OAuth in embedded webviews, so the desktop app opens consent in the system browser. The new account reaches the app over the WebSocket (`account.update`).
- The desktop build talks to the hosted API (`https://app.ostramail.com`; override with `OSTRA_DESKTOP_API_URL`).
