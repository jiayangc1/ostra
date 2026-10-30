import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import type { Envelope } from "./crypto.ts";

/** Object storage for message bodies and attachments. Everything stored is encrypted. */
export interface BlobStore {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}

/** Local filesystem store for development and single-node deploys. */
export class FsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  private path(key: string): string {
    const p = normalize(join(this.root, key));
    if (!p.startsWith(normalize(this.root))) throw new Error("Invalid blob key");
    return p;
  }

  async put(key: string, data: Uint8Array) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data, { mode: 0o600 });
  }

  async get(key: string) {
    try {
      return await readFile(this.path(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }

  async deletePrefix(prefix: string) {
    await rm(this.path(prefix), { recursive: true, force: true });
  }
}

export class MemoryBlobStore implements BlobStore {
  readonly data = new Map<string, Buffer>();
  async put(key: string, data: Uint8Array) {
    this.data.set(key, Buffer.from(data));
  }
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async delete(key: string) {
    this.data.delete(key);
  }
  async deletePrefix(prefix: string) {
    for (const k of this.data.keys()) if (k.startsWith(prefix)) this.data.delete(k);
  }
}

/** S3-compatible store (AWS S3, R2, MinIO, Bunny S3). The SDK is loaded lazily. */
export class S3BlobStore implements BlobStore {
  private clientPromise: Promise<{ client: import("@aws-sdk/client-s3").S3Client; sdk: typeof import("@aws-sdk/client-s3") }>;

  constructor(
    private readonly bucket: string,
    opts: { region: string; endpoint?: string | undefined; accessKeyId?: string | undefined; secretAccessKey?: string | undefined },
  ) {
    this.clientPromise = import("@aws-sdk/client-s3").then((sdk) => ({
      sdk,
      client: new sdk.S3Client({
        region: opts.region,
        endpoint: opts.endpoint,
        forcePathStyle: !!opts.endpoint,
        credentials: opts.accessKeyId && opts.secretAccessKey ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } : undefined,
      }),
    }));
  }

  async put(key: string, data: Uint8Array) {
    const { client, sdk } = await this.clientPromise;
    await client.send(new sdk.PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: "application/octet-stream" }));
  }

  async get(key: string) {
    const { client, sdk } = await this.clientPromise;
    try {
      const res = await client.send(new sdk.GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch (e) {
      if ((e as { name?: string }).name === "NoSuchKey") return null;
      throw e;
    }
  }

  async delete(key: string) {
    const { client, sdk } = await this.clientPromise;
    await client.send(new sdk.DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deletePrefix(prefix: string) {
    const { client, sdk } = await this.clientPromise;
    let token: string | undefined;
    do {
      const list = await client.send(new sdk.ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) await client.send(new sdk.DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } }));
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
  }
}

/** Wraps a store so every object is envelope-encrypted at rest. */
export class EncryptedBlobStore {
  constructor(
    private readonly store: BlobStore,
    private readonly envelope: Envelope,
  ) {}

  putJson(key: string, value: unknown) {
    return this.store.put(key, this.envelope.encrypt(Buffer.from(JSON.stringify(value), "utf8")));
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.store.get(key);
    return raw ? (JSON.parse(this.envelope.decrypt(raw).toString("utf8")) as T) : null;
  }

  put(key: string, data: Uint8Array) {
    return this.store.put(key, this.envelope.encrypt(data));
  }

  async get(key: string) {
    const raw = await this.store.get(key);
    return raw ? this.envelope.decrypt(raw) : null;
  }

  delete(key: string) {
    return this.store.delete(key);
  }

  deletePrefix(prefix: string) {
    return this.store.deletePrefix(prefix);
  }
}
