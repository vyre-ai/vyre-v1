// The one-time scrub of text of removed fields (rc.44). Before the index followed a field drop (handlers/index.ts, noteFieldChange), a Space that dropped a field kept the dropped text in search_docs and search_fts for
// good: a person whose access hides the field could still find the record by it. On the first start of the build that has this, every record type that had a destructive schema change is read again, a slice of work at
// a time, and each document whose text differs from the record as it is now is rebuilt (or removed when the record is gone or unreadable).
//
// While it runs the documents of those types are held back from every way search shows an item (the `scrubhide:<type>` rows, see scrubHidden), so the old text is never found at any point, and each type comes back
// when its last document has been read. The job is a row in search_meta (`scrub:removed_fields`) with a position for each type: a stop in the middle resumes where it was, and a finished job is never run again.
// The host runs it after the daemon serves (host/src/daemon/daemon.ts, startSearchScrub), a call for each slice with the loop given back between calls; the doctor reads the row (host/src/daemon/doctor.ts).
import { BODY_CAP, ensure, putDoc, removeDoc, rowsOf, str } from "../projections.ts";
import type { SearchCtx } from "../projections.ts";
import { resolve } from "./index.ts";

export const SCRUB_KEY = "scrub:removed_fields";
const PAGE = 10;
// a slice of work is a stretch the loop is held for (the awaits inside it are not turns of the loop): a page of ten documents and at most 10 ms more, so a call of the host stays near 20 ms
const SLICE_MS = 10;

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
  startedAt: number;
  doneAt?: number;
}

export interface ScrubProgress extends ScrubState {
  done: boolean;
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

/** Start the job: which types, their documents held back at once (one transaction), the row written. */
async function begin(ctx: SearchCtx): Promise<ScrubState> {
  const present = rowsOf(
    ctx.db,
    "SELECT record_type AS t, count(*) AS c FROM search_docs WHERE record_type IS NOT NULL AND res_type = 'record' GROUP BY record_type ORDER BY record_type",
  );
  const changed = present.length > 0 ? await changedTypes(ctx) : new Set<string>();
  const picked = present.filter((r) => changed === null || changed.has(str(r["t"])));
  const state: ScrubState = {
    state: picked.length > 0 ? "running" : "done",
    before: 0,
    after: 0,
    scanned: 0,
    total: picked.reduce((a, r) => a + Number(r["c"]), 0),
    types: picked.map((r) => str(r["t"])),
    startedAt: ctx.now(),
    ...(picked.length > 0 ? {} : { doneAt: ctx.now() }),
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
  do {
    const type = s.types[0];
    if (type === undefined) break;
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
    for (const d of docs) {
      const entity = str(d["entity"]),
        id = str(d["id"]);
      last = `${entity}\u0000${id}`;
      let fresh: Awaited<ReturnType<typeof resolve>> = null;
      let unreadable = false;
      try {
        fresh = await resolve(ctx, entity, id);
      } catch {
        unreadable = true;
      }
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
    if (docs.length < PAGE) {
      // the type is read to its end: its documents are shown again
      const finish = (): void => {
        ctx.db.run("DELETE FROM search_meta WHERE k IN (?, ?)", `scrubhide:${type}`, posKey);
        s.types.shift();
        if (s.types.length === 0) {
          s.state = "done";
          s.after = 0;
          s.doneAt = ctx.now();
        }
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
