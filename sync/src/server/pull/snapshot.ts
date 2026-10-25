// Snapshots (ARCH 5.8): initial sync and resync. begin names the entities and the seq the snapshot is as of; pages are cut from `sync_rows` (no event replay) with the same visibility rules as pull,
// 5000 rows at most, ordered by id so `after` resumes. Small entities come first and window-limited heavy ones last, so the app is usable early.
// DECISION: pages are not read through a pinned WAL snapshot. A page skips every row whose seq is above asOf, and the pull that follows from cursor = asOf delivers those rows (a device that does not
// hold a row gets a full upsert), so a page read later than begin still lands on a consistent state, with no reader held open for 10 minutes.
// Every row a page sends is marked as held by the device in one bulk insert, so later hides and deletes reach it.
import { gzipSync, gunzipSync } from "node:zlib";
import { MAX_SNAPSHOT_PAGE } from "../../protocol.ts";
import type { DeviceClass } from "../../protocol.ts";
import type { Cell, Cells } from "./fold.ts";
import { pullError } from "./errors.ts";
import { deviceRevoked, headSeq } from "./pull.ts";
import type { PullDeps } from "./pull.ts";
import { Viewer, Window } from "./scope.ts";
import type { RowRec, Who } from "./scope.ts";

/** A snapshot lives 10 minutes (5.8). */
export const SNAPSHOT_TTL_MS = 10 * 60_000;
const SEEN_CHUNK = 400;
const SCAN_BATCH = 1000;

export interface SnapshotBeginRes { asOfSeq: number; plan: { entity: string; estimatedRows: number }[]; expiresAt: number }
export interface SnapshotRow {
  id: string;
  /** Highest seq of any field, so the client can keep the freshest. */
  seq: number;
  label: number;
  fields: Record<string, Cell>;
}
export interface SnapshotPage { rows: SnapshotRow[]; last?: string; done: boolean }

/** A revoked device takes no snapshot: it would be handed the Space again. */
const refuseRevoked = (d: PullDeps, who: Who, traceId: string): void => {
  if (deviceRevoked(d.db, who.person, who.device)) throw pullError("auth.device_revoked", "This device was revoked. Its copy is removed.", traceId);
};

export function snapshotBegin(d: PullDeps, who: Who, req: { entities?: string[]; deviceClass: DeviceClass }, traceId = "0".repeat(32)): SnapshotBeginRes {
  refuseRevoked(d, who, traceId);
  const db = d.db;
  const cls = req.deviceClass;
  const now = d.now();
  const keys = new Set<string>(d.catalog.known().map((e) => e.key));
  for (const r of db.all<{ entity: string }>("SELECT DISTINCT entity FROM sync_rows")) keys.add(r.entity);
  const wanted = req.entities ? new Set(req.entities) : null;
  const plan: { entity: string; estimatedRows: number; window: boolean }[] = [];
  for (const key of keys) {
    if (wanted && !wanted.has(key)) continue;
    const cfg = d.catalog.get(key);
    const mode = cfg.profile[cls];
    if (mode === "none") continue;
    const n = db.get<{ n: number }>("SELECT count(*) AS n FROM sync_rows WHERE entity = ? AND deleted = 0", key)?.n ?? 0;
    if (n > 0) plan.push({ entity: key, estimatedRows: n, window: mode === "window" });
  }
  plan.sort((a, b) => Number(a.window) - Number(b.window) || a.estimatedRows - b.estimatedRows || (a.entity < b.entity ? -1 : 1));
  const asOfSeq = headSeq(db);
  const expiresAt = now + SNAPSHOT_TTL_MS;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.run("DELETE FROM sync_snapshots WHERE expires < ?", now);
    // The device is starting over: it holds nothing the server should assume.
    if (wanted) for (const e of wanted) db.run("DELETE FROM sync_seen_rows WHERE person = ? AND device = ? AND entity = ?", who.person, who.device, e);
    else db.run("DELETE FROM sync_seen_rows WHERE person = ? AND device = ?", who.person, who.device);
    db.run("INSERT INTO sync_snapshots (person, device, as_of, expires) VALUES (?, ?, ?, ?) ON CONFLICT(person, device, as_of) DO UPDATE SET expires = excluded.expires", who.person, who.device, asOfSeq, expiresAt);
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* keep the first failure */ }
    throw e;
  }
  return { asOfSeq, plan: plan.map(({ entity, estimatedRows }) => ({ entity, estimatedRows })), expiresAt };
}

function markSeen(d: PullDeps, who: Who, entity: string, ids: readonly string[], asOf: number): void {
  for (let i = 0; i < ids.length; i += SEEN_CHUNK) {
    const part = ids.slice(i, i + SEEN_CHUNK);
    const args: (string | number)[] = [];
    for (const id of part) args.push(who.person, who.device, entity, id, 1, 0, asOf);
    d.db.run(
      `INSERT INTO sync_seen_rows (person, device, entity, id, vis, prev_vis, at_seq) VALUES ${part.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ")}
       ON CONFLICT(person, device, entity, id) DO UPDATE SET vis = 1, prev_vis = 0, at_seq = excluded.at_seq`, ...args);
  }
}

export function snapshotPage(d: PullDeps, who: Who, req: { entity: string; after?: string; asOf: number }, traceId: string): SnapshotPage {
  refuseRevoked(d, who, traceId);
  const db = d.db;
  const now = d.now();
  const session = db.get<{ expires: number }>("SELECT expires FROM sync_snapshots WHERE person = ? AND device = ? AND as_of = ?", who.person, who.device, req.asOf);
  if (!session) throw pullError("validation.not_found", "That sync was not started or has been replaced. Start it again.", traceId);
  if (session.expires < now) throw pullError("timeout.deadline", "That sync took too long. Start it again.", traceId);
  const cfg = d.catalog.get(req.entity);
  const mode = cfg.profile[who.deviceClass];
  if (mode === "none") return { rows: [], done: true };
  const viewer = new Viewer({ cache: d.cache, who, now, phoneCeiling: d.phoneCeiling() });
  const sc = viewer.scope(cfg);
  const window = new Window(db, now, (entity, id) => d.keep(who.person, entity, id));
  const rows: SnapshotRow[] = [];
  let after = req.after ?? "";
  let last: string | undefined = req.after;
  let done = false;
  let scanned = 0;
  for (;;) {
    const batch = db.all<RowRec>(
      "SELECT entity, id, owner_id, label, deleted, enc, vis, seq, updated_at, fields FROM sync_rows WHERE entity = ? AND id > ? AND deleted = 0 AND seq <= ? ORDER BY id LIMIT ?",
      req.entity, after, req.asOf, SCAN_BATCH);
    let full = false;
    for (const row of batch) {
      scanned++;
      last = row.id;
      const cells = JSON.parse(row.fields) as Cells;
      if (!viewer.visible(sc, row, cells) || !window.holds(cfg, mode, row)) continue;
      rows.push({ id: row.id, seq: row.seq, label: row.label, fields: viewer.fields(sc, cells) });
      if (rows.length >= MAX_SNAPSHOT_PAGE) { full = true; break; }
    }
    if (full) break;
    if (batch.length < SCAN_BATCH) { done = true; break; }
    after = batch[batch.length - 1]!.id;
    // A page of mostly hidden rows ends short rather than scanning the whole table in one call.
    if (scanned >= MAX_SNAPSHOT_PAGE * 4) break;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    markSeen(d, who, req.entity, rows.map((r) => r.id), req.asOf);
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* keep the first failure */ }
    throw e;
  }
  return { rows, ...(last !== undefined ? { last } : {}), done };
}

// ---- wire form: NDJSON, gzip ----

/** One JSON object per line, rows first and a final `{"$page":{last,done}}` line, gzip level 1 (speed over size: the link is the bottleneck only on a phone, and the rows are already compact). */
export function encodePage(page: SnapshotPage): Buffer {
  const lines = page.rows.map((r) => JSON.stringify(r));
  lines.push(JSON.stringify({ $page: { ...(page.last !== undefined ? { last: page.last } : {}), done: page.done } }));
  return gzipSync(Buffer.from(lines.join("\n") + "\n", "utf8"), { level: 1 });
}

export function decodePage(bytes: Uint8Array): SnapshotPage {
  const text = gunzipSync(bytes).toString("utf8");
  const rows: SnapshotRow[] = [];
  let last: string | undefined;
  let done = false;
  for (const line of text.split("\n")) {
    if (!line) continue;
    const o = JSON.parse(line) as SnapshotRow & { $page?: { last?: string; done: boolean } };
    if (o.$page) { last = o.$page.last; done = o.$page.done; } else rows.push(o);
  }
  return { rows, ...(last !== undefined ? { last } : {}), done };
}
