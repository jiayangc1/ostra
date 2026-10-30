import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Envelope } from "./crypto.ts";

test("envelope round-trips and uses a fresh data key per record", () => {
  const env = new Envelope(new Map([[1, randomBytes(32)]]));
  const a = env.encryptJson({ refreshToken: "secret" });
  const b = env.encryptJson({ refreshToken: "secret" });
  assert.notEqual(a, b);
  assert.ok(!Buffer.from(a, "base64").toString("latin1").includes("secret"));
  assert.deepEqual(env.decryptJson(a), { refreshToken: "secret" });
});

test("tampering is detected", () => {
  const env = new Envelope(new Map([[1, randomBytes(32)]]));
  const ct = env.encrypt(Buffer.from("hello"));
  ct[ct.length - 1]! ^= 1;
  assert.throws(() => env.decrypt(ct));
});

test("rotation: old ciphertexts stay readable, new ones use the newest key", () => {
  const k1 = randomBytes(32);
  const old = new Envelope(new Map([[1, k1]])).encrypt(Buffer.from("v1"));
  const rotated = Envelope.fromEnv(`1:${k1.toString("base64")},2:${randomBytes(32).toString("base64")}`);
  assert.equal(rotated.decrypt(old).toString(), "v1");
  assert.equal(rotated.encrypt(Buffer.from("v2"))[1], 2);
});
