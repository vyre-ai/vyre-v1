// The backup module's host seam (rulings 31 and 32): the module exports `hostSeams = { setBackupHost }` and the daemon hands it the Space's data through this file.
// The host never imports the module, so the shapes below are the structural subset of its BackupDrivers that the host supplies.
//
// What a snapshot holds: a consistent copy of events.db (the log with its hash chain), modules.db (every module's tables) and space.db when the Space has one, made with VACUUM INTO
// so the live daemon keeps writing, plus every file under blobs/. The seal key and the admin token are never in it: a Space restored onto the same server keeps its key, and a new
// machine gets its key from the recovery flow, not from a backup that could be read by whoever holds the target.
// A scratch restore writes the entries to a throwaway directory and walks the log's hash chain. A live restore stages the same files in `restore-pending/`; applyPendingRestore moves
// them into place at the next start, before any database is opened, and keeps the files it replaced in `restore-previous/`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LogClient } from "../../../kernel/src/log/client.ts";
import { openDb } from "../daemon/sqlite.ts";
import type { SeamFetch, VaultPort } from "./ports.ts";

export interface Tombstone { kind: string; subject: string; at: number }
export interface SnapshotEntry { path: string; bytes: Uint8Array }
export interface SpaceSnapshot { fromSeq: number; toSeq: number; headHash: string; entries: SnapshotEntry[] }
export interface ApplyResult { checkedEvents: number; chainOk: boolean; replayed: number }

export interface BackupSource {
  head(): Promise<{ seq: number; hash: string }>;
  snapshot(): Promise<SpaceSnapshot>;
  tombstones(): Promise<Tombstone[]>;
  restore(snapshot: SpaceSnapshot, tombstones: Tombstone[], mode: "scratch" | "live", traceId?: string): Promise<ApplyResult>;
  exportEntries(): Promise<SnapshotEntry[]>;
  /** The person who owns the Space, from the access layer: only they may take a full export (P-SEC_07). */
  owner(): Promise<string>;
  secretValues(): Promise<string[]>;
}
export type S3Transport = (req: { method: string; url: string; headers: Record<string, string>; body?: Uint8Array }) => Promise<{ status: number; body: Uint8Array }>;
export interface BackupHostSeam {
  source: BackupSource;
  exports: { save(name: string, bytes: Uint8Array): Promise<{ fileId: string }> };
  transport: S3Transport;
  credentials(vaultName: string): Promise<{ key: string; secret: string; endpoint?: string }>;
}

/** Files that make up a Space on disk, relative to the data directory. */
const DB_FILES = ["events.db", "modules.db", "space.db"] as const;
const PENDING = "restore-pending";
const PREVIOUS = "restore-previous";

export interface BackupHostDeps {
  /** the data directory (events.db, modules.db, blobs/) */
  root: string;
  space: string;
  log: { currentHead(): Promise<{ seq: number; hash: string }>; read(q: { after?: number; limit?: number }): Promise<{ seq: number; id: string; type: string; at: number; vis: string; enc: number; label: number; payload: Uint8Array }[]> };
  /** the Space owner from the access layer, or null when it has none; with none, every full export refuses (P-SEC_07) */
  owner: () => string | null;
  /** the cap-call a host service makes as itself (governance.tombstones.list) */
  system: (cap: string, input: unknown) => Promise<unknown>;
  vault: VaultPort;
  /** the blob store handle backup writes an export into; the id is the file id the owner is given */
  blobs: { put(bytes: Uint8Array, contentType: string): Promise<string> };
  fetch: SeamFetch;
  /** values an export must never contain (the admin token) */
  secrets?: () => string[];
}

function walk(dir: string, rel = ""): string[] {
  let names: fs.Dirent[];
  try { names = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return []; }
  const out: string[] = [];
  for (const n of names.sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${n.name}` : n.name;
    if (n.isDirectory()) out.push(...walk(dir, r)); else if (n.isFile()) out.push(r);
  }
  return out;
}

/** A path an archive entry may name: relative, no climbing out. */
function safeRel(p: string): string | null {
  const n = path.posix.normalize(p);
  return n.startsWith("/") || n.startsWith("..") || n.includes("\0") ? null : n;
}

function vacuumCopy(file: string): Uint8Array | null {
  if (!fs.existsSync(file)) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-snap-"));
  const out = path.join(tmp, "copy.db");
  const db = openDb(file, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${out.replaceAll("'", "''")}'`);
    return new Uint8Array(fs.readFileSync(out));
  } finally { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
}

export function createBackupHost(deps: BackupHostDeps): BackupHostSeam {
  const blobDir = path.join(deps.root, "blobs");

  async function snapshot(): Promise<SpaceSnapshot> {
    const before = await deps.log.currentHead();
    const entries: SnapshotEntry[] = [];
    for (const name of DB_FILES) {
      const bytes = vacuumCopy(path.join(deps.root, name));
      if (bytes) entries.push({ path: name, bytes });
    }
    for (const rel of walk(blobDir)) entries.push({ path: `blobs/${rel}`, bytes: new Uint8Array(fs.readFileSync(path.join(blobDir, rel))) });
    const head = await deps.log.currentHead();
    return { fromSeq: before.seq === 0 ? 0 : 1, toSeq: head.seq, headHash: head.hash, entries };
  }

  async function verifyChain(entries: SnapshotEntry[]): Promise<{ ok: boolean; events: number }> {
    const ev = entries.find((e) => e.path === "events.db");
    if (!ev) return { ok: false, events: 0 };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-restore-"));
    let client: LogClient | null = null;
    try {
      const file = path.join(dir, "events.db");
      fs.writeFileSync(file, ev.bytes);
      client = await LogClient.open({ path: file, space: deps.space });
      const r = await client.verify();
      return r.ok ? { ok: true, events: r.seq } : { ok: false, events: Math.max(0, r.at - 1) };
    } catch { return { ok: false, events: 0 }; }
    finally { if (client) await client.close().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); }
  }

  return {
    source: {
      head: () => deps.log.currentHead(),
      snapshot,
      async tombstones() {
        const r = (await deps.system("governance.tombstones.list", { limit: 500 })) as { tombstones?: { kind: string; id: string; at: number }[] };
        return (r.tombstones ?? []).map((t) => ({ kind: t.kind, subject: t.id, at: t.at }));
      },
      async restore(snap, tombstones, mode, traceId) {
        const chain = await verifyChain(snap.entries);
        if (mode === "live" && chain.ok) {
          const stage = path.join(deps.root, PENDING);
          fs.rmSync(stage, { recursive: true, force: true });
          for (const e of snap.entries) {
            const rel = safeRel(e.path);
            if (!rel) throw new Error("the archive names a path outside the Space");
            fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true });
            fs.writeFileSync(path.join(stage, rel), e.bytes);
          }
          // the full rows, read from the Space as it is now: the restored database predates the erasures made since the backup and does not have them (spec 2.26, ARCH 7.10)
          fs.writeFileSync(path.join(stage, "tombstones.json"), JSON.stringify({ ...(traceId ? { traceId } : {}), tombstones: currentTombstones(deps.root, tombstones) }));   // the trace of the restore call, so the replay at the next start is part of the same story
        }
        // governance.tombstones.reapply runs after the restored Space opens (it needs the restored tables), so nothing is replayed here
        return { checkedEvents: chain.events, chainOk: chain.ok, replayed: 0 };
      },
      async exportEntries() {
        // records and shared chats only: events other people may read (vis space), in the clear, with no label. Private chats and personal memory are never vis space.
        const lines: string[] = [];
        for (let after = 0;;) {
          const page = await deps.log.read({ after, limit: 1000 });
          if (page.length === 0) break;
          for (const e of page) {
            after = e.seq;
            if (e.vis !== "space" || e.enc !== 0 || e.label !== 0) continue;
            lines.push(JSON.stringify({ seq: e.seq, id: e.id, type: e.type, at: e.at, payload: JSON.parse(new TextDecoder().decode(e.payload)) as unknown }));
          }
        }
        return [{ path: "records/events.jsonl", bytes: new TextEncoder().encode(lines.join("\n")) }];
      },
      // no owner is the empty string, which no principal id equals: the module compares the caller to it and refuses
      owner: () => Promise.resolve(deps.owner() ?? ""),
      secretValues: () => Promise.resolve(deps.secrets?.() ?? []),
    },
    exports: {
      async save(name, bytes) {
        return { fileId: await deps.blobs.put(bytes, name.endsWith(".zip") ? "application/zip" : "application/octet-stream") };
      },
    },
    transport: async (req) => {
      const r = await deps.fetch(req.url, { method: req.method, headers: req.headers, ...(req.body ? { body: req.body } : {}) });
      return { status: r.status, body: new Uint8Array(await r.arrayBuffer()) };
    },
    credentials: async (vaultName) => {
      const handle = vaultName.startsWith("#") ? vaultName : `#${vaultName}`;
      const j = JSON.parse(await deps.vault.secret(handle, deps.space)) as Record<string, unknown>;
      const key = String(j["key"] ?? j["accessKeyId"] ?? j["access_key_id"] ?? "");
      const secret = String(j["secret"] ?? j["secretAccessKey"] ?? j["secret_access_key"] ?? "");
      if (!key || !secret) throw new Error("the Vault item has no key and secret");
      return { key, secret, ...(typeof j["endpoint"] === "string" ? { endpoint: j["endpoint"] } : {}) };
    },
  };
}

export interface TombstoneRow { id: string; kind: string; subjectType: string; subjectId: string; at: number; by: string; findingId?: string }
const KEPT = "restore-tombstones.json";

/** Every tombstone the live Space holds, whole, read before the restore replaces its database. A Space with no governance table has none. */
function currentTombstones(root: string, _listed: unknown): TombstoneRow[] {
  const file = path.join(root, "modules.db");
  if (!fs.existsSync(file)) return [];
  const db = openDb(file, { readOnly: true });
  try {
    return db.all(`SELECT "id", "kind", "subjectType", "subjectId", "at", "by", "findingId" FROM governance_tombstone`) as unknown as TombstoneRow[];
  } catch { return []; } finally { db.close(); }
}

/** The tombstones a restore kept for the first start after it, with the trace of the restore call, or none. */
export function readRestoredTombstones(root: string): { tombstones: TombstoneRow[]; traceId?: string } | null {
  const file = path.join(root, KEPT);
  if (!fs.existsSync(file)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as { tombstones?: unknown; traceId?: unknown };
    return { tombstones: Array.isArray(j.tombstones) ? (j.tombstones as TombstoneRow[]) : [], ...(typeof j.traceId === "string" && /^[0-9a-f]{32}$/.test(j.traceId) ? { traceId: j.traceId } : {}) };
  } catch { return { tombstones: [] }; }
}
/** Once they are replayed and recorded in the restored database, the file goes. */
export function clearRestoredTombstones(root: string): void { fs.rmSync(path.join(root, KEPT), { force: true }); }

/** At the start, before any database is open: move a staged restore into place. The files it replaces are kept in restore-previous/. Returns the files moved. */
export function applyPendingRestore(root: string): string[] {
  const stage = path.join(root, PENDING);
  if (!fs.existsSync(path.join(stage, "events.db"))) return [];
  const prev = path.join(root, PREVIOUS);
  fs.rmSync(prev, { recursive: true, force: true });
  fs.mkdirSync(prev, { recursive: true });
  const moved: string[] = [];
  for (const name of DB_FILES) {
    for (const suffix of ["", "-wal", "-shm"]) {
      const cur = path.join(root, name + suffix);
      if (fs.existsSync(cur)) fs.renameSync(cur, path.join(prev, name + suffix));
    }
    const staged = path.join(stage, name);
    if (fs.existsSync(staged)) { fs.renameSync(staged, path.join(root, name)); moved.push(name); }
  }
  if (fs.existsSync(path.join(stage, "blobs"))) {
    if (fs.existsSync(path.join(root, "blobs"))) fs.renameSync(path.join(root, "blobs"), path.join(prev, "blobs"));
    fs.renameSync(path.join(stage, "blobs"), path.join(root, "blobs"));
    moved.push("blobs");
  }
  // the tombstones outlive the stage: the Space replays them once it is open (readRestoredTombstones), because the restored database does not have the erasures made after the backup
  if (fs.existsSync(path.join(stage, "tombstones.json"))) fs.copyFileSync(path.join(stage, "tombstones.json"), path.join(root, KEPT));
  fs.rmSync(stage, { recursive: true, force: true });
  return moved;
}
