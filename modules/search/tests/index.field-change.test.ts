// A field dropped from a type rewrites its rows without any record.updated in the Space log (schema.apply writes the records store directly), so the index follows the schema change instead:
// the type's documents are read again, a page at a time, and the documents of a dropped type leave. The consumer itself folds a record.updated that names a field patched to null.
import test from "node:test";
import assert from "node:assert/strict";
import { consumers } from "../impl.ts";
import * as idx from "../handlers/index.ts";

const { indexApply, retitleRun } = idx;
import { query } from "../handlers/query.ts";
import { harness } from "../fixtures/harness.ts";

/** A type of `n` records that hold a name and a note; `dropped` says whether the note has been dropped (the records then answer without it). */
function world(n: number) {
  const state = { dropped: false };
  const h = harness({
    respond: {
      "records.get": (i) => ({
        record: {
          id: i["recordId"],
          type: "matter",
          label: 1,
          fields: state.dropped
            ? { name: `Matter ${i["recordId"]}` }
            : { name: `Matter ${i["recordId"]}`, note: "zqnotetext" },
          updatedAt: 5,
        },
      }),
      "schema.types.get": (i) => ({ type: { key: i["type"], titleField: "name" } }),
    },
  });
  return { h, state, ids: Array.from({ length: n }, (_, i) => `rec_${String(i).padStart(4, "0")}`) };
}
const dropEvent = (seq: number) => ({
  type: "schema.changed",
  seq,
  payload: { type: "matter", types: ["matter"], ops: [{ op: "field.drop", type: "matter", field: "note" }] },
});
const hitsFor = async (h: ReturnType<typeof harness>, q: string) => (await query(h.ctx, { q })).hits.map((x) => x.id);

test("the index consumer folds the record.updated a field drop would produce: the control, it was never the consumer", async () => {
  const { h, state, ids } = world(1);
  await indexApply(h.ctx, { entity: "record:matter", id: ids[0]!, op: "upsert", seq: 1 });
  assert.deepEqual(await hitsFor(h, "zqnotetext"), [ids[0]]);
  state.dropped = true;
  await consumers["search.fts"].run(h.ctx, {
    type: "record.updated",
    seq: 2,
    payload: { recordId: ids[0]!, type: "matter", fields: { note: null }, prev: { note: "zqnotetext" }, version: 2 },
  });
  assert.deepEqual(await hitsFor(h, "zqnotetext"), []);
});

test("a schema.changed that drops a field reads the type's documents again: 250 documents lose the dropped text, none is lost", async () => {
  const { h, state, ids } = world(250);
  for (const id of ids) await indexApply(h.ctx, { entity: "record:matter", id, op: "upsert", seq: 1 });
  assert.equal((await hitsFor(h, "zqnotetext")).length > 0, true);
  state.dropped = true;
  await consumers["search.titles"].run(h.ctx, dropEvent(2));
  assert.deepEqual(await hitsFor(h, "zqnotetext"), []);
  const left = h.rows(
    "SELECT count(*) AS c FROM search_docs WHERE record_type = 'matter' AND body LIKE '%zqnotetext%'",
  );
  assert.equal(Number(left[0]!["c"]), 0);
  assert.equal(Number(h.rows("SELECT count(*) AS c FROM search_docs WHERE record_type = 'matter'")[0]!["c"]), 250);
  assert.deepEqual(h.rows("SELECT k FROM search_meta WHERE k LIKE 'reindex:%'"), [], "the job is finished and gone");
});

test("a stop in the middle of the job resumes where the last page ended (the periodic retitle run goes on with it)", async () => {
  const { h, state, ids } = world(250);
  for (const id of ids) await indexApply(h.ctx, { entity: "record:matter", id, op: "upsert", seq: 1 });
  state.dropped = true;
  // the consumer queued the job and did one page before the stop
  (idx as unknown as Record<string, (...a: unknown[]) => unknown>)["noteFieldChange"]!(h.ctx, dropEvent(2));
  assert.equal(await (idx as unknown as Record<string, (c: unknown) => Promise<number>>)["reindexRun"]!(h.ctx), 100);
  assert.equal(Number(h.rows("SELECT count(*) AS c FROM search_docs WHERE body LIKE '%zqnotetext%'")[0]!["c"]), 150);
  await retitleRun(h.ctx);
  assert.equal(Number(h.rows("SELECT count(*) AS c FROM search_docs WHERE body LIKE '%zqnotetext%'")[0]!["c"]), 50);
  await retitleRun(h.ctx);
  assert.equal(Number(h.rows("SELECT count(*) AS c FROM search_docs WHERE body LIKE '%zqnotetext%'")[0]!["c"]), 0);
});

test("a dropped type's documents leave the index; other types' documents stay", async () => {
  const { h, ids } = world(3);
  for (const id of ids) await indexApply(h.ctx, { entity: "record:matter", id, op: "upsert", seq: 1 });
  await consumers["search.titles"].run(h.ctx, { type: "schema.type_dropped", seq: 3, payload: { type: "other" } });
  assert.equal(Number(h.rows("SELECT count(*) AS c FROM search_docs")[0]!["c"]), 3);
  await consumers["search.titles"].run(h.ctx, { type: "schema.type_dropped", seq: 4, payload: { type: "matter" } });
  assert.equal(Number(h.rows("SELECT count(*) AS c FROM search_docs")[0]!["c"]), 0);
  assert.equal(Number(h.rows("SELECT count(*) AS c FROM search_fts")[0]!["c"]), 0);
});

test("an event for a field that is only renamed or added queues nothing", async () => {
  const { h, ids } = world(1);
  await indexApply(h.ctx, { entity: "record:matter", id: ids[0]!, op: "upsert", seq: 1 });
  await consumers["search.titles"].run(h.ctx, {
    type: "schema.changed",
    seq: 2,
    payload: { type: "matter", types: ["matter"], ops: [{ op: "field.rename", type: "matter", field: "note" }] },
  });
  assert.deepEqual(h.rows("SELECT k FROM search_meta WHERE k LIKE 'reindex:%'"), []);
});

test("a record whose data still holds a key its type no longer has is indexed without the words of that key", async () => {
  const h = harness({
    respond: {
      "records.get": (i) => ({
        record: {
          id: i["recordId"],
          type: "matter",
          label: 1,
          fields: { name: "Kept name", note: "zqretiredtext", fresh: "zqfreshtext" },
          updatedAt: 5,
        },
      }),
      "schema.types.get": (i) => ({
        type: { key: i["type"], titleField: "name", fields: [{ key: "name" }, { key: "fresh" }] },
      }),
    },
  });
  await indexApply(h.ctx, { entity: "record:matter", id: "rec_r", op: "upsert", seq: 1 });
  const body = String(h.rows("SELECT body FROM search_docs WHERE id = 'rec_r'")[0]!["body"]);
  assert.doesNotMatch(body, /zqretiredtext/);
  assert.match(body, /zqfreshtext/);
  assert.deepEqual(await hitsFor(h, "zqretiredtext"), []);
});
