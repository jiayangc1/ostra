import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { waitlist } from "@ostra/db";
import { createHarness, type Harness } from "../test/harness.ts";

let h: Harness;
before(async () => (h = await createHarness()));
after(() => h.close());

test("waitlist stores normalized addresses once and needs no session", async () => {
  const ok = await h.request("/public/waitlist", { method: "POST", user: "", json: { email: "  Sam@Example.com ", source: "hero" } });
  assert.equal(ok.status, 200);
  await h.request("/public/waitlist", { method: "POST", user: "", json: { email: "sam@example.com" } });
  const rows = await h.s.db.select().from(waitlist);
  assert.deepEqual(rows.map((r) => [r.email, r.source]), [["sam@example.com", "hero"]]);
  const bad = await h.request("/public/waitlist", { method: "POST", user: "", json: { email: "nope" } });
  assert.equal(bad.status, 400);
});
