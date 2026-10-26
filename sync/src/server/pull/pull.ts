// sync.pull (ARCH 5.3): the changes after a cursor, already filtered for this person and device class, with `hide` for rows that left the person's view.
//
// The server remembers per (person, device) which rows that device holds (`sync_seen_rows`), because "row became visible" (send everything) and "row stopped being visible" (send hide)
// cannot be told apart from the change alone. A mark carries the seq of the change that set it and the state before it: a pull from cursor C reads a mark newer than C as unacknowledged and uses the
// state before it. The same request therefore always gets the same answer, and a response that never arrived does not leave the device without a row the server believes it has.
import type { Tx } from "../../../../kernel/src/store/projection.ts";
import type { NewEvent } from "../../../../kernel/src/log/types.ts";
import { DEFAULT_PULL_LIMIT, MAX_PULL_LIMIT } from "../../protocol.ts";
import type { Change, FieldVal, Hide, PullReq, PullRes } from "../../protocol.ts";
import type { Catalog } from "./catalog.ts";
import type { Cell, Cells } from "./fold.ts";
import { ScopeCache, Viewer, Window } from "./scope.ts";
import type { RowRec, Who } from "./scope.ts";

export interface PullDeps {
  db: Tx;
  catalog: Catalog;
  cache: ScopeCache;
  now(): number;
  /** The server's hybrid clock, text form. */
  hlc(): string;
  /** Rank of the label ceiling for phones (setting sync.phone_label_ceiling). */
  phoneCeiling(): number;
  /** True when the person starred or follows the row (a phone keeps those whatever their age). */
  keep(person: string, entity: string, id: string): boolean;
  /** Append one event to the log (the sync.changes projection folds it in the same transaction). Without it a pull cannot ask for a rescan when access changed. */
  append?(ev: NewEvent): { seq: number };
}

interface ChangeRec { seq: number; entity: string; id: string; op: "upsert" | "patch" | "delete" | "rescan"; fields: string }

/**
 * Has the host revoked this device? `sync.epoch.bump` with reason device_revoked writes the device's own epoch row (purge/server.ts); the row stays, so a revoked device is refused
 * whatever epoch it says it holds (the epoch a client presents is the client's word). A device that comes back is a new device with a new id. The table exists once a bump has run.
 */
const DEVICE_EPOCH_DDL = "CREATE TABLE IF NOT EXISTS sync_device_epoch (person TEXT NOT NULL, device TEXT NOT NULL, epoch INTEGER NOT NULL, PRIMARY KEY (person, device)) WITHOUT ROWID";
const ready = new WeakSet<object>();
/** The table is made once per handle (the same statement the purge server runs), so a read never fails for want of it and never pays for a failed prepare. */
function ensureDeviceEpoch(db: Tx): void {
  if (ready.has(db)) return;
  db.exec(DEVICE_EPOCH_DDL);
  ready.add(db);
}

/** The access stamp each device's held rows were last checked under (ScopeCache.stamp). Made on first use, like the epoch table. */
const STAMP_DDL = "CREATE TABLE IF NOT EXISTS sync_scope_stamp (person TEXT NOT NULL, device TEXT NOT NULL, stamp TEXT NOT NULL, PRIMARY KEY (person, device)) WITHOUT ROWID";
const stampReady = new WeakSet<object>();
function ensureStamp(db: Tx): void {
  if (stampReady.has(db)) return;
  db.exec(STAMP_DDL);
  stampReady.add(db);
}

export function deviceRevoked(db: Tx, person: string, device: string): boolean {
  ensureDeviceEpoch(db);
  return db.get<{ epoch: number }>("SELECT epoch FROM sync_device_epoch WHERE person = ? AND device = ?", person, device) !== undefined;
}

/** The epoch a device must present: its person's, or its own if that is higher. */
export function deviceEpochOf(db: Tx, person: string, device: string): number {
  ensureDeviceEpoch(db);
  const own = db.get<{ epoch: number }>("SELECT epoch FROM sync_device_epoch WHERE person = ? AND device = ?", person, device)?.epoch ?? 0;
  return Math.max(epochOf(db, person), own);
}

/** The person's current sync epoch (a lower epoch on a device means that device must purge). */
export function epochOf(db: Tx, person: string): number {
  return db.get<{ epoch: number }>("SELECT epoch FROM sync_epoch WHERE person = ?", person)?.epoch ?? 0;
}

export function headSeq(db: Tx): number {
  return db.get<{ s: number | null }>("SELECT max(seq) AS s FROM sync_changes")?.s ?? 0;
}

/** Per-request view of the device's seen marks. `holds` is the state at the point the scan has reached; `base` is the state at the request cursor. */
export class Seen {
  private m = new Map<string, { base: boolean; cur: boolean; at: number; dirty: boolean }>();
  private readonly db: Tx;
  private readonly who: Who;
  private readonly cursor: number;
  constructor(db: Tx, who: Who, cursor: number) { this.db = db; this.who = who; this.cursor = cursor; }
  private entry(entity: string, id: string): { base: boolean; cur: boolean; at: number; dirty: boolean } {
    const k = `${entity}\0${id}`;
    let e = this.m.get(k);
    if (!e) {
      const r = this.db.get<{ vis: number; prev_vis: number; at_seq: number }>(
        "SELECT vis, prev_vis, at_seq FROM sync_seen_rows WHERE person = ? AND device = ? AND entity = ? AND id = ?", this.who.person, this.who.device, entity, id);
      const eff = r ? (r.at_seq > this.cursor ? r.prev_vis === 1 : r.vis === 1) : false;
      e = { base: eff, cur: eff, at: r?.at_seq ?? 0, dirty: false };
      this.m.set(k, e);
    }
    return e;
  }
  holds(entity: string, id: string): boolean { return this.entry(entity, id).cur; }
  set(entity: string, id: string, vis: boolean, seq: number): void {
    const e = this.entry(entity, id);
    e.cur = vis; e.at = seq; e.dirty = true;
  }
  flush(): void {
    for (const [k, e] of this.m) {
      if (!e.dirty) continue;
      const [entity, id] = k.split("\0") as [string, string];
      this.db.run(
        `INSERT INTO sync_seen_rows (person, device, entity, id, vis, prev_vis, at_seq) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(person, device, entity, id) DO UPDATE SET vis = excluded.vis, prev_vis = excluded.prev_vis, at_seq = excluded.at_seq`,
        this.who.person, this.who.device, entity, id, e.cur ? 1 : 0, e.base ? 1 : 0, e.at);
    }
  }
}

const wire = (c: Cell): FieldVal => ({ v: c.v, hlc: c.hlc, actor: c.actor, ...(c.enc ? { enc: c.enc } : {}) });
export const wireFields = (cells: Record<string, Cell>): Record<string, FieldVal> => {
  const out: Record<string, FieldVal> = {};
  for (const [k, c] of Object.entries(cells)) out[k] = wire(c);
  return out;
};

type Emission = { kind: "change"; row: string; terminal: boolean; change: Change } | { kind: "hide"; row: string; terminal: true; hide: Hide };

/** Keep only what the device needs to end in the right state: a later upsert replaces an earlier hide or delete of the same row, and a hide or delete replaces earlier changes to it. */
function settle(list: Emission[]): { changes: Change[]; hide: Hide[] } {
  const lastTerminal = new Map<string, number>();
  const lastLive = new Map<string, number>();
  list.forEach((e, i) => { (e.terminal ? lastTerminal : lastLive).set(e.row, i); });
  const changes: Change[] = [], hide: Hide[] = [];
  list.forEach((e, i) => {
    const lt = lastTerminal.get(e.row) ?? -1, ll = lastLive.get(e.row) ?? -1;
    if (e.terminal ? i !== lt || ll > lt : i < lt) return;
    if (e.kind === "hide") hide.push(e.hide); else changes.push(e.change);
  });
  changes.sort((a, b) => a.seq - b.seq);
  return { changes, hide };
}

/**
 * Access can change without any row changing: a grant revoked or narrowed, a share expiring, a label raised, a share given. The change feed says nothing then, so whenever the access state a device
 * was last checked under has changed (ScopeCache.stamp), the rows it holds that the person can no longer see, and the rows it does not hold that the person can now see, are asked for again with a
 * `sync.row_rescan` event each (the same event reindexScope writes). The scan that follows then hides the first kind and sends the second, and because the events are in the log, a pull whose
 * response never arrived is answered the same way. The event names the row and nothing else, and is private to the server (no reader of the log sees it); who is told what is still decided
 * per person by the scan. The stamp is stored once the events are written. Runs before the scan, outside its transaction.
 */
function rescanChanged(d: PullDeps, who: Who, viewer: Viewer, window: Window, cursor: number): void {
  const db = d.db;
  ensureStamp(db);
  const stamp = d.cache.stamp(who.person, d.now());
  const had = db.get<{ stamp: string }>("SELECT stamp FROM sync_scope_stamp WHERE person = ? AND device = ?", who.person, who.device)?.stamp;
  if (had === stamp || !d.append) return;
  if (had === undefined) {
    // a device the server has not checked yet holds nothing it has not been sent by the feed: record the stamp and let the scan do the work
    db.run("INSERT INTO sync_scope_stamp (person, device, stamp) VALUES (?, ?, ?) ON CONFLICT(person, device) DO UPDATE SET stamp = excluded.stamp", who.person, who.device, stamp);
    return;
  }
  const sees = (row: RowRec): boolean => {
    const cfg = d.catalog.get(row.entity);
    const mode = cfg.profile[who.deviceClass];
    return mode !== "none" && viewer.visible(viewer.scope(cfg), row, JSON.parse(row.fields) as Cells) && window.holds(cfg, mode, row);
  };
  const ask = (entity: string, id: string): void => {
    d.append!({ type: "sync.row_rescan", sv: 1, trace_id: "0".repeat(32), actor: "svc_host", vis: "private", payload: { entity, id } });
  };
  // `eff` is what the device is taken to hold at this cursor (a mark newer than the cursor is not acknowledged yet)
  const held = db.all<RowRec>(
    `SELECT r.entity, r.id, r.owner_id, r.label, r.deleted, r.enc, r.vis, r.seq, r.updated_at, r.fields FROM sync_rows r
       JOIN sync_seen_rows s ON s.person = ? AND s.device = ? AND s.entity = r.entity AND s.id = r.id
      WHERE r.deleted = 0 AND (CASE WHEN s.at_seq > ? THEN s.prev_vis ELSE s.vis END) = 1`, who.person, who.device, cursor);
  const missing = db.all<RowRec>(
    `SELECT r.entity, r.id, r.owner_id, r.label, r.deleted, r.enc, r.vis, r.seq, r.updated_at, r.fields FROM sync_rows r
       LEFT JOIN sync_seen_rows s ON s.person = ? AND s.device = ? AND s.entity = r.entity AND s.id = r.id
      WHERE r.deleted = 0 AND (s.id IS NULL OR (CASE WHEN s.at_seq > ? THEN s.prev_vis ELSE s.vis END) = 0)`, who.person, who.device, cursor);
  for (const row of held) if (!sees(row)) ask(row.entity, row.id);
  for (const row of missing) if (sees(row)) ask(row.entity, row.id);
  db.run("INSERT INTO sync_scope_stamp (person, device, stamp) VALUES (?, ?, ?) ON CONFLICT(person, device) DO UPDATE SET stamp = excluded.stamp", who.person, who.device, stamp);
}

export function pullChanges(d: PullDeps, who: Who, req: PullReq): PullRes {
  const db = d.db;
  const epoch = deviceEpochOf(db, who.person, who.device);
  const serverHlc = d.hlc();
  // a revoked device gets no rows whatever epoch it presents; a device behind its epoch is told to purge
  if (deviceRevoked(db, who.person, who.device) || req.epoch < epoch) return { epoch, changes: [], hide: [], next: req.cursor, more: false, serverHlc, reset: "purge" };
  const limit = Math.min(Math.max(req.limit ?? DEFAULT_PULL_LIMIT, 1), MAX_PULL_LIMIT);
  const cursor = req.cursor;
  const excluded = d.catalog.excluded(who.deviceClass);
  const where: string[] = ["seq > ?"];
  const args: (string | number)[] = [cursor];
  if (req.entities) {
    const want = req.entities.filter((e) => !excluded.includes(e));
    if (!want.length) return { epoch, changes: [], hide: [], next: cursor, more: false, serverHlc };
    where.push(`entity IN (${want.map(() => "?").join(", ")})`); args.push(...want);
  } else if (excluded.length) { where.push(`entity NOT IN (${excluded.map(() => "?").join(", ")})`); args.push(...excluded); }
  const now = d.now();
  const viewer = new Viewer({ cache: d.cache, who, now, phoneCeiling: d.phoneCeiling() });
  const window = new Window(db, now, (entity, id) => d.keep(who.person, entity, id));
  rescanChanged(d, who, viewer, window, cursor);
  const scanLimit = limit * 4;
  const scan = db.all<ChangeRec>(`SELECT seq, entity, id, op, fields FROM sync_changes WHERE ${where.join(" AND ")} ORDER BY seq LIMIT ${scanLimit}`, ...args);

  const seen = new Seen(db, who, cursor);
  const rows = new Map<string, { row: RowRec; cells: Cells } | null>();
  const load = (entity: string, id: string): { row: RowRec; cells: Cells } | null => {
    const k = `${entity}\0${id}`;
    let r = rows.get(k);
    if (r === undefined) {
      const row = db.get<RowRec>("SELECT entity, id, owner_id, label, deleted, enc, vis, seq, updated_at, fields FROM sync_rows WHERE entity = ? AND id = ?", entity, id);
      r = row ? { row, cells: JSON.parse(row.fields) as Cells } : null;
      rows.set(k, r);
    }
    return r;
  };

  const out: Emission[] = [];
  // A row sent whole in this response already shows its latest state, so later patches to it add nothing. The whole row then stands for the version of the last patch it absorbed:
  // a client takes a change's seq as the version of every field it carries, and a lower number would make its next edit look concurrent with a change it has already seen.
  const whole = new Map<string, Change>();
  let used = 0, last = cursor, stopped = false;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const c of scan) {
      last = c.seq;
      const cfg = d.catalog.get(c.entity);
      const mode = cfg.profile[who.deviceClass];
      const hit = load(c.entity, c.id);
      if (mode !== "none" && hit) {
        const { row, cells } = hit;
        const key = `${c.entity}\0${c.id}`;
        const was = seen.holds(c.entity, c.id);
        if (c.op === "delete" || row.deleted === 1) {
          if (c.op === "delete" && was) {
            out.push({ kind: "change", row: key, terminal: true, change: { seq: c.seq, entity: c.entity, id: c.id, op: "delete", fields: {} } });
            seen.set(c.entity, c.id, false, c.seq); used++;
            whole.delete(key);
          }
        } else {
          const sc = viewer.scope(cfg);
          const visible = viewer.visible(sc, row, cells) && window.holds(cfg, mode, row);
          if (visible && !was) {
            const change: Change = { seq: c.seq, entity: c.entity, id: c.id, op: "upsert", fields: wireFields(viewer.fields(sc, cells)) };
            out.push({ kind: "change", row: key, terminal: false, change });
            seen.set(c.entity, c.id, true, c.seq); used++;
            whole.set(key, change);
          } else if (visible && was && c.op !== "rescan" && whole.has(key)) {
            whole.get(key)!.seq = c.seq;
          } else if (visible && was && c.op !== "rescan") {
            const f = wireFields(viewer.fields(sc, JSON.parse(c.fields) as Cells));
            if (Object.keys(f).length) { out.push({ kind: "change", row: key, terminal: false, change: { seq: c.seq, entity: c.entity, id: c.id, op: c.op, fields: f } }); used++; }
          } else if (!visible && was) {
            out.push({ kind: "hide", row: key, terminal: true, hide: { entity: c.entity, id: c.id, seq: c.seq } });
            seen.set(c.entity, c.id, false, c.seq); used++;
            whole.delete(key);
          }
        }
      }
      if (used >= limit) { stopped = true; break; }
    }
    seen.flush();
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* the failure that matters is the first */ }
    throw e;
  }
  const exhausted = !stopped && scan.length < scanLimit;
  const head = headSeq(db);
  const next = exhausted ? Math.max(cursor, head) : last;
  const more = (!exhausted && (!stopped || last < head));
  return { epoch, ...settle(out), next, more, serverHlc };
}
