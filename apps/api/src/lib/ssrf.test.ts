import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPublicHost } from "./ssrf.ts";

test("private, loopback, link-local and metadata addresses are rejected", async () => {
  for (const h of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fd00::1", "localhost", "mail.internal", "0.0.0.0"]) {
    await assert.rejects(assertPublicHost(h), { name: "UnsafeHostError" }, h);
  }
});

test("public addresses pass, and private ones pass when explicitly allowed", async () => {
  await assertPublicHost("1.1.1.1");
  await assertPublicHost("2606:4700:4700::1111");
  await assertPublicHost("127.0.0.1", { allowPrivate: true });
});
