// sync.pull (ARCH 5.3): the changes after a cursor, already filtered for this person and device class, with `hide` for rows that left the person's view.
//
// The server remembers per (person, device) which rows that device holds (`sync_seen_rows`), because "row became visible" (send everything) and "row stopped being visible" (send hide)
// cannot be told apart from the change alone. A mark carries the seq of the change that set it and the state before it: a pull from cursor C reads a mark newer than C as unacknowledged and uses the
// state before it. The same request therefore always gets the same answer, and a response that never arrived does not leave the device without a row the server believes it has.
import type { Tx } from "../../../../kernel/src/store/projection.ts";
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
}

interface ChangeRec { seq: number; entity: string; id: string; op: "upsert" | "patch" | "delete" | "rescan"; fields: string }

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
  return { changes, hide };
}

export function pullChanges(d: PullDeps, who: Who, req: PullReq): PullRes {
  const db = d.db;
  const epoch = epochOf(db, who.person);
  const serverHlc = d.hlc();
  if (req.epoch < epoch) return { epoch, changes: [], hide: [], next: req.cursor, more: false, serverHlc, reset: "purge" };
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
  const scanLimit = limit * 4;
  const scan = db.all<ChangeRec>(`SELECT seq, entity, id, op, fields FROM sync_changes WHERE ${where.join(" AND ")} ORDER BY seq LIMIT ${scanLimit}`, ...args);

  const now = d.now();
  const viewer = new Viewer({ cache: d.cache, who, now, phoneCeiling: d.phoneCeiling() });
  const window = new Window(db, now, (entity, id) => d.keep(who.person, entity, id));
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
  // A row sent whole in this response already shows its latest state, so later patches to it in the same response add nothing.
  const whole = new Set<string>();
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
          }
        } else {
          const sc = viewer.scope(cfg);
          const visible = viewer.visible(sc, row, cells) && window.holds(cfg, mode, row);
          if (visible && !was) {
            out.push({ kind: "change", row: key, terminal: false, change: { seq: c.seq, entity: c.entity, id: c.id, op: "upsert", fields: wireFields(viewer.fields(sc, cells)) } });
            seen.set(c.entity, c.id, true, c.seq); used++;
            whole.add(key);
          } else if (visible && was && c.op !== "rescan" && !whole.has(key)) {
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
  const more = !exhausted && (!stopped || last < head);
  return { epoch, ...settle(out), next, more, serverHlc };
}
