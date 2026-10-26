// Bulk work on picked rows: find every id behind "Select all N", delete or restore in chunks with a progress report, and the export filter for a pick. No React; `call` is the data layer's
// one capability call, so the same code runs against the sample replica and the real daemon.
export type Call = (cap: string, input: unknown) => Promise<unknown>;

/** Rows per capability batch: enough to keep the round trips few, few enough that the progress line moves. */
export const CHUNK = 50;
/** Rows per page when every id of a view is read. */
export const PAGE = 200;

export function chunks<T>(items: readonly T[], size: number = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, size)) out.push(items.slice(i, i + Math.max(1, size)));
  return out;
}

/** Every record id of the view, page by page (the ids are read before anything is deleted, so deleting cannot shift the pages). */
export async function allIds(call: Call, spec: { type: string; filter?: unknown; sort?: unknown }, total: number, onProgress: (found: number) => void): Promise<string[]> {
  const ids: string[] = [];
  while (ids.length < total) {
    const out = (await call("records.query", { ...spec, offset: ids.length, limit: PAGE, fields: [] })) as { rows: { id: string }[] };
    if (out.rows.length === 0) break;
    for (const r of out.rows) ids.push(r.id);
    onProgress(ids.length);
  }
  return ids;
}

/** One capability for each id, a chunk at a time; the progress is told after every chunk. A failed id is counted and the rest go on. */
export async function eachId(call: Call, cap: "records.delete" | "records.restore", type: string, ids: readonly string[], onProgress: (done: number, failed: number) => void): Promise<{ done: number; failed: number }> {
  let done = 0, failed = 0;
  for (const part of chunks(ids)) {
    const results = await Promise.allSettled(part.map((recordId) => call(cap, { type, recordId })));
    for (const r of results) { if (r.status === "fulfilled") done++; else failed++; }
    onProgress(done, failed);
  }
  return { done, failed };
}

export const recordsWord = (n: number, one: string, many: string): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
