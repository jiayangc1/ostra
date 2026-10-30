import { extractEvents, mightContainEvent } from "@ostra/ai";
import { htmlToText, parseIcs, type ExtractedEvent } from "@ostra/core";
import { accounts, and, eq, inArray, messages, sql, threads, users } from "@ostra/db";
import { loadAttachment } from "./attachments.ts";
import type { Services } from "./context.ts";
import { summarize, type StoredBody } from "./threads.ts";
import { settingsOf } from "./users.ts";

const isIcs = (a: { contentType: string; filename: string; size: number }) =>
  (/^(text|application)\/(calendar|ics)\b/i.test(a.contentType) || /\.ics$/i.test(a.filename)) && a.size < 1_000_000;

/**
 * Find calendar events in freshly ingested mail. .ics invites are always
 * read (exact data, no model). Plain-text mail goes to the fast model only
 * when AI is allowed for the user and the account, "Find events" is on,
 * the mail isn't a newsletter or promotion, and a local pre-filter sees a
 * date. Runs after categorization so the category is known.
 */
export async function scanEvents(s: Services, userId: string, messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  const [user] = await s.db.select().from(users).where(eq(users.id, userId));
  if (!user) return;
  const settings = settingsOf(user);
  const rows = await s.db
    .select({ m: messages, category: threads.category })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .where(and(eq(messages.userId, userId), inArray(messages.id, messageIds)));
  const aiAccounts = new Set((await s.db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.userId, userId), eq(accounts.aiEnabled, true)))).map((a) => a.id));
  const llm = s.ai.llm;
  const touched = new Set<string>();
  let failed = 0;
  /** Scanned, nothing found: written in one statement at the end. */
  const empty: string[] = [];

  for (const { m, category } of rows) {
    if (m.extracted.eventsScanned) continue;
    let events: ExtractedEvent[] = [];
    let body: StoredBody | null = null;
    const getBody = async () => (body ??= m.bodyRef ? await s.blobs.getJson<StoredBody>(m.bodyRef).catch(() => null) : null);

    // 1. Invites: attachments, or an inline calendar body some clients send.
    for (const [i, a] of m.attachments.entries()) {
      if (!isIcs(a)) continue;
      try {
        const bytes = await loadAttachment(s, m, i);
        if (bytes) events.push(...parseIcs(bytes.toString("utf8"), { fallbackTimeZone: settings.timeZone }));
      } catch (err) {
        s.log.warn("ics read failed", { messageId: m.id }, err);
      }
    }
    // A calendar sent as the body starts with BEGIN:VCALENDAR, so the snippet shows it; skip the body read otherwise.
    if (events.length === 0 && m.attachments.length === 0 && m.snippet.includes("BEGIN:VCALENDAR")) {
      const text = (await getBody())?.text ?? "";
      if (text.includes("BEGIN:VCALENDAR")) events = parseIcs(text, { fallbackTimeZone: settings.timeZone });
    }

    // 2. Plain text, with the model.
    const mayUseModel = !!llm && settings.aiEnabled && settings.findEvents && aiAccounts.has(m.accountId);
    let scanned = true;
    if (events.length === 0 && mayUseModel && category !== "newsletter" && category !== "promotion") {
      const b = await getBody();
      const text = b?.text ?? (b?.html ? htmlToText(b.html) : m.snippet);
      if (mightContainEvent(m.subject, text)) {
        try {
          events = await extractEvents(llm!, { subject: m.subject, from: m.from, body: text, sentAt: m.sentAt.toISOString(), timeZone: settings.timeZone });
        } catch (err) {
          // Left unscanned; the job fails below and the queue retries it with backoff.
          s.log.warn("event extraction failed", { messageId: m.id }, err);
          scanned = false;
          failed++;
        }
      }
    }

    // Dedupe the same event listed twice (some invites repeat it in the body).
    const seen = new Set<string>();
    events = events.filter((e) => {
      const k = `${e.title}|${e.start}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });
    if (events.length === 0) {
      if (scanned) empty.push(m.id);
      continue;
    }
    // Only if nobody scanned it meanwhile (a concurrent worker, or the demo seed).
    const written = await s.db
      .update(messages)
      .set({ extracted: sql`${messages.extracted} || ${JSON.stringify({ events, eventsScanned: scanned })}::jsonb` })
      .where(and(eq(messages.id, m.id), sql`coalesce((${messages.extracted}->>'eventsScanned')::boolean, false) = false`))
      .returning({ id: messages.id });
    if (written.length) touched.add(m.threadId);
  }
  if (empty.length) {
    await s.db
      .update(messages)
      .set({ extracted: sql`${messages.extracted} || '{"events":[],"eventsScanned":true}'::jsonb` })
      .where(and(inArray(messages.id, empty), sql`coalesce((${messages.extracted}->>'eventsScanned')::boolean, false) = false`));
  }

  if (touched.size) {
    const rows = await s.db.select().from(threads).where(inArray(threads.id, [...touched]));
    for (const t of await summarize(s.db, rows)) s.hub.publish(userId, { type: "thread.upsert", thread: t });
  }
  if (failed) throw new Error(`event extraction failed for ${failed} message(s)`);
}
