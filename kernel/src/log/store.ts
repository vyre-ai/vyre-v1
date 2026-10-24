// The synchronous log store over one DatabaseSync (events.db). It runs inside the db worker (worker.ts) and directly in tests. Nothing here awaits.
// Reused from 0.6 kernel/core/events.js (envelope, hash input, verify, erase) and kernel/store/sqlite-log.js (generated columns); the in-memory window and consumers are not
// part of this packet.
import { DatabaseSync } from "node:sqlite";
import { canonical } from "../../../lib/canonical.ts";
import { mintUuid } from "../../../lib/ids.ts";
import { clampHlc, compareHlc, formatHlc, parseHlc, tickHlc } from "../../../lib/hlc.ts";
import type { Hlc } from "../../../lib/hlc.ts";
import { LogError } from "./errors.ts";
import { genesis, newSalt, sha256Hex, toHex } from "./hash.ts";
import { SCHEMA } from "./schema.ts";
import type { AppendResult, Envelope, NewEvent, ReadQuery, StoredEvent, VerifyResult } from "./types.ts";

const TYPE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const TRACE = /^[0-9a-f]{32}$/;
const ACTOR = /^(usr|agt|act|svc)_[A-Za-z0-9_-]+$/;
const VIS = new Set(["space", "participants", "owner", "private"]);
const TOMBSTONE = new TextEncoder().encode('{"erased":true}');
const BATCH = 500;
export const SERVER_DEVICE = "srv";

export interface StoreOptions {
  db: DatabaseSync;
  space: string;
  clock?: () => number;
}

function validate(ev: NewEvent): void {
  const bad = (m: string): never => { throw new LogError("bad_event", m); };
  if (!ev || typeof ev !== "object") bad("an event is an object");
  if (typeof ev.type !== "string" || !TYPE.test(ev.type)) bad("event type must look like noun.past_verb");
  if (!Number.isInteger(ev.sv) || ev.sv < 1) bad("event needs a schema version of 1 or more");
  if (typeof ev.trace_id !== "string" || !TRACE.test(ev.trace_id)) bad("trace_id is 32 hex characters");
  if (typeof ev.actor !== "string" || !ACTOR.test(ev.actor)) bad("actor is a usr_, agt_, act_ or svc_ id");
  if (!VIS.has(ev.vis)) bad("unknown visibility");
  if (ev.label !== undefined && !(Number.isInteger(ev.label) && ev.label >= 0 && ev.label <= 3)) bad("label is a rank 0 to 3");
  if (ev.enc !== undefined && ![0, 1, 2].includes(ev.enc)) bad("enc is 0, 1 or 2");
  if (ev.depth !== undefined && !(Number.isInteger(ev.depth) && ev.depth >= 0 && ev.depth <= 64)) bad("depth is 0 to 64");
  if (ev.fields !== undefined && !(Array.isArray(ev.fields) && ev.fields.every((f) => typeof f === "string"))) bad("fields is a list of keys");
  if (ev.payload === undefined) bad("an event needs a payload (null is fine)");
  if ((ev.enc ?? 0) > 0 && !(ev.payload instanceof Uint8Array)) bad("an encrypted event carries its ciphertext bytes");
  if (ev.id !== undefined && (typeof ev.id !== "string" || ev.id.length < 8 || ev.id.length > 80)) bad("event id is 8 to 80 characters");
}

const payloadBytes = (p: unknown): Uint8Array => (p instanceof Uint8Array ? p : new TextEncoder().encode(canonical(p)));

/** The hash input: the envelope without `hash`. */
export function hashOf(e: Omit<Envelope, "hash"> | Envelope): string {
  const { hash: _h, ...rest } = e as Envelope;
  return sha256Hex(canonical(rest));
}

function makeStmts(db: DatabaseSync) {
  return {
    ins: db.prepare("INSERT INTO events (seq, event, payload) VALUES (?, ?, ?)"),
    salt: db.prepare("INSERT INTO event_salts (event_id, salt) VALUES (?, ?)"),
    byId: db.prepare("SELECT seq, event, payload FROM events WHERE id = ?"),
    bySeq: db.prepare("SELECT seq, event, payload FROM events WHERE seq = ?"),
    last: db.prepare("SELECT seq, event FROM events ORDER BY seq DESC LIMIT 1"),
    meta: db.prepare("INSERT INTO log_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
    getMeta: db.prepare("SELECT value FROM log_meta WHERE key = ?"),
    saltOf: db.prepare("SELECT salt FROM event_salts WHERE event_id = ?"),
    erase: db.prepare("UPDATE events SET payload = ? WHERE seq = ?"),
    dropSalt: db.prepare("DELETE FROM event_salts WHERE event_id = ?"),
    page: db.prepare("SELECT seq, event FROM events WHERE seq > ? ORDER BY seq LIMIT ?"),
    count: db.prepare("SELECT COUNT(*) AS n FROM events"),
  };
}


export class LogStore {
  readonly space: string;
  readonly db: DatabaseSync;
  private clock: () => number;
  private headSeq = 0;
  private headHash: string;
  private lastHlc: Hlc | null = null;
  private stmts: ReturnType<typeof makeStmts>;

  constructor(o: StoreOptions) {
    this.space = o.space;
    this.db = o.db;
    this.clock = o.clock ?? Date.now;
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
    const meta = this.db.prepare("SELECT value FROM log_meta WHERE key = 'space'").get() as { value: string } | undefined;
    if (meta && meta.value !== o.space) throw new LogError("wrong_space", `this database belongs to ${meta.value}`);
    if (!meta) this.db.prepare("INSERT INTO log_meta (key, value) VALUES ('space', ?)").run(o.space);
    this.headHash = genesis(o.space);
    this.stmts = makeStmts(this.db);
    this.reload();
  }

  /** Re-read the head from disk (open, and after a rolled-back batch). */
  private reload(): void {
    const row = this.stmts.last.get() as { seq: number; event: string } | undefined;
    if (!row) { this.headSeq = 0; this.headHash = genesis(this.space); this.lastHlc = null; return; }
    const e = JSON.parse(row.event) as Envelope;
    this.headSeq = e.seq; this.headHash = e.hash; this.lastHlc = parseHlc(e.hlc);
  }

  get head(): { seq: number; hash: string } { return { seq: this.headSeq, hash: this.headHash }; }

  private stored(row: { event: string; payload: Uint8Array }): StoredEvent {
    return { ...(JSON.parse(row.event) as Envelope), payload: new Uint8Array(row.payload) };
  }

  /**
   * Append events as ONE transaction (the group commit). Each item gets its own result: a malformed event is refused alone, an id already in the log returns the stored event
   * with `duplicate: true` and writes nothing. If the transaction itself fails every item fails and the head is restored from disk.
   */
  appendBatch(batch: NewEvent[]): AppendResult[] {
    const out: AppendResult[] = new Array(batch.length);
    const now = this.clock();
    const savedHead = { seq: this.headSeq, hash: this.headHash, hlc: this.lastHlc };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      batch.forEach((ev, i) => {
        try {
          validate(ev);
          if (ev.id !== undefined) {
            const dup = this.stmts.byId.get(ev.id) as { event: string; payload: Uint8Array } | undefined;
            if (dup) { out[i] = { ok: true, event: this.stored(dup), duplicate: true }; return; }
          }
          out[i] = { ok: true, event: this.write(ev, now), duplicate: false };
        } catch (e) {
          if (e instanceof LogError) out[i] = { ok: false, code: e.code, message: e.message };
          else throw e;
        }
      });
      this.stmts.meta.run("head_seq", String(this.headSeq));
      this.stmts.meta.run("head_hash", this.headHash);
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      try { this.db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      this.headSeq = savedHead.seq; this.headHash = savedHead.hash; this.lastHlc = savedHead.hlc;
      const message = e instanceof Error ? e.message : String(e);
      return batch.map(() => ({ ok: false as const, code: "internal", message }));
    }
  }

  private write(ev: NewEvent, now: number): StoredEvent {
    // hlc: a client value is clamped to server now + 5 minutes; otherwise the server ticks after the last one it issued.
    let hlc: Hlc, skew: number | undefined;
    if (ev.hlc !== undefined) {
      const parsed = parseHlc(ev.hlc);
      if (!parsed) throw new LogError("bad_event", "hlc is not <ms-hex>-<counter-hex>-<device>");
      const c = clampHlc(parsed, now);
      hlc = c.hlc;
      if (c.clamped) skew = c.skewMs;
    } else hlc = tickHlc(SERVER_DEVICE, now, this.lastHlc);
    if (!this.lastHlc || compareHlc(hlc, this.lastHlc) > 0) this.lastHlc = hlc;

    const body = payloadBytes(ev.payload);
    const salt = newSalt();
    const id = ev.id ?? mintUuid(now);
    const seq = this.headSeq + 1;
    const e: Omit<Envelope, "hash"> = {
      seq, id, type: ev.type, sv: ev.sv, hlc: formatHlc(hlc), at: now,
      ...(skew !== undefined ? { skew_ms: skew } : {}),
      trace_id: ev.trace_id,
      ...(ev.span_id !== undefined ? { span_id: ev.span_id } : {}),
      actor: ev.actor,
      ...(ev.on_behalf !== undefined ? { on_behalf: ev.on_behalf } : {}),
      ...(ev.device !== undefined ? { device: ev.device } : {}),
      ...(ev.run_id !== undefined ? { run_id: ev.run_id } : {}),
      ...(ev.cause !== undefined ? { cause: ev.cause } : {}),
      ...(ev.origin !== undefined ? { origin: ev.origin } : {}),
      depth: ev.depth ?? 0,
      ...(ev.entity !== undefined ? { entity: ev.entity } : {}),
      ...(ev.entity_id !== undefined ? { entity_id: ev.entity_id } : {}),
      ...(ev.fields !== undefined ? { fields: ev.fields } : {}),
      label: ev.label ?? 0, vis: ev.vis, enc: ev.enc ?? 0,
      ...(ev.key_id !== undefined ? { key_id: ev.key_id } : {}),
      ...(ev.nonce !== undefined ? { nonce: ev.nonce } : {}),
      commit: sha256Hex(salt, body),
      prev: this.headHash,
    };
    const full: Envelope = { ...e, hash: hashOf(e) };
    this.stmts.ins.run(seq, JSON.stringify(full), body);
    this.stmts.salt.run(id, salt);
    this.headSeq = seq; this.headHash = full.hash;
    return { ...full, payload: body };
  }

  get(seq: number): StoredEvent | null {
    const r = this.stmts.bySeq.get(seq) as { event: string; payload: Uint8Array } | undefined;
    return r ? this.stored(r) : null;
  }

  /** Events matching the query, oldest first. The database filters by the generated, indexed columns. */
  read(q: ReadQuery = {}): StoredEvent[] {
    const where = ["seq > ?"], args: (string | number)[] = [q.after ?? 0];
    if (q.before !== undefined) { where.push("seq < ?"); args.push(q.before); }
    if (q.type && q.type !== "*") {
      if (q.type.endsWith(".*")) { const pre = q.type.slice(0, -1); where.push("type >= ? AND type < ?"); args.push(pre, pre.slice(0, -1) + String.fromCharCode(pre.charCodeAt(pre.length - 1) + 1)); }
      else { where.push("type = ?"); args.push(q.type); }
    }
    for (const k of ["entity", "entity_id", "run_id", "trace_id"] as const) if (q[k] !== undefined) { where.push(`${k} = ?`); args.push(q[k]!); }
    const limit = Math.min(Math.max(q.limit ?? 500, 1), 5000);
    const rows = this.db.prepare(`SELECT event, payload FROM events WHERE ${where.join(" AND ")} ORDER BY seq LIMIT ?`).all(...args, limit) as { event: string; payload: Uint8Array }[];
    return rows.map((r) => this.stored(r));
  }

  /**
   * Recompute the chain from what is on disk. From the start by default; `{ from, prev }` starts after event `from` whose hash is `prev` (a checkpoint already trusted).
   * Fails on: a seq gap, a prev that does not match, an envelope whose hash is wrong, and a log shorter than the head recorded at the last commit (tail truncation).
   */
  verify(o: { from?: number; prev?: string } = {}): VerifyResult {
    let prev = o.from ? o.prev : genesis(this.space);
    if (o.from && typeof prev !== "string") return { ok: false, at: o.from, why: "a start point needs the hash of the event before it" };
    let n = o.from ?? 0;
    for (;;) {
      const rows = this.stmts.page.all(n, BATCH) as { seq: number; event: string }[];
      if (!rows.length) break;
      for (const r of rows) {
        let e: Envelope;
        try { e = JSON.parse(r.event) as Envelope; } catch { return { ok: false, at: r.seq, why: "the stored envelope is not JSON" }; }
        n++;
        if (r.seq !== n || e.seq !== n) return { ok: false, at: Math.min(r.seq, n), why: "seq is not contiguous" };
        if (e.prev !== prev) return { ok: false, at: n, why: "prev does not match the event before" };
        if (hashOf(e) !== e.hash) return { ok: false, at: n, why: "hash does not match the envelope" };
        prev = e.hash;
      }
    }
    const recorded = Number((this.stmts.getMeta.get("head_seq") as { value: string } | undefined)?.value ?? 0);
    const recordedHash = (this.stmts.getMeta.get("head_hash") as { value: string } | undefined)?.value;
    if (n < recorded) return { ok: false, at: n + 1, why: "the log is shorter than the head it recorded" };
    if (n === recorded && recordedHash && prev !== recordedHash) return { ok: false, at: n, why: "the last event is not the one the head recorded" };
    return { ok: true, head: prev as string, seq: n };
  }

  /** Does the stored payload still match its commitment? False once erased or edited. */
  proves(seq: number): boolean {
    const ev = this.get(seq);
    if (!ev) return false;
    const s = this.stmts.saltOf.get(ev.id) as { salt: Uint8Array } | undefined;
    return Boolean(s && sha256Hex(s.salt, ev.payload) === ev.commit);
  }

  /** Erase an event's payload and its salt. Envelope, commit and hash stay, so the chain still verifies and no dictionary oracle is left. */
  erase(seq: number): boolean {
    const ev = this.get(seq);
    if (!ev) return false;
    this.db.exec("BEGIN IMMEDIATE");
    try { this.stmts.erase.run(TOMBSTONE, seq); this.stmts.dropSalt.run(ev.id); this.db.exec("COMMIT"); } catch (e) { this.db.exec("ROLLBACK"); throw e; }
    return true;
  }

  count(): number { return (this.stmts.count.get() as { n: number }).n; }

  close(): void { this.db.close(); }
}
