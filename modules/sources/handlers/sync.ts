// The sync engine (spec 2.10, ARCH 4.3.1 item 2 and 8): one engine over any two Stores, the Space's RecordStore on one side and a connector's SyncedTypeDef target on the other.
// It is the executor of the Run kind `connector_sync`: a pass pulls, pushes and reports; a dry run does the same work and writes nothing.
//
// Three-way compare per mapped field against the base (the values both sides agreed on at the last sync):
//   only theirs moved -> pull (direction pull or both)   only ours moved -> push (push or both)   both moved to different values -> the conflict rule.
// Pushes go through an outbox with an idempotency key, retries (3 passes, then sync.push_failed) and the replaced remote value, so a push can be undone.
// First sync matches an unlinked remote record to a local one by the match rule; a missing remote record is marked "removed at source", and a pass that would mark more than
// 10 percent or 50 records pauses and waits for confirmDeletes. Local writes go to the RecordStore directly and are announced with quiet: true unless runAutomations is set.
import { evalExpr, parseExpr } from "../../../lib/expr/expr.ts";
import { canonical } from "../../../lib/canonical.ts";
import { mintRecordId } from "../../../lib/ids.ts";
import type { Tx } from "../../../kernel/src/store/projection.ts";
import type { Store, StoredRecord } from "../../../kernel/src/store/types.ts";
import { ensureTables, mintShort, same } from "../projections.ts";

export type Direction = "pull" | "push" | "both" | "off";
export type ConflictRule = "newest" | "source" | "vyre" | "ask";
export interface SyncFieldMap { local: string; remote: string; direction: Direction; /** Small expression over `value`, applied to what is pulled. */ transform?: string }
export interface SyncBinding {
  syncTypeId: string; type: string; remote: string; connector: string; label?: string;
  fields: SyncFieldMap[]; match: string[]; createAtSource: boolean; deletes: boolean; conflict: ConflictRule;
  guard?: { percent: number; count: number };
}
export interface SyncDeps {
  local: Store; remote: Store; tx: Tx; now?: () => number;
  emit?: (name: string, subject: string, payload: Record<string, unknown>) => unknown;
  maxAttempts?: number;
}
export interface SyncOptions { mode?: "pull" | "push" | "both"; dryRun?: boolean; runAutomations?: boolean; traceId?: string }
export interface SyncReport {
  runId: string; dryRun: boolean;
  local: { created: number; updated: number }; remote: { created: number; updated: number; removed: number };
  matched: number; ambiguous: number; conflicts: number; askedConflicts: number; removedAtSource: number; pausedDeletes: boolean; queued: number; failed: number;
  summary: string;
}

const GUARD = { percent: 10, count: 50 };
const OUTBOX_KEEP_MS = 30 * 86_400_000;

interface LinkDb { sync_type: string; local_id: string; remote_id: string; base: string; removed_at: number | null }
interface Link { localId: string; remoteId: string; base: Record<string, unknown>; removedAt: number | null; fresh?: boolean }
interface OutboxDb {
  outbox_id: string; sync_type: string; local_id: string; remote_id: string | null; op: "create" | "update" | "remove"; fields: string; values_json: string; replaced: string | null;
  idem_key: string; status: string; attempts: number; error: string | null; trace_id: string | null; created_at: number; done_at: number | null; undone_at: number | null;
}
interface ConflictDb { conflict_id: string; sync_type: string; local_id: string; field: string; ours: string | null; theirs: string | null; base: string | null; rule: string; status: string; created_at: number }

const now = (d: SyncDeps): number => (d.now ?? Date.now)();
const pullable = (f: SyncFieldMap): boolean => f.direction === "pull" || f.direction === "both";
const pushable = (f: SyncFieldMap): boolean => f.direction === "push" || f.direction === "both";
const present = (v: unknown): boolean => v !== null && v !== undefined && v !== "";
const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function listAll(store: Store, type: string): Promise<Map<string, StoredRecord>> {
  const out = new Map<string, StoredRecord>();
  let cursor: string | undefined;
  do {
    const p = await store.query(type, { page: { limit: 500, ...(cursor ? { cursor } : {}) } });
    for (const r of p.rows) out.set(r.id, r);
    cursor = p.next_cursor;
  } while (cursor);
  return out;
}

const theirsOf = (f: SyncFieldMap, rec: StoredRecord): unknown => {
  const v = rec.data[f.remote];
  if (!present(v) || !f.transform) return v ?? null;
  const out = evalExpr(parseExpr(f.transform), { values: { value: v } });
  return out ?? null;
};

const loadLinks = (tx: Tx, syncTypeId: string): Link[] =>
  tx.all<LinkDb>("SELECT * FROM sy_links WHERE sync_type = ? ORDER BY rowid", syncTypeId).map((r) => ({ localId: r.local_id, remoteId: r.remote_id, base: JSON.parse(r.base) as Record<string, unknown>, removedAt: r.removed_at }));

const saveLink = (tx: Tx, syncTypeId: string, l: Link): void => {
  tx.run(
    "INSERT INTO sy_links (sync_type, local_id, remote_id, base, removed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sync_type, local_id) DO UPDATE SET remote_id = excluded.remote_id, base = excluded.base, removed_at = excluded.removed_at",
    syncTypeId, l.localId, l.remoteId, JSON.stringify(l.base), l.removedAt,
  );
};

function log(d: SyncDeps, syncTypeId: string, kind: string, summary: string, runId: string, traceId?: string): void {
  d.tx.run("INSERT INTO sy_log (sync_type, at, kind, summary, run_id, trace_id) VALUES (?, ?, ?, ?, ?, ?)", syncTypeId, now(d), kind, summary, runId, traceId ?? null);
}

interface LocalAction { link: Link; localId: string; patch: Record<string, unknown>; version: number; prev: Record<string, unknown> }
interface RemoteAction { link: Link; patch: Record<string, unknown>; fields: string[] }

export async function runSync(d: SyncDeps, b: SyncBinding, o: SyncOptions = {}): Promise<SyncReport> {
  ensureTables(d.tx);
  const mode = o.mode ?? "both";
  const pullOn = mode !== "push";
  const pushOn = mode !== "pull";
  const dry = o.dryRun === true;
  const runId = mintShort("run", now(d));
  const quiet = o.runAutomations !== true;
  const fields = b.fields.filter((f) => f.direction !== "off");
  const guard = b.guard ?? GUARD;
  const label = b.label ?? b.connector;
  const emit = (name: string, subject: string, payload: Record<string, unknown>): void => { if (!dry) d.emit?.(name, subject, payload); };

  const [localMap, remoteMap] = await Promise.all([listAll(d.local, b.type), listAll(d.remote, b.remote)]);
  const links = loadLinks(d.tx, b.syncTypeId);
  const byLocal = new Map(links.map((l) => [l.localId, l]));
  const byRemote = new Map(links.map((l) => [l.remoteId, l]));

  const rep: SyncReport = {
    runId, dryRun: dry, local: { created: 0, updated: 0 }, remote: { created: 0, updated: 0, removed: 0 }, matched: 0, ambiguous: 0, conflicts: 0, askedConflicts: 0,
    removedAtSource: 0, pausedDeletes: false, queued: 0, failed: 0, summary: "",
  };
  const localActions: LocalAction[] = [];
  const remoteActions: RemoteAction[] = [];
  const removals: Link[] = [];
  const creates: { remote: StoredRecord; data: Record<string, unknown>; base: Record<string, unknown> }[] = [];
  const remoteCreates: { local: StoredRecord; data: Record<string, unknown> }[] = [];
  const vanished: Link[] = [];

  const mappedTheirs = (rec: StoredRecord, only?: (f: SyncFieldMap) => boolean): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const f of fields) if (!only || only(f)) out[f.local] = theirsOf(f, rec);
    return out;
  };

  // ---- pairs: linked records first, then first-sync matches ----
  const pairs: { link: Link; local: StoredRecord; remote: StoredRecord }[] = [];
  for (const l of links) {
    const remote = remoteMap.get(l.remoteId);
    const local = localMap.get(l.localId);
    if (!remote) { if (l.removedAt === null) vanished.push(l); continue; }
    if (l.removedAt !== null) { l.removedAt = null; if (!dry) saveLink(d.tx, b.syncTypeId, l); }
    if (!local) { if (b.deletes && pushOn) removals.push(l); continue; }
    pairs.push({ link: l, local, remote });
  }

  const unlinkedLocal = [...localMap.values()].filter((r) => !byLocal.has(r.id));
  const index = new Map<string, StoredRecord[]>();
  if (b.match.length) {
    for (const r of unlinkedLocal) {
      if (!b.match.every((m) => present(r.data[m]))) continue;
      const k = canonical(b.match.map((m) => r.data[m]));
      index.set(k, [...(index.get(k) ?? []), r]);
    }
  }
  const taken = new Set<string>();
  for (const remote of remoteMap.values()) {
    if (byRemote.has(remote.id)) continue;
    const theirs = mappedTheirs(remote);
    const key = b.match.length && b.match.every((m) => present(theirs[m])) ? canonical(b.match.map((m) => theirs[m])) : undefined;
    const cands = key !== undefined ? (index.get(key) ?? []).filter((c) => !taken.has(c.id)) : [];
    if (cands.length > 1) { rep.ambiguous++; continue; }
    if (cands.length === 1) {
      const local = cands[0]!;
      taken.add(local.id);
      rep.matched++;
      // The base for a first link: what the remote holds, except where we hold nothing, so an empty local value is filled from the remote rather than emptying it.
      const base: Record<string, unknown> = {};
      for (const f of fields) base[f.local] = present(local.data[f.local]) ? theirs[f.local] : (local.data[f.local] ?? null);
      pairs.push({ link: { localId: local.id, remoteId: remote.id, base, removedAt: null, fresh: true }, local, remote });
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
  for (const { link, local, remote } of pairs) {
    const pullPatch: Record<string, unknown> = {};
    const pushPatch: Record<string, unknown> = {};
    const pushFields: string[] = [];
    const nextBase: Record<string, unknown> = { ...link.base };
    for (const f of fields) {
      const base = link.base[f.local];
      const ours = local.data[f.local];
      const theirs = theirsOf(f, remote);
      const oursMoved = !same(ours, base);
      const theirsMoved = !same(theirs, base);
      if (!oursMoved && !theirsMoved) continue;
      if (oursMoved && theirsMoved && same(ours, theirs)) { nextBase[f.local] = theirs; continue; }
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
        else { rep.askedConflicts++; conflictRows.push({ localId: local.id, field: f.local, ours, theirs, base }); }
      }
      if (take === "theirs" && pullOn) { pullPatch[f.local] = theirs; nextBase[f.local] = theirs; }
      else if (take === "ours" && pushOn) { pushPatch[f.remote] = ours ?? null; pushFields.push(f.local); }
    }
    const baseMoved = !same(nextBase, link.base);
    if (Object.keys(pullPatch).length) {
      const prev: Record<string, unknown> = {};
      for (const k of Object.keys(pullPatch)) if (Object.prototype.hasOwnProperty.call(local.data, k)) prev[k] = local.data[k];
      localActions.push({ link: { ...link, base: nextBase }, localId: local.id, patch: pullPatch, version: local.version, prev });
      rep.local.updated++;
    } else if (baseMoved || link.fresh) {
      localActions.push({ link: { ...link, base: nextBase }, localId: local.id, patch: {}, version: local.version, prev: {} });
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
  const live = links.filter((l) => l.removedAt === null).length;
  const percent = live ? (vanished.length / live) * 100 : 0;
  if (vanished.length && (vanished.length > guard.count || percent > guard.percent)) {
    rep.pausedDeletes = true;
    if (!dry) {
      d.tx.run("INSERT INTO sy_state (sync_type, pending_deletes) VALUES (?, ?) ON CONFLICT(sync_type) DO UPDATE SET pending_deletes = excluded.pending_deletes", b.syncTypeId, JSON.stringify(vanished.map((l) => l.localId)));
      emit("sync.deletes_paused", `entity/${b.syncTypeId}`, { syncTypeId: b.syncTypeId, type: b.type, count: vanished.length, percent: Math.round(percent * 10) / 10 });
    }
  } else rep.removedAtSource = vanished.length;

  // ---- the open conflicts ask a person ----
  if (!dry) {
    for (const c of conflictRows) {
      const id = mintShort("cfl", now(d));
      const r = d.tx.run("INSERT OR IGNORE INTO sy_conflicts (conflict_id, sync_type, local_id, field, ours, theirs, base, rule, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ask', ?)",
        id, b.syncTypeId, c.localId, c.field, JSON.stringify(c.ours ?? null), JSON.stringify(c.theirs ?? null), JSON.stringify(c.base ?? null), now(d));
      if (r.changes) emit("sync.conflict", `record/${c.localId}`, { conflictId: id, syncTypeId: b.syncTypeId, type: b.type, recordId: c.localId, field: c.field, rule: "ask" });
    }
  }

  rep.summary = summarise(rep, label);
  if (dry) return rep;

  // ---- apply: local side ----
  const announce = (name: "record.created" | "record.updated", id: string, payload: Record<string, unknown>): void => {
    d.emit?.(name, `record/${id}`, { recordId: id, type: b.type, ...payload, ...(quiet ? { quiet: true } : {}) });
  };
  for (const c of creates) {
    const id = mintRecordId(now(d));
    const rec = await d.local.create(b.type, id, c.data);
    saveLink(d.tx, b.syncTypeId, { localId: id, remoteId: c.remote.id, base: c.base, removedAt: null });
    announce("record.created", id, { fields: { ...rec.data } });
  }
  for (const a of localActions) {
    if (Object.keys(a.patch).length) {
      const rec = await d.local.update(b.type, a.localId, a.patch, a.version);
      const keys = Object.keys(a.patch);
      const changed: Record<string, unknown> = {};
      for (const k of keys) changed[k] = Object.prototype.hasOwnProperty.call(rec.data, k) ? rec.data[k] : null;
      announce("record.updated", a.localId, { fields: changed, prev: a.prev, version: rec.version });
    }
    saveLink(d.tx, b.syncTypeId, a.link);
  }
  for (const l of vanished) if (!rep.pausedDeletes) saveLink(d.tx, b.syncTypeId, { ...l, removedAt: now(d) });

  // ---- apply: queue pushes, then flush the outbox ----
  const queue = (localId: string, remoteId: string | null, op: "create" | "update" | "remove", fieldList: string[], values: Record<string, unknown>): void => {
    const idem = `${op}:${remoteId ?? localId}:${canonical(values)}`;
    const open = d.tx.get<OutboxDb>("SELECT * FROM sy_outbox WHERE sync_type = ? AND idem_key = ? AND status IN ('pending', 'failed')", b.syncTypeId, idem);
    if (open) return;
    const nth = d.tx.get<{ n: number }>("SELECT count(*) AS n FROM sy_outbox WHERE sync_type = ? AND (idem_key = ? OR idem_key LIKE ?)", b.syncTypeId, idem, `${idem}#%`)?.n ?? 0;
    d.tx.run(
      "INSERT INTO sy_outbox (outbox_id, sync_type, local_id, remote_id, op, fields, values_json, idem_key, trace_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      mintShort("obx", now(d)), b.syncTypeId, localId, remoteId, op, JSON.stringify(fieldList), JSON.stringify(values), nth ? `${idem}#${nth}` : idem, o.traceId ?? null, now(d),
    );
    rep.queued++;
  };
  for (const a of remoteActions) queue(a.link.localId, a.link.remoteId, "update", a.fields, a.patch);
  for (const c of remoteCreates) queue(c.local.id, null, "create", Object.keys(c.data), c.data);
  for (const l of removals) queue(l.localId, l.remoteId, "remove", [], {});
  rep.failed = await flushOutbox(d, b);

  d.tx.run("INSERT INTO sy_state (sync_type, last_run_at) VALUES (?, ?) ON CONFLICT(sync_type) DO UPDATE SET last_run_at = excluded.last_run_at", b.syncTypeId, now(d));
  d.tx.run("DELETE FROM sy_outbox WHERE sync_type = ? AND status IN ('done', 'undone') AND created_at < ?", b.syncTypeId, now(d) - OUTBOX_KEEP_MS);
  log(d, b.syncTypeId, "pull", `${rep.local.created} created, ${rep.local.updated} updated here`, runId, o.traceId);
  log(d, b.syncTypeId, "push", `${rep.remote.created} created, ${rep.remote.updated} updated, ${rep.remote.removed} removed in ${label}`, runId, o.traceId);
  for (const c of conflictRows) log(d, b.syncTypeId, "conflict", `${c.field} changed on both sides`, runId, o.traceId);
  d.emit?.("sync.completed", `entity/${b.syncTypeId}`, {
    runId, syncTypeId: b.syncTypeId, type: b.type, connector: b.connector, mode,
    pulled: rep.local.created + rep.local.updated, pushed: rep.remote.created + rep.remote.updated + rep.remote.removed,
    created: rep.local.created + rep.remote.created, updated: rep.local.updated + rep.remote.updated, removed: rep.removedAtSource,
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
  if (r.askedConflicts) parts.push(`ask about ${r.askedConflicts} ${r.askedConflicts === 1 ? "conflict" : "conflicts"}`);
  if (r.removedAtSource) parts.push(`mark ${n(r.removedAtSource, "removed at source")}`);
  if (r.pausedDeletes) parts.push("wait for you to confirm records that vanished");
  return parts.length ? `Will ${parts.join(", ")}.` : "Nothing to change.";
}

/** Work through the outbox. Returns how many pushes ended failed for good in this pass. */
export async function flushOutbox(d: SyncDeps, b: SyncBinding): Promise<number> {
  const max = d.maxAttempts ?? 3;
  const fieldsByLocal = new Map(b.fields.map((f) => [f.remote, f.local]));
  let failedNow = 0;
  const rows = d.tx.all<OutboxDb>("SELECT * FROM sy_outbox WHERE sync_type = ? AND status = 'pending' ORDER BY created_at, rowid", b.syncTypeId);
  for (const row of rows) {
    const values = JSON.parse(row.values_json) as Record<string, unknown>;
    try {
      let remoteId = row.remote_id;
      let replaced: Record<string, unknown> | null = null;
      if (row.op === "update") {
        const cur = await d.remote.get(b.remote, remoteId!);
        if (!cur) throw new Error(`the ${b.label ?? b.connector} record ${remoteId} is gone`);
        replaced = {};
        for (const k of Object.keys(values)) replaced[k] = cur.data[k] ?? null;
        const already = Object.keys(values).every((k) => same(cur.data[k], values[k]));
        if (!already) await d.remote.update(b.remote, remoteId!, values, cur.version);
      } else if (row.op === "create") {
        const made = await d.remote.create(b.remote, mintRecordId(now(d)), values);
        remoteId = made.id;
      } else {
        const cur = await d.remote.get(b.remote, remoteId!);
        if (cur) { replaced = { ...cur.data }; await d.remote.remove(b.remote, remoteId!, cur.version); }
      }
      d.tx.run("UPDATE sy_outbox SET status = 'done', remote_id = ?, replaced = ?, error = NULL, done_at = ? WHERE outbox_id = ?", remoteId, replaced ? JSON.stringify(replaced) : null, now(d), row.outbox_id);
      // The values both sides now hold become the base.
      if (row.op === "remove") d.tx.run("DELETE FROM sy_links WHERE sync_type = ? AND local_id = ?", b.syncTypeId, row.local_id);
      else {
        const link = loadLinks(d.tx, b.syncTypeId).find((l) => l.localId === row.local_id);
        const base = { ...(link?.base ?? {}) };
        const local = await d.local.get(b.type, row.local_id);
        for (const k of Object.keys(values)) { const lf = fieldsByLocal.get(k); if (lf) base[lf] = local?.data[lf] ?? values[k] ?? null; }
        saveLink(d.tx, b.syncTypeId, { localId: row.local_id, remoteId: remoteId!, base, removedAt: null });
      }
      d.emit?.("sync.pushed", `record/${row.local_id}`, { syncTypeId: b.syncTypeId, recordId: row.local_id, outboxId: row.outbox_id });
    } catch (e) {
      const attempts = row.attempts + 1;
      const dead = attempts >= max;
      d.tx.run("UPDATE sy_outbox SET attempts = ?, error = ?, status = ? WHERE outbox_id = ?", attempts, msgOf(e), dead ? "failed" : "pending", row.outbox_id);
      if (dead) {
        failedNow++;
        d.emit?.("sync.push_failed", `record/${row.local_id}`, { syncTypeId: b.syncTypeId, type: b.type, recordId: row.local_id, outboxId: row.outbox_id, error: msgOf(e), attempts });
        log(d, b.syncTypeId, "error", `push of ${row.local_id} failed: ${msgOf(e)}`, row.outbox_id);
      }
    }
  }
  return failedNow;
}

/** Push a failed outbox row again (a person pressed Retry). */
export function retryPush(d: SyncDeps, outboxId: string): boolean {
  return d.tx.run("UPDATE sy_outbox SET status = 'pending', attempts = 0, error = NULL WHERE outbox_id = ? AND status = 'failed'", outboxId).changes > 0;
}

/** Reverse a push with the value it replaced. Refused when the remote record changed since, so nothing newer is overwritten. */
export async function undoPush(d: SyncDeps, b: SyncBinding, outboxId: string): Promise<{ undone: boolean; reason?: string }> {
  ensureTables(d.tx);
  const row = d.tx.get<OutboxDb>("SELECT * FROM sy_outbox WHERE outbox_id = ? AND sync_type = ?", outboxId, b.syncTypeId);
  if (!row) return { undone: false, reason: "no such push" };
  if (row.status !== "done" || row.undone_at !== null) return { undone: false, reason: row.undone_at !== null ? "already undone" : "the push did not happen" };
  const values = JSON.parse(row.values_json) as Record<string, unknown>;
  const replaced = row.replaced ? (JSON.parse(row.replaced) as Record<string, unknown>) : null;
  const remoteId = row.remote_id!;
  const cur = await d.remote.get(b.remote, remoteId, { include_deleted: true });
  if (row.op === "update") {
    if (!cur || !replaced) return { undone: false, reason: "the remote record is gone" };
    if (!Object.keys(values).every((k) => same(cur.data[k], values[k]))) return { undone: false, reason: "the remote record changed since the push" };
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
  d.emit?.("sync.push_undone", `record/${row.local_id}`, { syncTypeId: b.syncTypeId, recordId: row.local_id, outboxId });
  return { undone: true };
}

/** Records that vanished at the source (soft-marked), by local id. */
export function removedAtSource(d: SyncDeps, b: SyncBinding): string[] {
  ensureTables(d.tx);
  return d.tx.all<{ local_id: string }>("SELECT local_id FROM sy_links WHERE sync_type = ? AND removed_at IS NOT NULL AND removed_at > 0", b.syncTypeId).map((r) => r.local_id);
}

/** What a person decided about records that vanished in a pass the guard paused. */
export function confirmDeletes(d: SyncDeps, b: SyncBinding, decision: "mark_removed" | "keep"): number {
  ensureTables(d.tx);
  const st = d.tx.get<{ pending_deletes: string | null }>("SELECT pending_deletes FROM sy_state WHERE sync_type = ?", b.syncTypeId);
  const ids = st?.pending_deletes ? (JSON.parse(st.pending_deletes) as string[]) : [];
  for (const id of ids) d.tx.run("UPDATE sy_links SET removed_at = ? WHERE sync_type = ? AND local_id = ?", decision === "mark_removed" ? now(d) : 0, b.syncTypeId, id);
  d.tx.run("UPDATE sy_state SET pending_deletes = NULL WHERE sync_type = ?", b.syncTypeId);
  return decision === "mark_removed" ? ids.length : 0;
}

/** Settle an asked conflict: keep ours (and push it), take theirs, or enter a value (and push it). */
export async function resolveConflict(d: SyncDeps, b: SyncBinding, conflictId: string, resolution: "ours" | "theirs" | "value", value?: unknown): Promise<{ recordId: string }> {
  ensureTables(d.tx);
  const c = d.tx.get<ConflictDb>("SELECT * FROM sy_conflicts WHERE conflict_id = ? AND sync_type = ? AND status = 'open'", conflictId, b.syncTypeId);
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
    d.tx.run("INSERT OR IGNORE INTO sy_outbox (outbox_id, sync_type, local_id, remote_id, op, fields, values_json, idem_key, created_at) VALUES (?, ?, ?, ?, 'update', ?, ?, ?, ?)",
      mintShort("obx", now(d)), b.syncTypeId, c.local_id, link.remoteId, JSON.stringify([f.local]), JSON.stringify({ [f.remote]: final }), `${idem}@${conflictId}`, now(d));
    await flushOutbox(d, b);
  }
  d.tx.run("UPDATE sy_conflicts SET status = 'resolved' WHERE conflict_id = ?", conflictId);
  return { recordId: c.local_id };
}
