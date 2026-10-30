import { LABEL_TEMPLATES, type Category, type Color, type NormalizedMessage, type ProviderKind, type VirtualFolder } from "@ostra/core";
import { accounts, and, eq, labels, messageLabels, messages, threads } from "@ostra/db";
import { createAccount, disconnectAccount } from "../services/accounts.ts";
import type { Services } from "../services/context.ts";
import { ingestBatch } from "../services/ingest.ts";
import { updateSettings } from "../services/users.ts";

interface DemoAccount {
  key: "personal" | "work" | "startup";
  provider: ProviderKind;
  address: string;
  name: string;
  color: Color;
}

const ACCOUNTS: DemoAccount[] = [
  { key: "personal", provider: "gmail", address: "sam.rivera@gmail.com", name: "Sam Rivera", color: "blue" },
  { key: "work", provider: "outlook", address: "sam@northwind.io", name: "Sam Rivera", color: "amber" },
  { key: "startup", provider: "resend", address: "hello@tidepool.dev", name: "Tidepool", color: "green" },
];

interface Seed {
  in: DemoAccount["key"][];
  from: [string, string];
  subject: string;
  body: string;
  ago: number; // minutes
  category: Category;
  labels?: string[];
  read?: boolean;
  folder?: VirtualFolder;
  headers?: Record<string, string>;
  /** Earlier messages in the thread, oldest first. `me` replies come from the first account. */
  history?: { from: [string, string] | "me"; body: string; ago: number }[];
  attachments?: { filename: string; contentType: string; size: number }[];
  html?: string;
}

const unsub = (domain: string) => ({ "list-unsubscribe": `<https://${domain}/unsubscribe>`, "list-id": `<news.${domain}>`, precedence: "bulk" });

const SEEDS: Seed[] = [
  {
    in: ["startup"],
    from: ["Priya Natarajan", "priya@foundry.vc"],
    subject: "Re: Tidepool seed: next steps",
    body: "Sam, the partners loved the demo. Could you send over the updated model before Thursday? We'd like to move to a term sheet next week.\n\nPriya",
    ago: 6,
    category: "primary",
    labels: ["Investors"],
    history: [
      { from: ["Priya Natarajan", "priya@foundry.vc"], body: "Great meeting today. Who else should we talk to on the team?", ago: 2900 },
      { from: "me", body: "Thanks Priya. Happy to set up time with Lena, our CTO. Deck attached for the partners.", ago: 2700 },
    ],
  },
  {
    in: ["work"],
    from: ["Marcus Chen", "marcus@northwind.io"],
    subject: "Q4 roadmap review moved to 3pm",
    body: "Heads up: the roadmap review is now at 3pm in Juniper. I added the infra cost slides at the end.",
    ago: 18,
    category: "primary",
    attachments: [{ filename: "q4-roadmap.pdf", contentType: "application/pdf", size: 482_133 }],
  },
  {
    in: ["startup"],
    from: ["Vercel", "notifications@vercel.com"],
    subject: "Deployment ready: tidepool-web (main)",
    body: "Your deployment of tidepool-web to production is ready. Commit 8f3a1c2: fix onboarding copy.",
    ago: 25,
    category: "notification",
    labels: ["Deploys"],
    read: true,
  },
  {
    in: ["personal"],
    from: ["Mom", "elena.rivera@icloud.com"],
    subject: "Sunday dinner?",
    body: "Are you and Jo coming Sunday? Dad is making the paella. Let me know by Friday so I can shop.",
    ago: 41,
    category: "primary",
  },
  {
    in: ["startup"],
    from: ["GitHub", "notifications@github.com"],
    subject: "[tidepool/api] Fix race in sync worker (#214)",
    body: "lena-k requested your review on this pull request.\n\nThe sync worker could double-ingest when two pushes arrived within 50ms.",
    ago: 52,
    category: "notification",
    labels: ["GitHub"],
    headers: { "x-github-reason": "review_requested" },
  },
  {
    in: ["startup"],
    from: ["Jordan Blake", "jordan@lumen.health"],
    subject: "Pilot feedback from the clinic team",
    body: "Hi Sam, the clinic team has been using Tidepool for two weeks. Overall great, but they keep asking for bulk export. Is that on the roadmap? Happy to get on a call.",
    ago: 75,
    category: "primary",
    labels: ["Customers"],
  },
  {
    in: ["personal", "startup"],
    from: ["Lenny's Newsletter", "lenny@substack.com"],
    subject: "How the best teams run pricing experiments",
    body: "This week: a deep dive into pricing experiments with three founders who doubled ARPU without churn.",
    ago: 95,
    category: "newsletter",
    headers: unsub("lennysnewsletter.com"),
  },
  {
    in: ["startup"],
    from: ["Sentry", "noreply@sentry.io"],
    subject: "[tidepool-api] TypeError: Cannot read properties of undefined (reading 'cursor')",
    body: "New issue in production. 34 events in the last hour affecting 12 users. First seen 14 minutes ago.",
    ago: 110,
    category: "notification",
    labels: ["Alerts"],
  },
  {
    in: ["work"],
    from: ["Aisha Bello", "aisha@northwind.io"],
    subject: "Interview loop for the staff engineer role",
    body: "Can you take the system design slot on Wednesday at 11? Candidate is strong on distributed systems. Packet attached.",
    ago: 140,
    category: "primary",
    attachments: [{ filename: "candidate-packet.pdf", contentType: "application/pdf", size: 220_400 }],
  },
  {
    in: ["personal"],
    from: ["Linear", "hello@linear.app"],
    subject: "Linear changelog: Triage intelligence",
    body: "Triage now suggests owners, labels and duplicates automatically. Plus 23 fixes and improvements.",
    ago: 200,
    category: "newsletter",
    read: true,
    headers: unsub("linear.app"),
  },
  {
    in: ["personal"],
    from: ["United Airlines", "unitedairlines@united.com"],
    subject: "Your trip to Lisbon is confirmed",
    body: "Confirmation K7Q2LX. SFO to LIS, Nov 14, departs 3:40 PM. Seat 23A. Check in opens 24 hours before departure.",
    ago: 260,
    category: "notification",
  },
  {
    in: ["personal"],
    from: ["Allbirds", "hello@allbirds.com"],
    subject: "Last call: 30% off Tree Runners",
    body: "The fall sale ends tonight at midnight. Free shipping on everything.",
    ago: 300,
    category: "promotion",
    headers: unsub("allbirds.com"),
  },
  {
    in: ["startup"],
    from: ["Stripe", "receipts@stripe.com"],
    subject: "Your receipt from Render [#2241-9917]",
    body: "Amount paid $186.00. Render Team plan, Oct 1 to Oct 31.",
    ago: 380,
    category: "notification",
    labels: ["Billing"],
    read: true,
  },
  {
    in: ["startup"],
    from: ["Hannah Okafor", "hannah@okafor.law"],
    subject: "Re: SAFE side letter",
    body: "I've marked up the side letter. The pro rata language is fine; I'd push back on the MFN clause. Redline attached.",
    ago: 460,
    category: "primary",
    labels: ["Legal"],
    attachments: [{ filename: "side-letter-redline.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 48_220 }],
    history: [{ from: "me", body: "Hannah, Foundry sent over their standard side letter. Can you take a look this week?", ago: 1900 }],
  },
  {
    in: ["work"],
    from: ["Workday", "noreply@myworkday.com"],
    subject: "Action required: complete your benefits enrollment",
    body: "Open enrollment closes in 5 days. Review your medical, dental and vision elections.",
    ago: 520,
    category: "notification",
  },
  {
    in: ["personal"],
    from: ["The Browser", "editor@thebrowser.com"],
    subject: "Five pieces worth your time",
    body: "On attention, on Lisbon's trams, on why bridges sing, and two more.",
    ago: 600,
    category: "newsletter",
    headers: unsub("thebrowser.com"),
  },
  {
    in: ["startup"],
    from: ["Diego Alvarez", "diego@alvarez.studio"],
    subject: "Interested in the design contract",
    body: "Hey Sam, a friend at Foundry mentioned you're looking for a brand designer. I've done identity work for Ramp and Mercury. Portfolio: alvarez.studio",
    ago: 720,
    category: "primary",
    labels: ["Hiring"],
  },
  {
    in: ["personal"],
    from: ["Jo", "jo.park@gmail.com"],
    subject: "Lisbon apartment options",
    body: "Found three places near Alfama. The one with the terrace is my favorite but it's a bit over budget. Thoughts?",
    ago: 840,
    category: "primary",
    read: true,
    history: [{ from: "me", body: "Can you look for something near the river? Somewhere walkable.", ago: 1500 }],
  },
  {
    in: ["startup"],
    from: ["Vercel", "notifications@vercel.com"],
    subject: "Deployment failed: tidepool-web (preview)",
    body: "Build failed on branch feat/export. Error: Type error in src/export/csv.ts:41.",
    ago: 900,
    category: "notification",
    labels: ["Deploys"],
    read: true,
  },
  {
    in: ["work"],
    from: ["Figma", "no-reply@figma.com"],
    subject: "Aisha commented on Onboarding v3",
    body: "\"Can we try the empty state without the illustration?\" on frame Welcome / 02.",
    ago: 1000,
    category: "notification",
    read: true,
  },
  {
    in: ["personal"],
    from: ["Notion", "team@makenotion.com"],
    subject: "Introducing Notion Mail for teams",
    body: "Bring your team's inbox into your workspace. Try it free for 30 days.",
    ago: 1100,
    category: "promotion",
    read: true,
    headers: unsub("notion.so"),
  },
  {
    in: ["startup"],
    from: ["Benedict Evans", "list@ben-evans.com"],
    subject: "Benedict's Newsletter: No. 612",
    body: "AI pricing, the end of the app store era, and what's really happening with search.",
    ago: 1300,
    category: "newsletter",
    read: true,
    headers: unsub("ben-evans.com"),
  },
  {
    in: ["work"],
    from: ["Tom Okonkwo", "tom@acme-logistics.com"],
    subject: "Renewal quote for 2027",
    body: "Sam, attached is the renewal quote. We kept the per-seat price flat if you sign before Dec 15.",
    ago: 1450,
    category: "primary",
    read: true,
  },
  {
    in: ["startup"],
    from: ["AWS", "no-reply-aws@amazon.com"],
    subject: "AWS Billing Alert: you've exceeded 80% of your budget",
    body: "Your budget 'tidepool-prod' has exceeded 80% of the $1,200.00 monthly limit.",
    ago: 1600,
    category: "notification",
    labels: ["Billing", "Alerts"],
  },
  {
    in: ["personal"],
    from: ["Patagonia", "patagonia@email.patagonia.com"],
    subject: "Worn Wear trade-in week starts now",
    body: "Trade in your used gear for credit toward something new to you.",
    ago: 1800,
    category: "promotion",
    read: true,
    headers: unsub("patagonia.com"),
  },
  {
    in: ["startup"],
    from: ["Lena Kowalski", "lena@tidepool.dev"],
    subject: "Infra plan for the pilot scale-up",
    body: "Drafted the plan for 10x pilot load: move sync workers to their own pool, add read replicas. Mostly cost-neutral until January.",
    ago: 2000,
    category: "primary",
    read: true,
  },
  {
    in: ["personal"],
    from: ["Stratechery", "email@stratechery.com"],
    subject: "The Aggregator's Dilemma",
    body: "Today's Update looks at how aggregators respond when the marginal cost of content goes to zero.",
    ago: 2200,
    category: "newsletter",
    read: true,
    headers: unsub("stratechery.com"),
  },
  {
    in: ["work"],
    from: ["Jira", "jira@northwind.atlassian.net"],
    subject: "[NW-1182] Sync latency regression assigned to you",
    body: "Marcus Chen assigned NW-1182 to you. Priority: High.",
    ago: 2500,
    category: "notification",
    read: true,
  },
  {
    in: ["startup"],
    from: ["Maya Lindqvist", "maya@northstar.capital"],
    subject: "Intro: Northstar x Tidepool",
    body: "Hi Sam, Priya mentioned you're raising. We lead seed rounds in health infra. Would love 30 minutes next week.",
    ago: 3100,
    category: "primary",
    labels: ["Investors"],
    read: true,
  },
  {
    in: ["personal"],
    from: ["Uniqlo", "news@uniqlo.com"],
    subject: "HEATTECH is back",
    body: "Stay warm this season. New colors in store and online.",
    ago: 3500,
    category: "promotion",
    read: true,
    headers: unsub("uniqlo.com"),
  },
  {
    in: ["personal"],
    from: ["Dr. Patel's Office", "frontdesk@sfdental.com"],
    subject: "Appointment reminder: Nov 4 at 9:00",
    body: "This is a reminder of your cleaning appointment on Tuesday, Nov 4 at 9:00 AM. Reply C to confirm.",
    ago: 4200,
    category: "notification",
    read: true,
  },
];

const SENT: Seed[] = [
  { in: ["work"], from: ["Marcus Chen", "marcus@northwind.io"], subject: "Re: Sync latency regression", body: "I think it's the new batching code. Looking now.", ago: 2400, category: "primary", read: true, folder: "sent" },
];

/** A body for messages that should render as HTML (newsletters). */
function htmlFor(s: Seed): string | null {
  if (s.category !== "newsletter" && s.category !== "promotion") return null;
  return `<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#222;line-height:1.6"><h1 style="font-size:22px;margin:0 0 12px">${s.subject}</h1><p>${s.body}</p><p><a href="https://example.com">Read online</a></p><hr style="border:none;border-top:1px solid #ddd"><p style="font-size:12px;color:#777">You're receiving this because you subscribed. <a href="https://example.com/unsubscribe">Unsubscribe</a></p></div>`;
}

/** Wipe the user's demo accounts and seed fresh ones. Development and e2e tests only. */
export async function seedDemo(s: Services, userId: string, opts: { labels?: boolean; onboarded?: boolean } = {}): Promise<void> {
  // Reset
  for (const a of await s.db.select().from(accounts).where(eq(accounts.userId, userId))) await disconnectAccount(s, a);
  await s.db.delete(labels).where(eq(labels.userId, userId));

  const rows = new Map<DemoAccount["key"], Awaited<ReturnType<typeof createAccount>>>();
  for (const a of ACCOUNTS) {
    const row = await createAccount(s, userId, {
      provider: a.provider,
      displayName: a.address,
      color: a.color,
      credentials: { demo: true, address: a.address, displayName: a.name },
      identities: [{ address: a.address, displayName: a.name }],
    });
    await s.db.update(accounts).set({ status: "active", lastSyncedAt: new Date(), syncCursor: "demo" }).where(eq(accounts.id, row.id));
    rows.set(a.key, row);
  }

  const now = Date.now();
  let n = 0;
  const all = [...SEEDS, ...SENT];
  const assigned: { rfc: string; category: Category; labels: string[] }[] = [];
  for (const seed of all) {
    for (const key of seed.in) {
      const acct = ACCOUNTS.find((a) => a.key === key)!;
      const row = rows.get(key)!;
      const batch: NormalizedMessage[] = [];
      const refs: string[] = [];
      const thread = [...(seed.history ?? []), { from: seed.folder === "sent" ? ("me" as const) : seed.from, body: seed.body, ago: seed.ago }];
      thread.forEach((m, i) => {
        const rfc = `demo-${all.indexOf(seed)}-${i}@ostra.demo`;
        const mine = m.from === "me";
        const from = mine ? { name: acct.name, address: acct.address } : { name: (m.from as [string, string])[0], address: (m.from as [string, string])[1] };
        const last = i === thread.length - 1;
        batch.push({
          providerMessageId: `demo:${key}:${++n}`,
          rfcMessageId: rfc,
          inReplyTo: refs[refs.length - 1] ?? null,
          references: [...refs],
          from,
          to: mine ? [{ name: seed.from[0], address: seed.from[1] }] : [{ name: acct.name, address: acct.address }],
          cc: [],
          bcc: [],
          replyTo: [],
          subject: i === 0 || seed.subject.startsWith("Re:") ? seed.subject : `Re: ${seed.subject}`,
          snippet: "",
          bodyText: m.body,
          bodyHtml: last ? htmlFor(seed) : null,
          attachments: last ? (seed.attachments ?? []).map((a, j) => ({ ...a, providerAttachmentId: String(j) })) : [],
          sentAt: new Date(now - m.ago * 60_000).toISOString(),
          folder: mine ? "sent" : (seed.folder ?? "inbox"),
          isRead: mine || !last || !!seed.read,
          headers: last ? (seed.headers ?? {}) : {},
        });
        refs.push(rfc);
      });
      await ingestBatch(s, row, { messages: batch, updates: [], deleted: [] });
      assigned.push({ rfc: refs[refs.length - 1]!, category: seed.category, labels: seed.labels ?? [] });
    }
  }

  // Categories (as the AI would have assigned them) and labels.
  if (opts.labels !== false) {
    const founder = LABEL_TEMPLATES.find((t) => t.id === "founder")!;
    const dev = LABEL_TEMPLATES.find((t) => t.id === "developer")!;
    await s.db
      .insert(labels)
      .values([...founder.labels.map((l) => ({ ...l, t: founder.id })), ...dev.labels.map((l) => ({ ...l, t: dev.id }))].map((l) => ({ userId, name: l.name, color: l.color, description: l.description, sourceTemplate: l.t })))
      .onConflictDoNothing();
  }
  const labelRows = await s.db.select().from(labels).where(eq(labels.userId, userId));
  for (const a of assigned) {
    const [m] = await s.db.select({ id: messages.id, threadId: messages.threadId }).from(messages).where(and(eq(messages.userId, userId), eq(messages.rfcMessageId, a.rfc)));
    if (!m) continue;
    await s.db.update(threads).set({ category: a.category, categorySource: "heuristic", categoryConfidence: 0.9, aiPending: false }).where(eq(threads.id, m.threadId));
    const ids = labelRows.filter((l) => a.labels.includes(l.name)).map((l) => l.id);
    if (ids.length) await s.db.insert(messageLabels).values(ids.map((labelId) => ({ messageId: m.id, labelId, source: "ai" as const, confidence: 0.86 }))).onConflictDoNothing();
  }
  await s.db.update(threads).set({ aiPending: false }).where(eq(threads.userId, userId));

  const startup = rows.get("startup")!;
  const [identity] = await s.db.query.identities.findMany({ where: (i, { eq: e }) => e(i.accountId, startup.id) });
  await updateSettings(s.db, userId, { onboarded: opts.onboarded ?? true, defaultIdentityId: identity?.id ?? null });
}
