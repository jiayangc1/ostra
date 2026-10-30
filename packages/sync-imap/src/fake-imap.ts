/**
 * Minimal in-memory stand-in for ImapFlow, covering exactly the calls the
 * provider makes. Used by tests only.
 */
import { EventEmitter } from "node:events";

interface StoredMessage {
  uid: number;
  source: Buffer;
  flags: Set<string>;
  internalDate: Date;
}

export interface FakeBox {
  path: string;
  specialUse?: string;
  uidValidity: bigint;
  uidNext: number;
  messages: StoredMessage[];
}

export class FakeServer {
  boxes = new Map<string, FakeBox>();
  rejectAuth = false;
  appended: { path: string; raw: Buffer }[] = [];

  addBox(path: string, specialUse?: string) {
    this.boxes.set(path, { path, specialUse, uidValidity: 1n, uidNext: 1, messages: [] });
    return this;
  }

  deliver(path: string, raw: string | Buffer, flags: string[] = []) {
    const box = this.boxes.get(path)!;
    const uid = box.uidNext++;
    box.messages.push({ uid, source: Buffer.from(raw), flags: new Set(flags), internalDate: new Date() });
    return uid;
  }
}

function parseSet(set: string): (uid: number) => boolean {
  const parts = set.split(",").map((p) => p.split(":").map(Number));
  return (uid) => parts.some(([a, b]) => (b === undefined ? uid === a : uid >= a! && uid <= b));
}

export class FakeImapFlow extends EventEmitter {
  usable = false;
  mailbox: { path: string; uidValidity: bigint; uidNext: number; exists: number } | null = null;

  constructor(private readonly server: FakeServer) {
    super();
  }

  async connect() {
    if (this.server.rejectAuth) throw Object.assign(new Error("Invalid credentials"), { authenticationFailed: true });
    this.usable = true;
  }
  async logout() {
    this.usable = false;
  }
  close() {
    this.usable = false;
  }
  async list() {
    return [...this.server.boxes.values()].map((b) => ({ path: b.path, specialUse: b.specialUse, delimiter: "/", flags: new Set<string>() }));
  }
  private box() {
    return this.server.boxes.get(this.mailbox!.path)!;
  }
  async getMailboxLock(path: string) {
    const b = this.server.boxes.get(path);
    if (!b) throw new Error(`No mailbox ${path}`);
    this.mailbox = { path, uidValidity: b.uidValidity, uidNext: b.uidNext, exists: b.messages.length };
    return { path, release: () => {} };
  }
  async mailboxOpen(path: string) {
    return this.getMailboxLock(path);
  }
  async mailboxCreate(path: string) {
    this.server.addBox(path);
    return { path, created: true };
  }
  async search() {
    return this.box().messages.map((m) => m.uid);
  }
  async *fetch(range: string, query: { source?: boolean }) {
    const match = parseSet(range);
    for (const m of this.box().messages.filter((x) => match(x.uid))) {
      yield { seq: m.uid, uid: m.uid, flags: new Set(m.flags), internalDate: m.internalDate, ...(query.source ? { source: m.source } : {}) };
    }
  }
  async fetchOne(uid: string) {
    const m = this.box().messages.find((x) => x.uid === Number(uid));
    return m ? { seq: m.uid, uid: m.uid, source: m.source } : false;
  }
  async messageFlagsAdd(range: string, flags: string[]) {
    for (const m of this.box().messages.filter((x) => parseSet(range)(x.uid))) flags.forEach((f) => m.flags.add(f));
    return true;
  }
  async messageFlagsRemove(range: string, flags: string[]) {
    for (const m of this.box().messages.filter((x) => parseSet(range)(x.uid))) flags.forEach((f) => m.flags.delete(f));
    return true;
  }
  async messageMove(range: string, dest: string) {
    const from = this.box();
    const to = this.server.boxes.get(dest)!;
    const uidMap = new Map<number, number>();
    for (const m of from.messages.filter((x) => parseSet(range)(x.uid))) {
      const uid = to.uidNext++;
      to.messages.push({ ...m, uid });
      uidMap.set(m.uid, uid);
    }
    from.messages = from.messages.filter((x) => !uidMap.has(x.uid));
    return { path: from.path, destination: dest, uidValidity: to.uidValidity, uidMap };
  }
  async append(path: string, raw: Buffer, flags: string[] = []) {
    this.server.appended.push({ path, raw });
    const uid = this.server.deliver(path, raw, flags);
    return { destination: path, uid, uidValidity: this.server.boxes.get(path)!.uidValidity };
  }
}
