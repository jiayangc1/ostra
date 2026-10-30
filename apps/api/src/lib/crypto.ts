import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Envelope encryption. Every record gets its own random data key (DEK);
 * the DEK is wrapped with the master key (KEK). Rotating the KEK only means
 * re-wrapping DEKs. AES-256-GCM throughout.
 *
 * Wire format (bytes): version(1) | keyId(1) | wrapIv(12) | wrapTag(16) | wrappedDek(32) | iv(12) | tag(16) | ciphertext
 */
const VERSION = 1;
const HEADER = 1 + 1 + 12 + 16 + 32 + 12 + 16;

export class Envelope {
  private readonly keys: Map<number, Buffer>;
  private readonly currentId: number;

  /** `masterKeys` maps key id → 32-byte key; the highest id encrypts new data. */
  constructor(masterKeys: Map<number, Buffer>) {
    if (masterKeys.size === 0) throw new Error("Envelope needs at least one master key");
    for (const k of masterKeys.values()) if (k.length !== 32) throw new Error("Master keys must be 32 bytes");
    this.keys = masterKeys;
    this.currentId = Math.max(...masterKeys.keys());
  }

  /** Parse `OSTRA_MASTER_KEY`: `base64` or `1:base64,2:base64` for rotation. */
  static fromEnv(value: string): Envelope {
    const keys = new Map<number, Buffer>();
    const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
    parts.forEach((part, i) => {
      const [maybeId, maybeKey] = part.includes(":") ? part.split(":") : [String(i + 1), part];
      keys.set(Number(maybeId), Buffer.from(maybeKey!, "base64"));
    });
    return new Envelope(keys);
  }

  /** Development only: a key persisted under the data dir so local data survives restarts. */
  static fromDevKeyFile(path: string): Envelope {
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, randomBytes(32).toString("base64"), { mode: 0o600 });
    }
    return Envelope.fromEnv(readFileSync(path, "utf8").trim());
  }

  encrypt(plaintext: Uint8Array): Buffer {
    const kek = this.keys.get(this.currentId)!;
    const dek = randomBytes(32);
    const wrapIv = randomBytes(12);
    const wrap = createCipheriv("aes-256-gcm", kek, wrapIv);
    const wrappedDek = Buffer.concat([wrap.update(dek), wrap.final()]);
    const wrapTag = wrap.getAuthTag();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dek, iv);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([VERSION, this.currentId]), wrapIv, wrapTag, wrappedDek, iv, tag, ct]);
  }

  decrypt(blob: Uint8Array): Buffer {
    const buf = Buffer.from(blob);
    if (buf.length < HEADER || buf[0] !== VERSION) throw new Error("Unrecognized ciphertext");
    const kek = this.keys.get(buf[1]!);
    if (!kek) throw new Error(`Unknown master key id ${buf[1]}`);
    let o = 2;
    const wrapIv = buf.subarray(o, (o += 12));
    const wrapTag = buf.subarray(o, (o += 16));
    const wrappedDek = buf.subarray(o, (o += 32));
    const iv = buf.subarray(o, (o += 12));
    const tag = buf.subarray(o, (o += 16));
    const ct = buf.subarray(o);
    const unwrap = createDecipheriv("aes-256-gcm", kek, wrapIv);
    unwrap.setAuthTag(wrapTag);
    const dek = Buffer.concat([unwrap.update(wrappedDek), unwrap.final()]);
    const decipher = createDecipheriv("aes-256-gcm", dek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }

  encryptJson(value: unknown): string {
    return this.encrypt(Buffer.from(JSON.stringify(value), "utf8")).toString("base64");
  }

  decryptJson<T>(value: string): T {
    return JSON.parse(this.decrypt(Buffer.from(value, "base64")).toString("utf8")) as T;
  }
}
