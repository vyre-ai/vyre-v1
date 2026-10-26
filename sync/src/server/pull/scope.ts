// Who may see which row, which fields, and what a phone keeps (ARCH 5.3 server algorithm, 5.11 profiles).
// Row visibility is the kernel's scopeFor predicate evaluated on the row, then the label ceiling (person clearance, entity maxLabel, device ceiling), then the private-row rule.
// Field visibility drops the grant's hiddenFields and any field labelled above that ceiling; the client treats an omitted field as unknown and shows it locked, never as empty.
import { evalPred, scopeFor } from "../../../../kernel/src/authorize/scope.ts";
import type { Pred, ScopeResult } from "../../../../kernel/src/authorize/scope.ts";
import type { AccessSnapshot } from "../../../../kernel/src/authorize/snapshot.ts";
import type { Tx } from "../../../../kernel/src/store/projection.ts";
import type { DeviceClass } from "../../protocol.ts";
import { DEVICE_CEILING } from "./catalog.ts";
import type { ServerEntity } from "./catalog.ts";
import type { Cell, Cells } from "./fold.ts";

export interface Who {
  /** The person the replica belongs to. */
  person: string;
  device: string;
  deviceClass: DeviceClass;
}

/** One `sync_rows` row. */
export interface RowRec {
  entity: string; id: string; owner_id: string | null; label: number; deleted: number; enc: number; vis: string; seq: number; updated_at: number; fields: string;
}

export interface EntityScope { cfg: ServerEntity; pred: Pred; hidden: ReadonlySet<string>; cap: number }

const DAY_MS = 86_400_000;
const RECOMPILE_MS = 30_000;

/** scopeFor compiled per (person, access resource type); dropped when the access snapshot changes epoch and after 30 s (grants expire). */
export class ScopeCache {
  private epoch = -1;
  private at = 0;
  private map = new Map<string, ScopeResult>();
  private readonly snap: () => AccessSnapshot;
  constructor(snap: () => AccessSnapshot) { this.snap = snap; }
  private ids = new WeakMap<object, number>();
  private nextId = 1;
  /**
   * Names the access state a scope was compiled from: it changes when the host adopts a new snapshot, when the snapshot is mutated, and every RECOMPILE_MS (grants expire with time). A device whose rows
   * were last checked under another stamp has them checked again (pull.ts sweepHeld), so a revoked, narrowed or expired grant hides what the person can no longer see.
   */
  stamp(now: number): string {
    const snap = this.snap();
    let id = this.ids.get(snap);
    if (id === undefined) { id = this.nextId++; this.ids.set(snap, id); }
    return `${id}:${snap.epoch}:${Math.floor(now / RECOMPILE_MS)}`;
  }
  get(person: string, resource: string, now: number): ScopeResult {
    const snap = this.snap();
    if (snap.epoch !== this.epoch || now - this.at > RECOMPILE_MS || now < this.at) { this.map.clear(); this.epoch = snap.epoch; this.at = now; }
    const key = `${person}\0${resource}`;
    let hit = this.map.get(key);
    if (!hit) { hit = scopeFor(snap, { principal: person, entityType: resource, level: "view", now }); this.map.set(key, hit); }
    return hit;
  }
}

export interface ViewerOpts { cache: ScopeCache; who: Who; now: number; phoneCeiling: number }

/** Everything one request needs to decide visibility. Cheap to make; scopes come from the shared cache. */
export class Viewer {
  private scopes = new Map<string, EntityScope>();
  private readonly o: ViewerOpts;
  constructor(o: ViewerOpts) { this.o = o; }
  get who(): Who { return this.o.who; }
  get now(): number { return this.o.now; }

  deviceCeiling(): number {
    const base = DEVICE_CEILING[this.o.who.deviceClass];
    return this.o.who.deviceClass === "phone" ? Math.min(base, this.o.phoneCeiling) : base;
  }

  scope(cfg: ServerEntity): EntityScope {
    let s = this.scopes.get(cfg.key);
    if (!s) {
      const r = this.o.cache.get(this.o.who.person, cfg.resource, this.o.now);
      const cap = Math.min(r.labelCeiling, cfg.maxLabel ?? 3, this.deviceCeiling());
      s = { cfg, pred: r.predicate, hidden: new Set(r.hiddenFields), cap };
      this.scopes.set(cfg.key, s);
    }
    return s;
  }

  /** The row as the predicate sees it: the field values plus id, owner_id, label and holds. */
  static context(row: RowRec, cells: Cells): Record<string, unknown> {
    const ctx: Record<string, unknown> = {};
    for (const [k, c] of Object.entries(cells)) ctx[k] = c.v;
    ctx["id"] = row.id; ctx["owner_id"] = row.owner_id; ctx["label"] = row.label; ctx["holds"] = 0;
    return ctx;
  }

  visible(sc: EntityScope, row: RowRec, cells: Cells): boolean {
    if (sc.pred.t === "false") return false;
    if ((row.enc === 2 || row.vis === "owner" || row.vis === "private") && row.owner_id !== this.o.who.person) return false;
    if (row.label > sc.cap) return false;
    return evalPred(sc.pred, Viewer.context(row, cells));
  }

  /** Fields this person and device may hold. `seq` stays on the cell for snapshot rows and is stripped by the caller for pull. */
  fields(sc: EntityScope, cells: Cells, only?: Iterable<string>): Record<string, Cell> {
    const out: Record<string, Cell> = {};
    for (const k of only ?? Object.keys(cells)) {
      const c = cells[k];
      if (!c || sc.hidden.has(k)) continue;
      const rank = sc.cfg.fieldLabels[k];
      if (rank !== undefined && rank > sc.cap) continue;
      out[k] = c;
    }
    return out;
  }
}

/** The phone window (5.11): rows older than `days` or outside the newest `recentCount` stay on the server unless starred. */
export class Window {
  private cut = new Map<string, number>();
  private readonly db: Tx;
  private readonly now: number;
  private readonly keep: (entity: string, id: string) => boolean;
  constructor(db: Tx, now: number, keep: (entity: string, id: string) => boolean) { this.db = db; this.now = now; this.keep = keep; }

  private recentCut(entity: string, n: number): number {
    const k = `${entity}\0${n}`;
    let c = this.cut.get(k);
    if (c === undefined) {
      c = this.db.get<{ updated_at: number }>("SELECT updated_at FROM sync_rows WHERE entity = ? AND deleted = 0 ORDER BY updated_at DESC LIMIT 1 OFFSET ?", entity, Math.max(0, n - 1))?.updated_at ?? -Infinity;
      this.cut.set(k, c);
    }
    return c;
  }

  /** True when the device class mirrors this row. */
  holds(cfg: ServerEntity, mode: "all" | "window" | "none", row: { entity: string; id: string; updated_at: number }): boolean {
    if (mode === "none") return false;
    if (mode === "all") return true;
    const w = cfg.window;
    if (w.starred && this.keep(row.entity, row.id)) return true;
    if (w.days !== undefined && row.updated_at < this.now - w.days * DAY_MS) return false;
    if (w.recentCount !== undefined && row.updated_at < this.recentCut(row.entity, w.recentCount)) return false;
    return true;
  }
}
