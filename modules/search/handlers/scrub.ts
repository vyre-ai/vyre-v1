// The one-time scrub of text of removed fields (rc.44). Before the index followed a field drop (handlers/index.ts, noteFieldChange), a Space that dropped a field kept the dropped text in search_docs and search_fts for
// good: a person whose access hides the field could still find the record by it. On the first start of the build that has this, every record type that had a destructive schema change is read again, a slice of work at
// a time, and each document whose text differs from the record as it is now is rebuilt (or removed when the record is gone or unreadable).
//
// While it runs the documents of those types are held back from every way search shows an item (the `scrubhide:<type>` rows, see scrubHidden), so the old text is never found at any point, and each type comes back
// when its last document has been read. The job is a row in search_meta (`scrub:removed_fields`) with a position for each type: a stop in the middle resumes where it was, and a finished job is never run again.
// The host runs it after the daemon serves (host/src/daemon/daemon.ts, startSearchScrub), a call for each slice with the loop given back between calls; the doctor reads the row (host/src/daemon/doctor.ts).
import { BODY_CAP, ensure, putDoc, removeDoc, rowsOf, str } from "../projections.ts";
import type { SearchCtx } from "../projections.ts";
import { indexApply, resolve } from "./index.ts";

export const SCRUB_KEY = "scrub:removed_fields";
const PAGE = 5;
// a slice of work is a stretch the loop is held for (the awaits inside it are not turns of the loop): a page of five documents and at most 5 ms more, so a call of the host stays near 10 ms
const SLICE_MS = 5;
const RETRIES = 5;
const RETRY_MS = 1_000;

/** What the job says of itself: the row the doctor reads. `before` is how many entries carried text the record no longer holds (found so far while it runs), `after` how many still do (0 when it is done). */
export interface ScrubState {
  state: "running" | "done";
  before: number;
  after: number;
  /** documents read again so far, and how many there are to read */
  scanned: number;
  total: number;
  /** record types still to read, in order */
  types: string[];
  /** record types still to check for records that have no index entry (their entries are put in), and how many were put in so far */
  missingTypes?: string[];
  added?: number;
  /** entries removed because their record could not be read again after several tries (the old text must not stay) */
  unreadable?: number;
  /** the document being tried again, how many times, and when it may be tried next */
  retry?: { key: string; n: number; at: number };
  startedAt: number;
  doneAt?: number;
}

export interface ScrubProgress extends ScrubState {
  done: boolean;
  /** a read failed and is tried again after a pause: the host waits before calling again */
  waiting?: boolean;
}

const read = (ctx: SearchCtx): ScrubState | null => {
  const r = rowsOf(ctx.db, "SELECT v FROM search_meta WHERE k = ?", SCRUB_KEY)[0];
  if (!r) return null;
  try {
    return JSON.parse(str(r["v"])) as ScrubState;
  } catch {
    return null;
  }
};
const write = (ctx: SearchCtx, s: ScrubState): void => {
  ctx.db.run(
    "INSERT INTO search_meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v",
    SCRUB_KEY,
    JSON.stringify(s),
  );
};

/** The record types that had a destructive schema change (a drop, a retype, a type removed), or null when the history cannot be read (then every type is read). */
async function changedTypes(ctx: SearchCtx): Promise<Set<string> | null> {
  const out = new Set<string>();
  try {
    let cursor: string | undefined;
    for (let guard = 0; guard < 200; guard++) {
      const r = (await ctx.call("schema.changes.list", { limit: 200, ...(cursor ? { cursor } : {}) })) as {
        changes?: Array<{ destructive?: unknown; types?: unknown }>;
        next?: unknown;
      };
      for (const c of r.changes ?? [])
        if (c.destructive === true && Array.isArray(c.types))
          for (const t of c.types) if (typeof t === "string") out.add(t);
      cursor = typeof r.next === "string" ? r.next : undefined;
      if (!cursor) return out;
    }
  } catch {
    /* the history is not readable: every type is read */
  }
  return null;
}

/** Every record type that has records (the Schema map's nodes), or the types the index already holds when the map cannot be read. */
async function typesWithRecords(ctx: SearchCtx, indexed: readonly string[]): Promise<string[]> {
  try {
    const r = (await ctx.call("schema.map", {})) as { nodes?: Array<{ type?: unknown; rowCount?: unknown }> };
    return (r.nodes ?? [])
      .filter((n) => typeof n.type === "string" && Number(n.rowCount ?? 1) > 0)
      .map((n) => n.type as string);
  } catch {
    return [...indexed];
  }
}

/** Start the job: which types, their documents held back at once (one transaction), the row written. */
async function begin(ctx: SearchCtx): Promise<ScrubState> {
  const present = rowsOf(
    ctx.db,
    "SELECT record_type AS t, count(*) AS c FROM search_docs WHERE record_type IS NOT NULL AND res_type = 'record' GROUP BY record_type ORDER BY record_type",
  );
  const changed = present.length > 0 ? await changedTypes(ctx) : new Set<string>();
  const picked = present.filter((r) => changed === null || changed.has(str(r["t"])));
  const missingTypes = await typesWithRecords(
    ctx,
    present.map((r) => str(r["t"])),
  );
  const state: ScrubState = {
    state: picked.length > 0 || missingTypes.length > 0 ? "running" : "done",
    missingTypes,
    added: 0,
    before: 0,
    after: 0,
    scanned: 0,
    total: picked.reduce((a, r) => a + Number(r["c"]), 0),
    types: picked.map((r) => str(r["t"])),
    startedAt: ctx.now(),
    ...(picked.length > 0 || missingTypes.length > 0 ? {} : { doneAt: ctx.now() }),
  };
  const go = (): void => {
    for (const t of state.types)
      ctx.db.run("INSERT OR IGNORE INTO search_meta (k, v) VALUES (?, '1')", `scrubhide:${t}`);
    write(ctx, state);
  };
  if (ctx.db.batch) ctx.db.batch(go);
  else go();
  return state;
}

/**
 * A record that exists and has no index entry (its entry was lost: a drop's old delete phase left records out of search) is put in. One page of the first type still to check; answers true when nothing is left to do.
 * The type is walked with the cursor of records.query, kept in search_meta, so a stop resumes.
 */
async function addMissing(ctx: SearchCtx, s: ScrubState): Promise<boolean> {
  const type = s.missingTypes?.[0];
  if (type === undefined) {
    s.state = "done";
    s.after = 0;
    s.doneAt = ctx.now();
    write(ctx, s);
    return true;
  }
  const key = `scrubmiss:${type}`;
  const cursor = str(rowsOf(ctx.db, "SELECT v FROM search_meta WHERE k = ?", key)[0]?.["v"] ?? "");
  let page: { rows?: Array<{ id?: unknown }>; next?: unknown } = {};
  try {
    page = (await ctx.call("records.query", { type, limit: 20, ...(cursor ? { cursor } : {}) })) as typeof page;
  } catch {
    page = {}; // a type that cannot be read (dropped meanwhile) has nothing to add
  }
  const entity = `record:${type}`;
  for (const r of page.rows ?? []) {
    const id = typeof r.id === "string" ? r.id : "";
    if (
      id === "" ||
      rowsOf(ctx.db, "SELECT 1 AS x FROM search_docs WHERE entity = ? AND id = ?", entity, id).length > 0
    )
      continue;
    try {
      if ((await indexApply(ctx, { entity, id, op: "upsert", seq: 0, force: true })).indexed)
        s.added = (s.added ?? 0) + 1;
    } catch {
      /* the next change of the record reads it again */
    }
  }
  const next = typeof page.next === "string" ? page.next : "";
  const go = (): void => {
    if (next)
      ctx.db.run(
        "INSERT INTO search_meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v",
        key,
        next,
      );
    else {
      ctx.db.run("DELETE FROM search_meta WHERE k = ?", key);
      s.missingTypes!.shift();
    }
    write(ctx, s);
  };
  if (ctx.db.batch) ctx.db.batch(go);
  else go();
  return false;
}

/**
 * One slice of the job, at most about SLICE_MS of work: documents of the first pending type are read again from where the last slice stopped, each rebuilt when its text differs from the record now. Answers where the job
 * stands. The host calls it again until `done`, giving the loop back between calls.
 */
export async function scrubStep(ctx: SearchCtx, sliceMs: number = SLICE_MS): Promise<ScrubProgress> {
  ensure(ctx.db);
  let s = read(ctx);
  if (s?.state === "done") return { ...s, done: true };
  s ??= await begin(ctx);
  const t0 = performance.now();
  // at least one page, then more while the slice has time
  if (s.retry && ctx.now() < s.retry.at) return { ...s, done: false, waiting: true };
  do {
    const type = s.types[0];
    if (type === undefined) {
      if (await addMissing(ctx, s)) break;
      continue;
    }
    const posKey = `scrubpos:${type}`;
    const pos = str(rowsOf(ctx.db, "SELECT v FROM search_meta WHERE k = ?", posKey)[0]?.["v"] ?? "");
    const [afterEntity, afterId] = pos.includes("\u0000") ? pos.split("\u0000") : ["", ""];
    const docs = rowsOf(
      ctx.db,
      "SELECT entity, id, title, body FROM search_docs WHERE record_type = ? AND res_type = 'record' AND (entity > ? OR (entity = ? AND id > ?)) ORDER BY entity, id LIMIT ?",
      type,
      afterEntity,
      afterEntity,
      afterId,
      PAGE,
    );
    let last = pos;
    let stalled = false;
    for (const d of docs) {
      const entity = str(d["entity"]),
        id = str(d["id"]);
      const here = `${entity}\u0000${id}`;
      let fresh: Awaited<ReturnType<typeof resolve>> = null;
      let unreadable = false;
      try {
        fresh = await resolve(ctx, entity, id);
        if (s.retry?.key === here) delete s.retry;
      } catch (e) {
        // not any answer of "gone" (resolve says that itself): the read failed, perhaps for a moment (the start is still settling). The type stays held back and this document is tried again, a few times; only then it is taken out
        const n = (s.retry?.key === here ? s.retry.n : 0) + 1;
        if (n < RETRIES) {
          s.retry = { key: here, n, at: ctx.now() + RETRY_MS };
          stalled = true;
          break;
        }
        ctx.log.warn("search scrub: a record could not be read again, its entry is removed", {
          id,
          entity,
          tries: n,
          error: e instanceof Error ? e.message : String(e),
        });
        delete s.retry;
        s.unreadable = (s.unreadable ?? 0) + 1;
        unreadable = true;
      }
      last = here;
      if (fresh === null && !unreadable) {
        s.scanned++; // an entity nobody here reads: left as it is
        continue;
      }
      const stale =
        unreadable ||
        fresh === null ||
        "skip" in fresh ||
        fresh.doc.body.slice(0, BODY_CAP) !== str(d["body"]) ||
        fresh.doc.title !== str(d["title"]);
      if (stale) {
        const doc = fresh !== null && "doc" in fresh ? fresh.doc : null;
        const redo = (): void => {
          // what cannot be read again is taken out (the next change of the record puts it back), never left holding text that may be old
          if (doc) putDoc(ctx.db, ctx.space, { ...doc, entity }, ctx.now());
          else removeDoc(ctx.db, ctx.space, entity, id);
        };
        if (ctx.db.batch) ctx.db.batch(redo);
        else redo();
        s.before++;
      }
      s.scanned++;
    }
    if (stalled) {
      // the position moves only over the documents that were read; the failed one is the first of the next page
      const hold = (): void => {
        if (last !== "")
          ctx.db.run(
            "INSERT INTO search_meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v",
            posKey,
            last,
          );
        write(ctx, s);
      };
      if (ctx.db.batch) ctx.db.batch(hold);
      else hold();
      return { ...s, done: false, waiting: true };
    }
    if (docs.length < PAGE) {
      // the type is read to its end: its documents are shown again
      const finish = (): void => {
        ctx.db.run("DELETE FROM search_meta WHERE k IN (?, ?)", `scrubhide:${type}`, posKey);
        s.types.shift();
        write(ctx, s);
      };
      if (ctx.db.batch) ctx.db.batch(finish);
      else finish();
    } else {
      const keep = (): void => {
        ctx.db.run(
          "INSERT INTO search_meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v",
          posKey,
          last,
        );
        write(ctx, s);
      };
      if (ctx.db.batch) ctx.db.batch(keep);
      else keep();
    }
  } while (s.state === "running" && performance.now() - t0 < sliceMs);
  return { ...s, done: s.state === "done" };
}
