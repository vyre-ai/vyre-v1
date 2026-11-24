// The sync engine (spec 2.10, ARCH 4.3.1 item 2 and 8): one engine over any two Stores, the Space's RecordStore on one side and a connector's SyncedTypeDef target on the other.
// It is the executor of the Run kind `connector_sync`: a pass pulls, pushes and reports; a dry run does the same work and writes nothing.
//
// Three-way compare per mapped field against the base (the values both sides agreed on at the last sync):
//   only theirs moved -> pull (direction pull or both)   only ours moved -> push (push or both)   both moved to different values -> the conflict rule.
// Pushes go through an outbox with an idempotency key, retries (3 passes, then sync.push_failed) and the replaced remote value, so a push can be undone.
// First sync matches an unlinked remote record to a local one by the match rule; a missing remote record is marked "removed at source", and a pass that would mark more than
// 10 percent or 50 records pauses and waits for confirmDeletes. Local writes go to the RecordStore directly and are announced with quiet: true unless runAutomations is set.
import { turns } from "../../../lib/yield-loop.ts";
import { evalExpr, parseExpr } from "../../../lib/expr/expr.ts";
import { canonical } from "../../../lib/canonical.ts";
import { formatHlc } from "../../../lib/hlc.ts";
import { mintRecordId } from "../../../lib/ids.ts";
import { MAX_LINKS } from "../../../kernel/src/store/values.ts";
import type { Tx } from "../../../kernel/src/store/projection.ts";
import type { Store, StoredRecord } from "../../../kernel/src/store/types.ts";
import { ensureTables, mintShort, same } from "../projections.ts";

export type Direction = "pull" | "push" | "both" | "off";
export type ConflictRule = "newest" | "source" | "vyre" | "ask";
export interface SyncFieldMap {
  local: string;
  remote: string;
  direction: Direction;
  /** Small expression over `value`, applied to what is pulled. */ transform?: string;
  /** A relation: the remote value is the id of a record of another synced type, and the field holds a link to the record that id was pulled into (empty until that record has been pulled). */
  relation?: { syncTypeId: string; type: string; inverse?: string };
  /** A value this binding stamps on every record it pulls (the From field of an account): not read from the app, and it tells this binding's records from another account's in the same type. */
  constant?: string;
}
export interface SyncBinding {
  syncTypeId: string;
  type: string;
  remote: string;
  connector: string;
  label?: string;
  fields: SyncFieldMap[];
  match: string[];
  createAtSource: boolean;
  deletes: boolean;
  conflict: ConflictRule;
  guard?: { percent: number; count: number };
}
export interface SyncDeps {
  local: Store;
  remote: Store;
  tx: Tx;
  now?: () => number;
  /** The Space name, for the references a relation holds (vyre://<space>/<type>/<id>). */
  space?: string;
  emit?: (name: string, subject: string, payload: Record<string, unknown>) => unknown;
  maxAttempts?: number;
}
export interface SyncOptions {
  mode?: "pull" | "push" | "both";
  dryRun?: boolean;
  runAutomations?: boolean;
  traceId?: string;
  /** Who asked for the pass (a person pressing Sync or editing a record): pushes it queues carry the name, and the field history says "sent by". */ by?: string;
  /** A slice of the app's list instead of the whole list (a big app is pulled a page group at a time): nothing in the slice means nothing is gone, so no record is marked removed and no push runs. */
  partial?: StoredRecord[];
  /** With `partial`: also push what people changed here since this time (ms). The slice holds what changed in the app; a linked record changed only here is compared with what the app held at the last pass. */
  pushLocalSince?: number;
  /** With `partial`: every id the app still has (a deletion sweep). A linked record not in it is gone at the source. */
  sweepSeen?: Set<string>;
}
export interface SyncReport {
  runId: string;
  dryRun: boolean;
  local: { created: number; updated: number };
  remote: { created: number; updated: number; removed: number };
  matched: number;
  ambiguous: number;
  conflicts: number;
  askedConflicts: number;
  removedAtSource: number;
  pausedDeletes: boolean;
  queued: number;
  failed: number;
  /** Records the pass could not write here (a value the record type refuses): each is in the log, and the next pass tries again. */
  skipped: number;
  summary: string;
}

const GUARD = { percent: 10, count: 50 };
const OUTBOX_KEEP_MS = 30 * 86_400_000;

interface LinkDb {
  sync_type: string;
  local_id: string;
  remote_id: string;
  base: string;
  removed_at: number | null;
}
interface Link {
  localId: string;
  remoteId: string;
  base: Record<string, unknown>;
  removedAt: number | null;
  fresh?: boolean;
}
interface OutboxDb {
  outbox_id: string;
  sync_type: string;
  local_id: string;
  remote_id: string | null;
  by_actor?: string | null;
  op: "create" | "update" | "remove";
  fields: string;
  values_json: string;
  replaced: string | null;
  idem_key: string;
  status: string;
  attempts: number;
  error: string | null;
  trace_id: string | null;
  created_at: number;
  done_at: number | null;
  undone_at: number | null;
}
interface ConflictDb {
  conflict_id: string;
  sync_type: string;
  local_id: string;
  field: string;
  ours: string | null;
  theirs: string | null;
  base: string | null;
  rule: string;
  status: string;
  created_at: number;
}

const now = (d: SyncDeps): number => (d.now ?? Date.now)();
const pullable = (f: SyncFieldMap): boolean => f.direction === "pull" || f.direction === "both";
const pushable = (f: SyncFieldMap): boolean => f.direction === "push" || f.direction === "both";
const present = (v: unknown): boolean => v !== null && v !== undefined && v !== "";
const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function listAll(store: Store, type: string): Promise<Map<string, StoredRecord>> {
  const out = new Map<string, StoredRecord>();
  const turn = turns();
  let cursor: string | undefined;
  do {
    const p = await store.query(type, { page: { limit: 500, ...(cursor ? { cursor } : {}) } });
    for (const r of p.rows) out.set(r.id, r);
    cursor = p.next_cursor;
    await turn();
  } while (cursor);
  return out;
}

/** The records of a type changed after a time, a page at a time (the sync's push of what people edited here). */
async function listSince(store: Store, type: string, since: number): Promise<Map<string, StoredRecord>> {
  const out = new Map<string, StoredRecord>();
  const turn = turns();
  let cursor: string | undefined;
  do {
    const p = await store.query(type, {
      filter: { field: "updated_at", op: "gt", value: since },
      page: { limit: 500, ...(cursor ? { cursor } : {}) },
    });
    for (const r of p.rows) out.set(r.id, r);
    cursor = p.next_cursor;
    await turn();
  } while (cursor);
  return out;
}

const urnsOf = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .flatMap((x) =>
          x && typeof x === "object" && typeof (x as { urn?: unknown }).urn === "string"
            ? [(x as { urn: string }).urn]
            : [],
        )
        .sort()
    : [];

/** The value the remote record holds for a mapped field, as the local field takes it. A relation turns the remote id into a link to the record pulled for it, or null while there is none. */
const theirsOf = (d: SyncDeps, f: SyncFieldMap, rec: StoredRecord): unknown => {
  if (f.constant !== undefined) return f.constant;
  const v = rec.data[f.remote];
  if (f.relation) {
    if (!present(v)) return null;
    const hit = d.tx.get<{ local_id: string }>(
      "SELECT local_id FROM sy_links WHERE sync_type = ? AND remote_id = ? AND (removed_at IS NULL OR removed_at = 0)",
      f.relation.syncTypeId,
      String(v),
    );
    return hit ? [{ urn: `vyre://${d.space ?? "space"}/${f.relation.type}/${hit.local_id}` }] : null;
  }
  if (!present(v) || !f.transform) return v ?? null;
  const out = evalExpr(parseExpr(f.transform), { values: { value: v } });
  return out ?? null;
};

/** Compare as the field means it: a relation by the records it links, anything else by value. */
const sameField = (f: SyncFieldMap, a: unknown, b: unknown): boolean =>
  f.relation ? canonical(urnsOf(a)) === canonical(urnsOf(b)) : same(a, b);

/** A two-way relation moves at both ends: when a record's link changes here, the field that links back on the other record changes with it. The change is owed to the far record and kept in `sy_far_owed` (with the
 * record's own links, in the same store) until `writeFar` has written it, so a process that stops in between loses nothing: the next pass writes what is owed first. */
function relinkFar(
  d: SyncDeps,
  b: SyncBinding,
  localId: string,
  fields: SyncFieldMap[],
  was: Record<string, unknown>,
  becomes: Record<string, unknown>,
): void {
  const self = `vyre://${d.space ?? "space"}/${b.type}/${localId}`;
  for (const f of fields) {
    const inverse = f.relation?.inverse;
    if (!f.relation || !inverse || !(f.local in becomes)) continue;
    const before = new Set(urnsOf(was[f.local])),
      after = new Set(urnsOf(becomes[f.local]));
    const note = (urn: string, add: boolean): void => {
      d.tx.run(
        "INSERT OR REPLACE INTO sy_far_owed (ftype, fid, inverse, urn, add_link, sync_type) VALUES (?, ?, ?, ?, ?, ?)",
        f.relation!.type,
        urn.split("/").pop() ?? "",
        inverse,
        self,
        add ? 1 : 0,
        b.syncTypeId,
      );
    };
    for (const urn of before) if (!after.has(urn)) note(urn, false);
    for (const urn of after) if (!before.has(urn)) note(urn, true);
  }
}

/** How many far records are written between two turns of the event loop, and one chunk's worth of owed rows read at a time. */
const FAR_CHUNK = 200;
/** New records made in one commit (it holds the loop about 50 ms per 200). */
const CREATE_GROUP = 200;
/** The store answers a group whose commit failed with the same refusal for every item: nothing of it was made. */
const isWholeFailure = (e: unknown): boolean => {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "unavailable" || code === "internal";
};
/** A write to a far record that fails this many times is parked: never tried again, and said once. */
const FAR_TRIES = 5;
/** A record that stays over the most links is said again after this long, or sooner when its count changes. */
const FAR_NOTICE_MS = 24 * 3600 * 1000;
interface OwedRow {
  urn: string;
  add_link: number;
}
interface FarOutcome {
  /** records that would hold more links than a record may and that were not said already (new, or their count changed, or a day has passed) */
  over: { type: string; id: string; inverse: string; links: number }[];
  /** records whose write failed FAR_TRIES times and are parked now */
  parked: { type: string; id: string; inverse: string; why: string }[];
}

/** Writes what is owed to the far ends of this binding's relations: one read and one write for each far record, however many links it gains or loses, in chunks of FAR_CHUNK records (a keyset over the owed index, so a big owed
 * set is never read whole), and the owed rows of a record are removed once its write has gone through. A record that would hold more links than a record may (MAX_LINKS) is not changed and stays owed; nothing is dropped without being said.
 * A write that fails is counted and, at FAR_TRIES, parked. `verify`: an add whose linking record is gone since it was noted is dropped, not written (set for what an earlier pass left). */
async function writeFar(
  d: SyncDeps,
  syncTypeId: string,
  skip: (what: string, e: unknown) => void,
  turn: () => Promise<void>,
  verify: boolean,
): Promise<FarOutcome> {
  const out: FarOutcome = { over: [], parked: [] };
  let after = { ftype: "", fid: "", inverse: "" };
  for (;;) {
    const heads = d.tx.all<{ ftype: string; fid: string; inverse: string }>(
      "SELECT DISTINCT ftype, fid, inverse FROM sy_far_owed WHERE sync_type = ? AND parked = 0 AND (ftype, fid, inverse) > (?, ?, ?) ORDER BY ftype, fid, inverse LIMIT ?",
      syncTypeId,
      after.ftype,
      after.fid,
      after.inverse,
      FAR_CHUNK,
    );
    if (!heads.length) break;
    for (const h of heads) {
      await turn();
      after = h;
      try {
        let rows = d.tx.all<OwedRow>(
          "SELECT urn, add_link FROM sy_far_owed WHERE ftype = ? AND fid = ? AND inverse = ? AND parked = 0",
          h.ftype,
          h.fid,
          h.inverse,
        );
        if (verify) {
          // a record that was linked and has been deleted since: its link is not added to the far record
          const keep: OwedRow[] = [];
          for (const r of rows) {
            if (!r.add_link) keep.push(r);
            else {
              const [t, id] = r.urn.split("/").slice(-2);
              if (t && id && (await d.local.get(t, id))) keep.push(r);
              else
                d.tx.run(
                  "DELETE FROM sy_far_owed WHERE ftype = ? AND fid = ? AND inverse = ? AND urn = ?",
                  h.ftype,
                  h.fid,
                  h.inverse,
                  r.urn,
                );
            }
          }
          rows = keep;
        }
        const rec = await d.local.get(h.ftype, h.fid);
        if (rec) {
          const list = Array.isArray(rec.data[h.inverse]) ? (rec.data[h.inverse] as { urn?: string }[]) : [];
          const drop = new Set(rows.filter((r) => !r.add_link).map((r) => r.urn));
          const have = new Set(urnsOf(list));
          const next = list.filter((x) => !(x.urn !== undefined && drop.has(x.urn)));
          let changed = next.length !== list.length;
          for (const r of rows)
            if (r.add_link && !have.has(r.urn)) {
              next.push({ urn: r.urn });
              changed = true;
            }
          if (next.length > MAX_LINKS) {
            const said = d.tx.get<{ links: number; at: number }>(
              "SELECT links, at FROM sy_far_notice WHERE ftype = ? AND fid = ? AND inverse = ?",
              h.ftype,
              h.fid,
              h.inverse,
            );
            if (!said || said.links !== next.length || now(d) - said.at >= FAR_NOTICE_MS) {
              out.over.push({ type: h.ftype, id: h.fid, inverse: h.inverse, links: next.length });
              d.tx.run(
                "INSERT OR REPLACE INTO sy_far_notice (ftype, fid, inverse, links, at) VALUES (?, ?, ?, ?, ?)",
                h.ftype,
                h.fid,
                h.inverse,
                next.length,
                now(d),
              );
            }
            continue;
          }
          if (changed) await d.local.update(h.ftype, rec.id, { [h.inverse]: next }, rec.version);
        }
        d.tx.run(
          "DELETE FROM sy_far_owed WHERE ftype = ? AND fid = ? AND inverse = ? AND parked = 0",
          h.ftype,
          h.fid,
          h.inverse,
        );
        d.tx.run("DELETE FROM sy_far_notice WHERE ftype = ? AND fid = ? AND inverse = ?", h.ftype, h.fid, h.inverse);
      } catch (e) {
        d.tx.run(
          "UPDATE sy_far_owed SET attempts = attempts + 1 WHERE ftype = ? AND fid = ? AND inverse = ? AND parked = 0",
          h.ftype,
          h.fid,
          h.inverse,
        );
        const tries =
          d.tx.get<{ n: number }>(
            "SELECT max(attempts) AS n FROM sy_far_owed WHERE ftype = ? AND fid = ? AND inverse = ? AND parked = 0",
            h.ftype,
            h.fid,
            h.inverse,
          )?.n ?? 0;
        if (tries >= FAR_TRIES) {
          d.tx.run(
            "UPDATE sy_far_owed SET parked = 1 WHERE ftype = ? AND fid = ? AND inverse = ?",
            h.ftype,
            h.fid,
            h.inverse,
          );
          out.parked.push({ type: h.ftype, id: h.fid, inverse: h.inverse, why: msgOf(e) });
        } else skip(`the ${h.inverse} of ${h.ftype} ${h.fid}`, e);
      }
    }
  }
  return out;
}

const HISTORY_SQL =
  "CREATE TABLE IF NOT EXISTS records_field_history (type TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, value TEXT, hlc TEXT NOT NULL, actor TEXT NOT NULL, seq INTEGER NOT NULL, reason TEXT NOT NULL)";
/** The value that lost a newest-wins settlement, kept in the field's history so a person can see it and restore it. */
function keepLoser(
  d: SyncDeps,
  type: string,
  id: string,
  field: string,
  value: unknown,
  actor: string,
  reason = "lww_loser",
): void {
  d.tx.exec(HISTORY_SQL);
  const at = now(d);
  const seq =
    (d.tx.get<{ n: number }>(
      "SELECT count(*) AS n FROM records_field_history WHERE type = ? AND id = ? AND field = ?",
      type,
      id,
      field,
    )?.n ?? 0) + 1;
  d.tx.run(
    "INSERT INTO records_field_history (type, id, field, value, hlc, actor, seq, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    type,
    id,
    field,
    JSON.stringify(value ?? null),
    formatHlc({ ms: at, counter: 0, deviceId: "sync" }),
    actor,
    seq,
    reason,
  );
}

const toLink = (r: LinkDb): Link => ({
  localId: r.local_id,
  remoteId: r.remote_id,
  base: JSON.parse(r.base) as Record<string, unknown>,
  removedAt: r.removed_at,
});
const loadLinks = (tx: Tx, syncTypeId: string): Link[] =>
  tx.all<LinkDb>("SELECT * FROM sy_links WHERE sync_type = ? ORDER BY rowid", syncTypeId).map(toLink);
/** The links of the records named, by the app's id or by the local id: only those rows are read and decoded, never the whole table of links. */
const loadLinksFor = (tx: Tx, syncTypeId: string, column: "remote_id" | "local_id", ids: readonly string[]): Link[] => {
  const out: Link[] = [];
  for (let at = 0; at < ids.length; at += 400) {
    const part = ids.slice(at, at + 400);
    for (const r of tx.all<LinkDb>(
      `SELECT * FROM sy_links WHERE sync_type = ? AND ${column} IN (${part.map(() => "?").join(",")})`,
      syncTypeId,
      ...part,
    ))
      out.push(toLink(r));
  }
  return out;
};

const saveLink = (tx: Tx, syncTypeId: string, l: Link): void => {
  tx.run(
    "INSERT INTO sy_links (sync_type, local_id, remote_id, base, removed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sync_type, local_id) DO UPDATE SET remote_id = excluded.remote_id, base = excluded.base, removed_at = excluded.removed_at",
    syncTypeId,
    l.localId,
    l.remoteId,
    JSON.stringify(l.base),
    l.removedAt,
  );
};

function log(d: SyncDeps, syncTypeId: string, kind: string, summary: string, runId: string, traceId?: string): void {
  d.tx.run(
    "INSERT INTO sy_log (sync_type, at, kind, summary, run_id, trace_id) VALUES (?, ?, ?, ?, ?, ?)",
    syncTypeId,
    now(d),
    kind,
    summary,
    runId,
    traceId ?? null,
  );
}

interface LocalAction {
  link: Link;
  localId: string;
  patch: Record<string, unknown>;
  version: number;
  prev: Record<string, unknown>;
}
interface RemoteAction {
  link: Link;
  patch: Record<string, unknown>;
  fields: string[];
}

/**
 * Is there any live record of the type here that this binding has no link for? An exact question, answered by the index of the links (the first unlinked record ends it): a new row from the app is matched
 * against records made here only when there is one, and a stale link to a record that was deleted changes nothing. Where the type's table is not in the database of the links (a store of another
 * kind), the answer is yes and the whole type is read.
 */
function anyUnlinkedHere(d: SyncDeps, b: SyncBinding): boolean {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(b.type)) return true;
  const table = `rt_${b.type}`;
  if (d.tx.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", table) === undefined) return true;
  return (
    d.tx.get(
      `SELECT 1 AS x FROM ${table} r WHERE r.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM sy_links l WHERE l.sync_type = ? AND l.local_id = r.id) LIMIT 1`,
      b.syncTypeId,
    ) !== undefined
  );
}

export async function runSync(d: SyncDeps, b: SyncBinding, o: SyncOptions = {}): Promise<SyncReport> {
  ensureTables(d.tx);
  const mode = o.mode ?? "both";
  const pullOn = mode !== "push";
  const pushOn = mode !== "pull" && (!o.partial || o.pushLocalSince !== undefined);
  const dry = o.dryRun === true;
  const runId = mintShort("run", now(d));
  const quiet = o.runAutomations !== true;
  const fields = b.fields.filter((f) => f.direction !== "off");
  const guard = b.guard ?? GUARD;
  const label = b.label ?? b.connector;
  const emit = (name: string, subject: string, payload: Record<string, unknown>): void => {
    if (!dry) d.emit?.(name, subject, payload);
  };

  // What a pass reads of this side. A slice of the app's records (a group of a first pull, a changed-since pull) needs only the local records those rows are linked to, the ones changed here since the
  // last pass, and, to match a new row with a record made here, the unlinked ones: reading and decoding every record of a 100,000-record type for each slice held the server for seconds a pass. A full
  // pass, a sweep, a pass that also carries deletes, one that creates records in the app, and a slice that brings rows to match against records made here read the whole type as before.
  let lazy = false;
  let localMap = new Map<string, StoredRecord>();
  let remoteMap = new Map<string, StoredRecord>();
  let links: Link[] = [];
  if (o.partial && o.sweepSeen === undefined && !(b.deletes && pushOn)) {
    remoteMap = new Map(o.partial.map((r) => [r.id, r] as const));
    const linked = loadLinksFor(d.tx, b.syncTypeId, "remote_id", [...remoteMap.keys()]);
    const known = new Set(linked.map((l) => l.remoteId));
    const fresh = [...remoteMap.keys()].some((id) => !known.has(id));
    let mayMatch = false;
    if (fresh && b.match.length) mayMatch = anyUnlinkedHere(d, b);
    if (!mayMatch && !(b.createAtSource && pushOn)) {
      lazy = true;
      const changed =
        o.pushLocalSince !== undefined && pushOn ? await listSince(d.local, b.type, o.pushLocalSince) : new Map();
      const byChange = loadLinksFor(d.tx, b.syncTypeId, "local_id", [...changed.keys()]);
      const seen = new Set<string>();
      for (const l of [...linked, ...byChange])
        if (!seen.has(l.localId)) {
          seen.add(l.localId);
          links.push(l);
        }
      localMap = new Map(changed);
      const turn = turns();
      for (const l of links) {
        await turn();
        if (localMap.has(l.localId)) continue;
        const rec = await d.local.get(b.type, l.localId);
        if (rec) localMap.set(l.localId, rec);
      }
    }
  }
  if (!lazy) {
    [localMap, remoteMap] = await Promise.all([
      listAll(d.local, b.type),
      o.partial ? Promise.resolve(new Map(o.partial.map((r) => [r.id, r] as const))) : listAll(d.remote, b.remote),
    ]);
    links = loadLinks(d.tx, b.syncTypeId);
  }
  const byLocal = new Map(links.map((l) => [l.localId, l]));
  const byRemote = new Map(links.map((l) => [l.remoteId, l]));

  const rep: SyncReport = {
    runId,
    dryRun: dry,
    local: { created: 0, updated: 0 },
    remote: { created: 0, updated: 0, removed: 0 },
    matched: 0,
    ambiguous: 0,
    conflicts: 0,
    askedConflicts: 0,
    removedAtSource: 0,
    pausedDeletes: false,
    queued: 0,
    failed: 0,
    skipped: 0,
    summary: "",
  };
  const localActions: LocalAction[] = [];
  const remoteActions: RemoteAction[] = [];
  const removals: Link[] = [];
  const creates: { remote: StoredRecord; data: Record<string, unknown>; base: Record<string, unknown> }[] = [];
  const remoteCreates: { local: StoredRecord; data: Record<string, unknown> }[] = [];
  const vanished: Link[] = [];

  const mappedTheirs = (rec: StoredRecord, only?: (f: SyncFieldMap) => boolean): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const f of fields) if (!only || only(f)) out[f.local] = theirsOf(d, f, rec);
    return out;
  };

  // ---- pairs: linked records first, then first-sync matches ----
  const pairs: {
    link: Link;
    local: StoredRecord;
    remote: StoredRecord;
    /** The app's record is not in hand: it holds what the last pass saw. */ unchanged?: boolean;
  }[] = [];
  for (const l of links) {
    const remote = remoteMap.get(l.remoteId);
    const local = localMap.get(l.localId);
    if (!remote && o.partial) {
      // a slice: absence means nothing, except in a sweep, and a record changed only here is compared with what the last pass saw
      if (l.removedAt !== null) continue;
      if (o.sweepSeen) {
        if (!o.sweepSeen.has(l.remoteId)) vanished.push(l);
        continue;
      }
      if (o.pushLocalSince === undefined) continue;
      if (!local) {
        if (b.deletes && pushOn) removals.push(l);
        continue;
      }
      if (local.updated_at > o.pushLocalSince)
        pairs.push({ link: l, local, remote: { ...local, updated_at: 0 }, unchanged: true });
      continue;
    }
    if (!remote) {
      if (l.removedAt === null) vanished.push(l);
      continue;
    }
    if (l.removedAt !== null) {
      l.removedAt = null;
      if (!dry) saveLink(d.tx, b.syncTypeId, l);
    }
    if (!local) {
      if (b.deletes && pushOn) removals.push(l);
      continue;
    }
    pairs.push({ link: l, local, remote });
  }

  // another account's records in the same type are not this binding's to match or to create in the app
  const constants = fields.filter((f) => f.constant !== undefined);
  const mine = (r: StoredRecord): boolean =>
    constants.every((c) => !present(r.data[c.local]) || r.data[c.local] === c.constant);
  const unlinkedLocal = lazy ? [] : [...localMap.values()].filter((r) => !byLocal.has(r.id) && mine(r));
  const index = new Map<string, StoredRecord[]>();
  if (b.match.length) {
    for (const r of unlinkedLocal) {
      if (!b.match.every((m) => present(r.data[m]))) continue;
      const k = canonical(b.match.map((m) => r.data[m]));
      index.set(k, [...(index.get(k) ?? []), r]);
    }
  }
  const taken = new Set<string>();
  const turn = turns();
  for (const remote of remoteMap.values()) {
    await turn();
    if (byRemote.has(remote.id)) continue;
    const theirs = mappedTheirs(remote);
    const key =
      b.match.length && b.match.every((m) => present(theirs[m])) ? canonical(b.match.map((m) => theirs[m])) : undefined;
    const cands = key !== undefined ? (index.get(key) ?? []).filter((c) => !taken.has(c.id)) : [];
    if (cands.length > 1) {
      rep.ambiguous++;
      continue;
    }
    if (cands.length === 1) {
      const local = cands[0]!;
      taken.add(local.id);
      rep.matched++;
      // The base for a first link: what the remote holds, except where we hold nothing, so an empty local value is filled from the remote rather than emptying it.
      const base: Record<string, unknown> = {};
      for (const f of fields)
        base[f.local] = present(local.data[f.local]) ? theirs[f.local] : (local.data[f.local] ?? null);
      pairs.push({
        link: { localId: local.id, remoteId: remote.id, base, removedAt: null, fresh: true },
        local,
        remote,
      });
      continue;
    }
    if (!pullOn || !fields.some(pullable)) continue;
    const data: Record<string, unknown> = {};
    for (const f of fields) if (pullable(f) && present(theirs[f.local])) data[f.local] = theirs[f.local];
    // A field that is not pulled starts empty here, so it is not mistaken for something we changed.
    const base: Record<string, unknown> = {};
    for (const f of fields) base[f.local] = pullable(f) ? theirs[f.local] : null;
    creates.push({ remote, data, base });
  }
  if (b.createAtSource && pushOn && fields.some(pushable)) {
    for (const local of unlinkedLocal) {
      if (taken.has(local.id)) continue;
      const data: Record<string, unknown> = {};
      for (const f of fields) if (pushable(f) && present(local.data[f.local])) data[f.remote] = local.data[f.local];
      if (Object.keys(data).length) remoteCreates.push({ local, data });
    }
  }

  // ---- three-way compare of each pair ----
  const conflictRows: { localId: string; field: string; ours: unknown; theirs: unknown; base: unknown }[] = [];
  const losses: { localId: string; field: string; value: unknown; actor: string }[] = [];
  for (const { link, local, remote, unchanged } of pairs) {
    await turn();
    const pullPatch: Record<string, unknown> = {};
    const pushPatch: Record<string, unknown> = {};
    const pushFields: string[] = [];
    const nextBase: Record<string, unknown> = { ...link.base };
    for (const f of fields) {
      const base = link.base[f.local];
      const ours = local.data[f.local];
      const theirs = unchanged ? base : theirsOf(d, f, remote);
      const oursMoved = !sameField(f, ours, base);
      const theirsMoved = !sameField(f, theirs, base);
      if (!oursMoved && !theirsMoved) continue;
      if (oursMoved && theirsMoved && sameField(f, ours, theirs)) {
        nextBase[f.local] = theirs;
        continue;
      }
      let take: "theirs" | "ours" | "none" = "none";
      if (theirsMoved && !oursMoved) take = pullable(f) ? "theirs" : "none";
      else if (oursMoved && !theirsMoved) take = pushable(f) ? "ours" : "none";
      else {
        rep.conflicts++;
        if (f.direction === "pull") take = "theirs";
        else if (f.direction === "push") take = "ours";
        else if (b.conflict === "source") take = "theirs";
        else if (b.conflict === "vyre") take = "ours";
        else if (b.conflict === "newest") take = local.updated_at > remote.updated_at ? "ours" : "theirs";
        else {
          rep.askedConflicts++;
          conflictRows.push({ localId: local.id, field: f.local, ours, theirs, base });
        }
      }
      const both = oursMoved && theirsMoved;
      if (take === "theirs" && pullOn) {
        pullPatch[f.local] = theirs;
        nextBase[f.local] = theirs;
        if (both) losses.push({ localId: local.id, field: f.local, value: ours, actor: `sync:${label}` });
      } else if (take === "ours" && pushOn) {
        pushPatch[f.remote] = ours ?? null;
        pushFields.push(f.local);
        if (both) losses.push({ localId: local.id, field: f.local, value: theirs, actor: `source:${label}` });
      }
    }
    const baseMoved = !same(nextBase, link.base);
    if (Object.keys(pullPatch).length) {
      const prev: Record<string, unknown> = {};
      for (const k of Object.keys(pullPatch))
        if (Object.prototype.hasOwnProperty.call(local.data, k)) prev[k] = local.data[k];
      localActions.push({
        link: { ...link, base: nextBase },
        localId: local.id,
        patch: pullPatch,
        version: local.version,
        prev,
      });
      rep.local.updated++;
    } else if (baseMoved || link.fresh) {
      localActions.push({
        link: { ...link, base: nextBase },
        localId: local.id,
        patch: {},
        version: local.version,
        prev: {},
      });
    }
    if (Object.keys(pushPatch).length) {
      remoteActions.push({ link: { ...link, base: nextBase }, patch: pushPatch, fields: pushFields });
      rep.remote.updated++;
    }
  }
  rep.local.created = creates.length;
  rep.remote.created = remoteCreates.length;
  rep.remote.removed = removals.length;

  // ---- deletes at the source ----
  const live = lazy
    ? vanished.length
      ? (d.tx.get<{ n: number }>(
          "SELECT count(*) AS n FROM sy_links WHERE sync_type = ? AND removed_at IS NULL",
          b.syncTypeId,
        )?.n ?? 0)
      : 0
    : links.filter((l) => l.removedAt === null).length;
  const percent = live ? (vanished.length / live) * 100 : 0;
  if (vanished.length && (vanished.length > guard.count || percent > guard.percent)) {
    rep.pausedDeletes = true;
    if (!dry) {
      d.tx.run(
        "INSERT INTO sy_state (sync_type, pending_deletes) VALUES (?, ?) ON CONFLICT(sync_type) DO UPDATE SET pending_deletes = excluded.pending_deletes",
        b.syncTypeId,
        JSON.stringify(vanished.map((l) => l.localId)),
      );
      emit("sync.deletes_paused", `entity/${b.syncTypeId}`, {
        syncTypeId: b.syncTypeId,
        type: b.type,
        count: vanished.length,
        percent: Math.round(percent * 10) / 10,
      });
    }
  } else rep.removedAtSource = vanished.length;

  // ---- the open conflicts ask a person ----
  if (!dry) {
    for (const c of conflictRows) {
      const id = mintShort("cfl", now(d));
      const r = d.tx.run(
        "INSERT OR IGNORE INTO sy_conflicts (conflict_id, sync_type, local_id, field, ours, theirs, base, rule, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ask', ?)",
        id,
        b.syncTypeId,
        c.localId,
        c.field,
        JSON.stringify(c.ours ?? null),
        JSON.stringify(c.theirs ?? null),
        JSON.stringify(c.base ?? null),
        now(d),
      );
      if (r.changes)
        emit("sync.conflict", `record/${c.localId}`, {
          conflictId: id,
          syncTypeId: b.syncTypeId,
          type: b.type,
          recordId: c.localId,
          field: c.field,
          rule: "ask",
        });
    }
  }

  rep.summary = summarise(rep, label);
  if (dry) return rep;

  // ---- apply: local side ----
  const announce = (name: "record.created" | "record.updated", id: string, payload: Record<string, unknown>): void => {
    d.emit?.(name, `record/${id}`, { recordId: id, type: b.type, ...payload, ...(quiet ? { quiet: true } : {}) });
  };
  const skip = (what: string, e: unknown): void => {
    rep.skipped++;
    log(d, b.syncTypeId, "error", `skipped ${what}: ${msgOf(e)}`, runId, o.traceId);
  };
  // what an earlier pass owed to the far ends and did not write (it stopped, or a record was busy) is written first
  const early = await writeFar(d, b.syncTypeId, skip, turn, true);
  // New records are made a group at a time, one commit for the group (the store's group commit), not one commit each: a first sync of a firm's tables is mostly this loop. Each item still has its own
  // result and is linked and announced in the order it was given, so what is left in the tables and the log is what the one-at-a-time path leaves; an item the store refuses is skipped alone. A group whose commit
  // failed made nothing: every item of it is skipped, no link is saved, and the next pass finds them still to create. A store without createMany (or a type with a unique field, which it handles itself) is made one by one.
  const linkNew = (id: string, c: (typeof creates)[number], rec: StoredRecord): void => {
    saveLink(d.tx, b.syncTypeId, { localId: id, remoteId: c.remote.id, base: c.base, removedAt: null });
    relinkFar(d, b, id, fields, {}, c.data);
    announce("record.created", id, { fields: { ...rec.data } });
  };
  const makeOne = async (c: (typeof creates)[number]): Promise<void> => {
    try {
      const id = mintRecordId(now(d));
      linkNew(id, c, await d.local.create(b.type, id, c.data));
    } catch (e) {
      skip(`${label} record ${c.remote.id}`, e);
    }
  };
  for (let from = 0; from < creates.length; ) {
    await turn();
    const group = d.local.createMany ? creates.slice(from, from + CREATE_GROUP) : creates.slice(from, from + 1);
    from += group.length;
    if (group.length < 2 || !d.local.createMany) {
      for (const c of group) await makeOne(c);
      continue;
    }
    const ids = group.map(() => mintRecordId(now(d)));
    let results: Awaited<ReturnType<NonNullable<Store["createMany"]>>> | null = null;
    try {
      results = await d.local.createMany(
        b.type,
        group.map((c, k) => ({ id: ids[k]!, data: c.data })),
      );
    } catch {
      // safe to retry under new ids only because a call that threw made nothing (the kernel store answers after its commit from rows it just wrote): never widen this to a call that may have committed
      results = null;
    }
    // A group that failed as a whole (the call threw, or every item came back unavailable or internal: the log rolls the whole batch back when one event cannot be folded) made nothing. One row that cannot be
    // made must not take the other rows of its group with it, so the group is made one at a time, each in its own try: the bad row is skipped alone and the rest are made and linked.
    const wholly = results === null || results.every((r) => !r.ok && isWholeFailure(r.error));
    if (wholly) {
      for (const c of group) await makeOne(c);
      continue;
    }
    for (let k = 0; k < group.length; k++) {
      const c = group[k]!;
      const r = results![k]!;
      try {
        if (!r.ok) throw r.error;
        linkNew(ids[k]!, c, r.record);
      } catch (e) {
        skip(`${label} record ${c.remote.id}`, e);
      }
    }
  }
  for (const a of localActions) {
    await turn();
    try {
      if (Object.keys(a.patch).length) {
        const rec = await d.local.update(b.type, a.localId, a.patch, a.version);
        const keys = Object.keys(a.patch);
        const changed: Record<string, unknown> = {};
        for (const k of keys) changed[k] = Object.prototype.hasOwnProperty.call(rec.data, k) ? rec.data[k] : null;
        announce("record.updated", a.localId, { fields: changed, prev: a.prev, version: rec.version });
        relinkFar(d, b, a.localId, fields, a.prev, a.patch);
      }
      saveLink(d.tx, b.syncTypeId, a.link);
    } catch (e) {
      skip(`record ${a.localId}`, e);
    }
  }
  const late = await writeFar(d, b.syncTypeId, skip, turn, false);
  const over = [...early.over, ...late.over];
  const parked = [...early.parked, ...late.parked];
  // new trouble only: a record that stays over the most links is said once a day or when its count changes (and counts as skipped then), a write that gave up is said once, when it is parked
  for (const x of over) {
    rep.skipped++;
    log(
      d,
      b.syncTypeId,
      "error",
      `${x.inverse} of ${x.type} ${x.id} would hold ${x.links} links, more than the ${MAX_LINKS} a record may hold: its links were not changed`,
      runId,
      o.traceId,
    );
  }
  for (const x of parked) {
    rep.skipped++;
    log(
      d,
      b.syncTypeId,
      "error",
      `the links owed to ${x.inverse} of ${x.type} ${x.id} could not be written after ${FAR_TRIES} tries and are set aside: ${x.why}`,
      runId,
      o.traceId,
    );
  }
  if (over.length)
    rep.summary += ` ${over.length} ${over.length === 1 ? "record" : "records"} at the other end of a link would hold more than ${MAX_LINKS} links and ${over.length === 1 ? "was" : "were"} not changed: ${over
      .slice(0, 3)
      .map((x) => `${x.type} ${x.id} (${x.links})`)
      .join(", ")}.`;
  if (parked.length)
    rep.summary += ` ${parked.length} ${parked.length === 1 ? "record" : "records"} at the other end of a link could not be written and ${parked.length === 1 ? "was" : "were"} set aside.`;
  for (const l of losses) keepLoser(d, b.type, l.localId, l.field, l.value, l.actor);
  for (const l of vanished) if (!rep.pausedDeletes) saveLink(d.tx, b.syncTypeId, { ...l, removedAt: now(d) });

  // ---- apply: queue pushes, then flush the outbox ----
  const queue = (
    localId: string,
    remoteId: string | null,
    op: "create" | "update" | "remove",
    fieldList: string[],
    values: Record<string, unknown>,
  ): void => {
    const idem = `${op}:${remoteId ?? localId}:${canonical(values)}`;
    const open = d.tx.get<OutboxDb>(
      "SELECT * FROM sy_outbox WHERE sync_type = ? AND idem_key = ? AND status IN ('pending', 'failed')",
      b.syncTypeId,
      idem,
    );
    if (open) return;
    const nth =
      d.tx.get<{ n: number }>(
        "SELECT count(*) AS n FROM sy_outbox WHERE sync_type = ? AND (idem_key = ? OR idem_key LIKE ?)",
        b.syncTypeId,
        idem,
        `${idem}#%`,
      )?.n ?? 0;
    d.tx.run(
      "INSERT INTO sy_outbox (outbox_id, sync_type, local_id, remote_id, op, fields, values_json, idem_key, trace_id, created_at, by_actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      mintShort("obx", now(d)),
      b.syncTypeId,
      localId,
      remoteId,
      op,
      JSON.stringify(fieldList),
      JSON.stringify(values),
      nth ? `${idem}#${nth}` : idem,
      o.traceId ?? null,
      now(d),
      o.by ?? null,
    );
    rep.queued++;
  };
  for (const a of remoteActions) queue(a.link.localId, a.link.remoteId, "update", a.fields, a.patch);
  for (const c of remoteCreates) queue(c.local.id, null, "create", Object.keys(c.data), c.data);
  for (const l of removals) queue(l.localId, l.remoteId, "remove", [], {});
  rep.failed = await flushOutbox(d, b);

  d.tx.run(
    "INSERT INTO sy_state (sync_type, last_run_at) VALUES (?, ?) ON CONFLICT(sync_type) DO UPDATE SET last_run_at = excluded.last_run_at",
    b.syncTypeId,
    now(d),
  );
  d.tx.run(
    "DELETE FROM sy_outbox WHERE sync_type = ? AND status IN ('done', 'undone') AND created_at < ?",
    b.syncTypeId,
    now(d) - OUTBOX_KEEP_MS,
  );
  log(d, b.syncTypeId, "pull", `${rep.local.created} created, ${rep.local.updated} updated here`, runId, o.traceId);
  log(
    d,
    b.syncTypeId,
    "push",
    `${rep.remote.created} created, ${rep.remote.updated} updated, ${rep.remote.removed} removed in ${label}`,
    runId,
    o.traceId,
  );
  for (const c of conflictRows) log(d, b.syncTypeId, "conflict", `${c.field} changed on both sides`, runId, o.traceId);
  d.emit?.("sync.completed", `entity/${b.syncTypeId}`, {
    runId,
    syncTypeId: b.syncTypeId,
    type: b.type,
    connector: b.connector,
    mode,
    pulled: rep.local.created + rep.local.updated,
    pushed: rep.remote.created + rep.remote.updated + rep.remote.removed,
    created: rep.local.created + rep.remote.created,
    updated: rep.local.updated + rep.remote.updated,
    removed: rep.removedAtSource,
  });
  return rep;
}

function summarise(r: SyncReport, label: string): string {
  const n = (c: number, w: string): string => `${c} ${c === 1 ? "record" : "records"} ${w}`;
  const parts: string[] = [];
  if (r.local.created) parts.push(`create ${n(r.local.created, "here")}`);
  if (r.local.updated) parts.push(`update ${n(r.local.updated, "here")}`);
  if (r.remote.created) parts.push(`create ${n(r.remote.created, `in ${label}`)}`);
  if (r.remote.updated) parts.push(`update ${n(r.remote.updated, `in ${label}`)}`);
  if (r.remote.removed) parts.push(`remove ${n(r.remote.removed, `from ${label}`)}`);
  if (r.matched) parts.push(`link ${n(r.matched, "that already exist on both sides")}`);
  if (r.askedConflicts)
    parts.push(`ask about ${r.askedConflicts} ${r.askedConflicts === 1 ? "conflict" : "conflicts"}`);
  if (r.removedAtSource) parts.push(`mark ${n(r.removedAtSource, "removed at source")}`);
  if (r.pausedDeletes) parts.push("wait for you to confirm records that vanished");
  if (r.skipped) parts.push(`skip ${n(r.skipped, "that cannot be written here")}`);
  return parts.length ? `Will ${parts.join(", ")}.` : "Nothing to change.";
}

/** Work through the outbox. Returns how many pushes ended failed for good in this pass. */
export async function flushOutbox(d: SyncDeps, b: SyncBinding): Promise<number> {
  const max = d.maxAttempts ?? 3;
  const fieldsByLocal = new Map(b.fields.map((f) => [f.remote, f.local]));
  let failedNow = 0;
  const rows = d.tx.all<OutboxDb>(
    "SELECT * FROM sy_outbox WHERE sync_type = ? AND status = 'pending' ORDER BY created_at, rowid",
    b.syncTypeId,
  );
  for (const row of rows) {
    const values = JSON.parse(row.values_json) as Record<string, unknown>;
    try {
      let remoteId = row.remote_id;
      let replaced: Record<string, unknown> | null = null;
      // A big app that answers "changed since" is never listed to find one record: what it held is what the last pass saw (the link's base)
      const lazy = (d.remote as { lazy?: boolean }).lazy === true;
      const heldBefore = (): StoredRecord | null => {
        const link = loadLinks(d.tx, b.syncTypeId).find((l) => l.localId === row.local_id);
        if (!link) return null;
        const data: Record<string, unknown> = {};
        for (const [remotePath, localKey] of fieldsByLocal) data[remotePath] = link.base[localKey] ?? null;
        return { type: b.remote, id: remoteId!, version: 1, data, created_at: 0, updated_at: 0 } as StoredRecord;
      };
      if (row.op === "update") {
        const cur = lazy ? heldBefore() : await d.remote.get(b.remote, remoteId!);
        if (!cur) throw new Error(`the ${b.label ?? b.connector} record ${remoteId} is gone`);
        replaced = {};
        for (const k of Object.keys(values)) replaced[k] = cur.data[k] ?? null;
        const already = Object.keys(values).every((k) => same(cur.data[k], values[k]));
        if (!already) await d.remote.update(b.remote, remoteId!, values, cur.version);
      } else if (row.op === "create") {
        const made = await d.remote.create(b.remote, mintRecordId(now(d)), values);
        remoteId = made.id;
      } else {
        const cur = lazy ? heldBefore() : await d.remote.get(b.remote, remoteId!);
        if (cur) {
          replaced = { ...cur.data };
          await d.remote.remove(b.remote, remoteId!, cur.version);
        }
      }
      d.tx.run(
        "UPDATE sy_outbox SET status = 'done', remote_id = ?, replaced = ?, error = NULL, done_at = ? WHERE outbox_id = ?",
        remoteId,
        replaced ? JSON.stringify(replaced) : null,
        now(d),
        row.outbox_id,
      );
      // The values both sides now hold become the base.
      if (row.op === "remove")
        d.tx.run("DELETE FROM sy_links WHERE sync_type = ? AND local_id = ?", b.syncTypeId, row.local_id);
      else {
        const link = loadLinks(d.tx, b.syncTypeId).find((l) => l.localId === row.local_id);
        const base = { ...(link?.base ?? {}) };
        const local = await d.local.get(b.type, row.local_id);
        for (const k of Object.keys(values)) {
          const lf = fieldsByLocal.get(k);
          if (lf) base[lf] = local?.data[lf] ?? values[k] ?? null;
        }
        saveLink(d.tx, b.syncTypeId, { localId: row.local_id, remoteId: remoteId!, base, removedAt: null });
      }
      if (row.op === "update")
        for (const k of Object.keys(values)) {
          const lf = fieldsByLocal.get(k);
          if (lf) keepLoser(d, b.type, row.local_id, lf, values[k], `push:${row.by_actor ?? ""}`, "pushed");
        }
      d.emit?.("sync.pushed", `record/${row.local_id}`, {
        syncTypeId: b.syncTypeId,
        recordId: row.local_id,
        outboxId: row.outbox_id,
      });
    } catch (e) {
      const attempts = row.attempts + 1;
      const dead = attempts >= max;
      d.tx.run(
        "UPDATE sy_outbox SET attempts = ?, error = ?, status = ? WHERE outbox_id = ?",
        attempts,
        msgOf(e),
        dead ? "failed" : "pending",
        row.outbox_id,
      );
      if (dead) {
        failedNow++;
        d.emit?.("sync.push_failed", `record/${row.local_id}`, {
          syncTypeId: b.syncTypeId,
          type: b.type,
          recordId: row.local_id,
          outboxId: row.outbox_id,
          error: msgOf(e),
          attempts,
        });
        log(d, b.syncTypeId, "error", `push of ${row.local_id} failed: ${msgOf(e)}`, row.outbox_id);
      }
    }
  }
  return failedNow;
}

/** Push a failed outbox row again (a person pressed Retry). */
export function retryPush(d: SyncDeps, outboxId: string): boolean {
  return (
    d.tx.run(
      "UPDATE sy_outbox SET status = 'pending', attempts = 0, error = NULL WHERE outbox_id = ? AND status = 'failed'",
      outboxId,
    ).changes > 0
  );
}

/** Reverse a push with the value it replaced. Refused when the remote record changed since, so nothing newer is overwritten. */
export async function undoPush(
  d: SyncDeps,
  b: SyncBinding,
  outboxId: string,
): Promise<{ undone: boolean; reason?: string }> {
  ensureTables(d.tx);
  const row = d.tx.get<OutboxDb>(
    "SELECT * FROM sy_outbox WHERE outbox_id = ? AND sync_type = ?",
    outboxId,
    b.syncTypeId,
  );
  if (!row) return { undone: false, reason: "no such push" };
  if (row.status !== "done" || row.undone_at !== null)
    return { undone: false, reason: row.undone_at !== null ? "already undone" : "the push did not happen" };
  const values = JSON.parse(row.values_json) as Record<string, unknown>;
  const replaced = row.replaced ? (JSON.parse(row.replaced) as Record<string, unknown>) : null;
  const remoteId = row.remote_id!;
  const cur = await d.remote.get(b.remote, remoteId, { include_deleted: true });
  if (row.op === "update") {
    if (!cur || !replaced) return { undone: false, reason: "the remote record is gone" };
    if (!Object.keys(values).every((k) => same(cur.data[k], values[k])))
      return { undone: false, reason: "the remote record changed since the push" };
    await d.remote.update(b.remote, remoteId, replaced, cur.version);
  } else if (row.op === "create") {
    if (cur && cur.deleted_at === undefined) await d.remote.remove(b.remote, remoteId, cur.version);
    d.tx.run("DELETE FROM sy_links WHERE sync_type = ? AND local_id = ?", b.syncTypeId, row.local_id);
  } else {
    if (!cur) return { undone: false, reason: "the remote record cannot be restored" };
    await d.remote.restore(b.remote, remoteId);
    const link = loadLinks(d.tx, b.syncTypeId).find((l) => l.remoteId === remoteId);
    if (!link) {
      const local = await d.local.get(b.type, row.local_id, { include_deleted: true });
      const base: Record<string, unknown> = {};
      for (const f of b.fields.filter((x) => x.direction !== "off")) base[f.local] = local?.data[f.local] ?? null;
      saveLink(d.tx, b.syncTypeId, { localId: row.local_id, remoteId, base, removedAt: null });
    }
  }
  d.tx.run("UPDATE sy_outbox SET status = 'undone', undone_at = ? WHERE outbox_id = ?", now(d), outboxId);
  d.emit?.("sync.push_undone", `record/${row.local_id}`, {
    syncTypeId: b.syncTypeId,
    recordId: row.local_id,
    outboxId,
  });
  return { undone: true };
}

/** Records that vanished at the source (soft-marked), by local id. */
export function removedAtSource(d: SyncDeps, b: SyncBinding): string[] {
  ensureTables(d.tx);
  return d.tx
    .all<{
      local_id: string;
    }>("SELECT local_id FROM sy_links WHERE sync_type = ? AND removed_at IS NOT NULL AND removed_at > 0", b.syncTypeId)
    .map((r) => r.local_id);
}

/** What a person decided about records that vanished in a pass the guard paused. */
export function confirmDeletes(d: SyncDeps, b: SyncBinding, decision: "mark_removed" | "keep"): number {
  ensureTables(d.tx);
  const st = d.tx.get<{ pending_deletes: string | null }>(
    "SELECT pending_deletes FROM sy_state WHERE sync_type = ?",
    b.syncTypeId,
  );
  const ids = st?.pending_deletes ? (JSON.parse(st.pending_deletes) as string[]) : [];
  for (const id of ids)
    d.tx.run(
      "UPDATE sy_links SET removed_at = ? WHERE sync_type = ? AND local_id = ?",
      decision === "mark_removed" ? now(d) : 0,
      b.syncTypeId,
      id,
    );
  d.tx.run("UPDATE sy_state SET pending_deletes = NULL WHERE sync_type = ?", b.syncTypeId);
  return decision === "mark_removed" ? ids.length : 0;
}

/** Settle an asked conflict: keep ours (and push it), take theirs, or enter a value (and push it). */
export async function resolveConflict(
  d: SyncDeps,
  b: SyncBinding,
  conflictId: string,
  resolution: "ours" | "theirs" | "value",
  value?: unknown,
): Promise<{ recordId: string }> {
  ensureTables(d.tx);
  const c = d.tx.get<ConflictDb>(
    "SELECT * FROM sy_conflicts WHERE conflict_id = ? AND sync_type = ? AND status = 'open'",
    conflictId,
    b.syncTypeId,
  );
  if (!c) throw new Error("no open conflict with that id");
  const f = b.fields.find((x) => x.local === c.field);
  const link = loadLinks(d.tx, b.syncTypeId).find((l) => l.localId === c.local_id);
  if (!f || !link) throw new Error("the conflict no longer matches a mapped field");
  const local = await d.local.get(b.type, c.local_id);
  if (!local) throw new Error("the record is gone");
  let final: unknown;
  if (resolution === "theirs") final = JSON.parse(c.theirs ?? "null");
  else if (resolution === "ours") final = JSON.parse(c.ours ?? "null");
  else final = value ?? null;
  if (!same(local.data[c.field], final)) await d.local.update(b.type, c.local_id, { [c.field]: final }, local.version);
  if (resolution === "theirs") {
    saveLink(d.tx, b.syncTypeId, { ...link, base: { ...link.base, [c.field]: final } });
  } else {
    // The base stays where it was, so the next pass sees "only ours moved" and pushes; queue it now so the person need not wait for it.
    const idem = `update:${link.remoteId}:${canonical({ [f.remote]: final })}`;
    d.tx.run(
      "INSERT OR IGNORE INTO sy_outbox (outbox_id, sync_type, local_id, remote_id, op, fields, values_json, idem_key, created_at) VALUES (?, ?, ?, ?, 'update', ?, ?, ?, ?)",
      mintShort("obx", now(d)),
      b.syncTypeId,
      c.local_id,
      link.remoteId,
      JSON.stringify([f.local]),
      JSON.stringify({ [f.remote]: final }),
      `${idem}@${conflictId}`,
      now(d),
    );
    await flushOutbox(d, b);
  }
  d.tx.run("UPDATE sy_conflicts SET status = 'resolved' WHERE conflict_id = ?", conflictId);
  return { recordId: c.local_id };
}
