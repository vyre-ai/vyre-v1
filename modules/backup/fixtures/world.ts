// Test world for backup: a handler ctx over the in-memory SQL engine (behind the host's table guard), the real ctx.seal, a Space that keeps a small
// hash-chained event log, blobs and tombstones (the same erase-by-tombstone idea as kernel/src/log), and a memory target that can be made to fail.

import { createCtxSeal } from "../../../host/src/ctx/seal.ts";
import { scopedDb } from "../../../host/src/ctx/db.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { FakeBackupDb, NOW, SPACE, TRACE } from "./db.ts";
import { handlers } from "../handlers/index.ts";
import { describeTarget, pack, sha256Hex, wrap, writeConfig } from "../handlers/run.ts";
import type { ApplyResult, BackupCtx, BackupDrivers, BackupTarget, SnapshotEntry, SpaceSnapshot, SpaceSource, Tombstone, TargetConfig } from "../handlers/run.ts";

export { NOW, SPACE, TRACE };

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---- a memory target

export interface MemoryTarget extends BackupTarget {
  objects: Map<string, Uint8Array>;
  /** make the next calls fail (a bucket that is gone, a drive that was unplugged) */
  down: boolean;
}

export function memoryTarget(): MemoryTarget {
  const objects = new Map<string, Uint8Array>();
  const t: MemoryTarget = {
    objects, down: false,
    async put(k, b) { if (t.down) throw new Error("target is down"); objects.set(k, new Uint8Array(b)); },
    async get(k) { if (t.down) throw new Error("target is down"); return objects.get(k) ?? null; },
    async del(k) { if (t.down) throw new Error("target is down"); objects.delete(k); },
    async ping() { if (t.down) throw new Error("target is down"); },
  };
  return t;
}

// ---- a Space with a chained event log

interface Ev { seq: number; id: string; subject: string; payload: string | null; commit: string; prev: string; hash: string }

export interface FakeSpaceState { events: Ev[]; blobs: Map<string, string>; tombstones: Tombstone[]; vault: Map<string, string> }

const hashOf = (e: { seq: number; id: string; subject: string; commit: string; prev: string }): Promise<string> => sha256Hex(`${e.seq}|${e.id}|${e.subject}|${e.commit}|${e.prev}`);

export class FakeSpace implements SpaceSource {
  events: Ev[] = [];
  blobs = new Map<string, string>();
  tombstoneList: Tombstone[] = [];
  /** secret values the Space holds, by vault item name */
  vault = new Map<string, string>();
  /** files an export is offered, on top of the records */
  extraExport: SnapshotEntry[] = [];
  restores: { mode: "scratch" | "live"; tombstones: Tombstone[] }[] = [];
  failSnapshot = false;
  clock = NOW;

  async append(subject: string, payload: string): Promise<Ev> {
    const prev = this.events.at(-1)?.hash ?? "";
    const base = { seq: this.events.length + 1, id: `evt_${this.events.length + 1}`, subject, commit: await sha256Hex(payload), prev };
    const e: Ev = { ...base, payload, hash: await hashOf(base) };
    this.events.push(e);
    return e;
  }

  /** Erase everything about a subject: the payload goes, the commitment and the chain stay, and a tombstone is written. */
  erase(subject: string, at: number): number {
    let n = 0;
    for (const e of this.events) if (e.subject === subject && e.payload !== null) { e.payload = null; n++; }
    this.tombstoneList.push({ kind: "subject", subject, at });
    return n;
  }

  payloads(subject: string): (string | null)[] {
    return this.events.filter((e) => e.subject === subject).map((e) => e.payload);
  }

  async head(): Promise<{ seq: number; hash: string }> {
    const last = this.events.at(-1);
    return { seq: last?.seq ?? 0, hash: last?.hash ?? "" };
  }

  async snapshot(): Promise<SpaceSnapshot> {
    if (this.failSnapshot) throw new Error("the disk is full");
    const head = await this.head();
    const entries: SnapshotEntry[] = [{ path: "events.json", bytes: enc.encode(JSON.stringify(this.events)) }];
    for (const [name, text] of this.blobs) entries.push({ path: `blobs/${name}`, bytes: enc.encode(text) });
    return { fromSeq: this.events[0]?.seq ?? 0, toSeq: head.seq, headHash: head.hash, entries };
  }

  async tombstones(): Promise<Tombstone[]> {
    return this.tombstoneList.map((t) => ({ ...t }));
  }

  async restore(snapshot: SpaceSnapshot, tombstones: Tombstone[], mode: "scratch" | "live"): Promise<ApplyResult> {
    this.restores.push({ mode, tombstones });
    const evFile = snapshot.entries.find((e) => e.path === "events.json");
    const events = evFile ? (JSON.parse(dec.decode(evFile.bytes)) as Ev[]) : [];
    const blobs = new Map<string, string>();
    for (const e of snapshot.entries) if (e.path.startsWith("blobs/")) blobs.set(e.path.slice(6), dec.decode(e.bytes));
    // replay: every tombstone erases what it names before anything can read it
    let replayed = 0;
    for (const t of tombstones) {
      let hit = false;
      for (const e of events) if (e.subject === t.subject && e.payload !== null) { e.payload = null; hit = true; }
      for (const name of [...blobs.keys()]) if (name === t.subject) { blobs.delete(name); hit = true; }
      if (hit) replayed++;
    }
    // the chain: every event hashes over the one before it
    let prev = "", chainOk = true;
    for (const e of events) {
      if (e.prev !== prev || e.hash !== (await hashOf(e))) { chainOk = false; break; }
      prev = e.hash;
    }
    if (mode === "live") {
      this.events = events;
      this.blobs = blobs;
      this.tombstoneList = mergeInto(this.tombstoneList, tombstones);
    }
    return { checkedEvents: events.length, chainOk, replayed };
  }

  async exportEntries(): Promise<SnapshotEntry[]> {
    const out: SnapshotEntry[] = [];
    for (const e of this.events) if (e.payload !== null) out.push({ path: `records/${e.id}.json`, bytes: enc.encode(JSON.stringify({ subject: e.subject, payload: e.payload })) });
    for (const [name, text] of this.blobs) out.push({ path: `files/${name}`, bytes: enc.encode(text) });
    for (const [name, value] of this.vault) out.push({ path: `vault/${name}.json`, bytes: enc.encode(JSON.stringify({ name, value })) });
    return [...out, ...this.extraExport];
  }

  async owner(): Promise<string> {
    return "usr_owner";
  }

  async secretValues(): Promise<string[]> {
    return [...this.vault.values()];
  }
}

function mergeInto(a: Tombstone[], b: readonly Tombstone[]): Tombstone[] {
  const seen = new Set(a.map((t) => `${t.kind}|${t.subject}`));
  return [...a, ...b.filter((t) => !seen.has(`${t.kind}|${t.subject}`))];
}

// ---- the handler ctx

export interface Saved { fileId: string; name: string; bytes: Uint8Array }
export interface EmittedEvent { name: string; subject: string; payload: unknown }
export interface Scheduled { at: number | string; cap: string; input: unknown }

export interface World {
  raw: FakeBackupDb;
  ctx: BackupCtx;
  space: FakeSpace;
  target: MemoryTarget;
  saved: Saved[];
  events: EmittedEvent[];
  /** the events that capabilities called through ctx.call emitted (the pipeline keeps them apart from the caller's own); also in `events` */
  nested: EmittedEvent[];
  scheduled: Scheduled[];
  calls: { cap: string; input: unknown }[];
  drivers: BackupDrivers;
  setNow(n: number): void;
  allowExport(allow: boolean): void;
  answer(cap: string, a: unknown): void;
}

export const MEMORY_TARGET: TargetConfig = { kind: "local", path: "/srv/vyre-backups" };

export function world(o: { encrypt?: boolean; now?: number; principal?: string } = {}): World {
  const raw = new FakeBackupDb();
  const space = new FakeSpace();
  const target = memoryTarget();
  const saved: Saved[] = [];
  const events: EmittedEvent[] = [];
  const nested: EmittedEvent[] = [];
  const scheduled: Scheduled[] = [];
  const calls: { cap: string; input: unknown }[] = [];
  const answers = new Map<string, unknown>();
  if (o.encrypt === false) answers.set("settings.get", { row: { key: "backup.encrypt", value: false } });
  let clock = o.now ?? NOW;
  let self: BackupCtx | null = null;
  let exportAllowed = true;
  const drivers: BackupDrivers = {
    source: space,
    exports: { async save(name, bytes) { const fileId = `fil_${saved.length + 1}`; saved.push({ fileId, name, bytes }); return { fileId }; } },
    openTarget: async () => target,
  };
  const ctx = {
    ownerArchive:{status:async(runId:string)=>({runId,state:"ready",fileId:"fil_fixture",name:"vyre-export-fixture.zip",sizeBytes:4,expiresAt:clock+86400000})},
    space: SPACE,
    principal: { kind: "person", id: o.principal ?? "usr_owner" },
    trace: { traceId: TRACE, spanId: "abcdef0123456789" },
    depth: 0,
    now: () => clock,
    db: scopedDb("backup", raw, TRACE),
    emit: ((name: string, subject: string, payload: unknown) => { events.push({ name, subject, payload }); return {} as never; }) as unknown as Ctx["emit"],
    call: (async (cap: string, input: unknown) => {
      calls.push({ cap, input });
      // the safety backup before a restore goes through the capability, as the pipeline would route it
      if (cap === "backup.run" && self) {
        const child = { ...self, emit: ((name: string, subject: string, payload: unknown) => { const e = { name, subject, payload }; events.push(e); nested.push(e); return {} as never; }) as unknown as Ctx["emit"] } as BackupCtx;
        return handlers["backup.run"](child, input as Record<string, unknown>);
      }
      if (!answers.has(cap)) throw fail("internal.not_implemented", TRACE, { details: { cap } });
      return answers.get(cap);
    }) as unknown as Ctx["call"],
    seal: createCtxSeal({ key: new Uint8Array(32).fill(7), keyId: "k1" }),
    schedule: (async (at: number | string, cap: string, input: unknown) => { scheduled.push({ at, cap, input }); return `sch_${scheduled.length}`; }) as unknown as Ctx["schedule"],
    run: "run_testrun1",
    authorize: (() => ({ effect: exportAllowed ? "allow" : "deny", reason: "test", decisionId: "dec_1" })) as unknown as Ctx["authorize"],
  } as unknown as BackupCtx;
  self = ctx;
  return {
    raw, ctx, space, target, saved, events, nested, scheduled, calls, drivers,
    setNow(n) { clock = n; }, allowExport(v) { exportAllowed = v; }, answer(cap, a) { answers.set(cap, a); },
  };
}

/** A backup with a chosen id, written the way runBackup writes one: the archive on the target and its row, as if an earlier run had taken it. */
export async function seedBackup(w: World, backupId: string, o: { at?: number; kind?: string; encrypted?: boolean } = {}): Promise<void> {
  const at = o.at ?? w.ctx.now();
  const encrypted = o.encrypted ?? true;
  const snap = await w.space.snapshot();
  const archive = await pack({ backupId, at, fromSeq: snap.fromSeq, toSeq: snap.toSeq, headHash: snap.headHash, tombstones: await w.space.tombstones() }, snap.entries);
  const blob = wrap(w.ctx, archive, encrypted);
  const objectKey = `b/${backupId}.vybk`;
  await w.target.put(objectKey, blob);
  writeConfig(w.ctx, "target", JSON.stringify(MEMORY_TARGET));
  w.raw.run(
    "INSERT OR REPLACE INTO backup_item (backup_id, at, state, kind, seq, from_seq, size_bytes, verified, target, object_key, head_hash, encrypted, tombstones, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    backupId, at, "done", o.kind ?? "manual", snap.toSeq, snap.fromSeq, blob.length, 0, describeTarget(MEMORY_TARGET), objectKey, snap.headHash, encrypted ? 1 : 0, 0, null,
  );
}
