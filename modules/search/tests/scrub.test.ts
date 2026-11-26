// The one-time scrub of search entries that carry text of removed fields: documents of the types that had a destructive schema change are read again from the records, those whose text differs are rebuilt, the types are
// held back from every way search shows an item until their last document is read, a stop in the middle resumes, and a finished job never runs again.
import test from "node:test";
import assert from "node:assert/strict";
import { scrubStep, SCRUB_KEY } from "../handlers/scrub.ts";
import { query } from "../handlers/query.ts";
import { harness, seed } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const ids = (n: number, p = "rec"): string[] =>
  Array.from({ length: n }, (_, i) => `${p}_${String(i).padStart(4, "0")}`);

/** `n` records of a type whose documents still carry the text of a field the records no longer hold. */
function world(o: { n: number; history?: "destructive" | "none" | "unreadable"; extra?: number }) {
  const gone = new Set<string>(),
    broken = new Set<string>();
  const h = harness({
    respond: {
      "records.get": (i) => {
        const id = String(i["recordId"]);
        if (broken.has(id)) throw new Error("boom");
        if (gone.has(id)) {
          const e = new Error("gone") as Error & { error: { code: string } };
          e.error = { code: "validation.not_found" };
          throw e;
        }
        return {
          record: { id, type: i["type"] ?? "matter", label: 1, fields: { name: `Matter ${id}` }, updatedAt: 5 },
        };
      },
      "schema.types.get": (i) => ({ type: { key: i["type"], titleField: "name" } }),
      "schema.changes.list": () => {
        if (o.history === "unreadable") throw new Error("no history");
        return {
          changes:
            o.history === "none"
              ? []
              : [
                  { destructive: true, types: ["matter"] },
                  { destructive: false, types: ["keep"] },
                ],
        };
      },
    },
  });
  const put = (type: string, id: string, body: string): void => {
    seed(h, {
      id,
      title: `Matter ${id}`,
      body,
      kind: "record",
      entity: `record:${type}`,
      recordType: type,
      resource: { type: "record", id },
    });
  };
  const list = ids(o.n);
  for (const id of list) put("matter", id, `zqold${id}`);
  for (const id of ids(o.extra ?? 0, "kp")) put("keep", id, `zqkeepold${id}`);
  return { h, list, gone, broken, put };
}
const run = async (h: Harness, sliceMs?: number): Promise<number> => {
  let steps = 0;
  for (;;) {
    steps++;
    const r = await scrubStep(h.ctx, sliceMs);
    if (r.done) return steps;
    if (r.waiting) h.advance(1_000); // a failed read is tried again after a pause
    assert.ok(steps < 1000, "the job ends");
  }
};
const stale = (h: Harness): number =>
  Number(h.rows("SELECT count(*) AS c FROM search_docs WHERE body LIKE '%zqold%'")[0]!["c"]);
const state = (h: Harness) => JSON.parse(String(h.rows("SELECT v FROM search_meta WHERE k = ?", SCRUB_KEY)[0]!["v"]));

test("the old text is rebuilt out of every document of a changed type, none is lost, and the count before is N and after is 0", async () => {
  const { h, list } = world({ n: 45 });
  assert.equal(stale(h), 45);
  await run(h, 0);
  assert.equal(stale(h), 0);
  assert.equal(Number(h.rows("SELECT count(*) AS c FROM search_docs WHERE record_type = 'matter'")[0]!["c"]), 45);
  assert.equal(
    Number(h.rows("SELECT count(*) AS c FROM search_fts WHERE search_fts MATCH 'zqold*'")[0]!["c"]),
    0,
    "the full text twin holds none of it",
  );
  const s = state(h);
  assert.deepEqual([s.state, s.before, s.after, s.scanned, s.total], ["done", 45, 0, 45, 45]);
  assert.equal((await query(h.ctx, { q: list[7]! })).hits.length, 1, "a record is still found by what it holds now");
  assert.deepEqual(h.rows("SELECT k FROM search_meta WHERE k LIKE 'scrubhide:%' OR k LIKE 'scrubpos:%'"), []);
});

test("the old text is not found at any point while the job runs: the type is held back at the first slice and shown again at its last", async () => {
  const { h, list } = world({ n: 45 });
  let steps = 0;
  for (;;) {
    const r = await scrubStep(h.ctx, 0);
    steps++;
    const found = (await query(h.ctx, { q: "zqold" })).hits.length;
    if (!r.done) assert.equal(found, 0, `step ${steps}: no old text is found while the job runs`);
    if (r.done) break;
  }
  assert.ok(steps >= 3, "the job took several slices");
  assert.equal((await query(h.ctx, { q: "zqold" })).hits.length, 0);
  assert.equal((await query(h.ctx, { q: list[3]! })).hits.length, 1, "after it, the records are found again");
});

test("a stop in the middle resumes where the last slice ended, and a finished job does nothing on the next start", async () => {
  const { h, list } = world({ n: 60 });
  await scrubStep(h.ctx, 0);
  assert.equal(state(h).state, "running");
  const read = h.calls("records.get").length;
  assert.equal(read, 5);
  // the next start: the same database, the job goes on from its row
  await run(h, 0);
  assert.equal(h.calls("records.get").length, 60, "each document was read once, none twice across the stop");
  assert.equal(stale(h), 0);
  const done = state(h);
  const before = h.calls("records.get").length;
  const again = await scrubStep(h.ctx);
  assert.equal(again.done, true);
  assert.equal(h.calls("records.get").length, before, "a second start reads nothing");
  assert.deepEqual(state(h), done, "and writes nothing");
  assert.equal(list.length, 60);
});

test("only the types that had a destructive change are read; with the history unreadable every type is", async () => {
  const a = world({ n: 5, extra: 5 });
  await run(a.h, 0);
  assert.equal(Number(a.h.rows("SELECT count(*) AS c FROM search_docs WHERE body LIKE '%zqkeepold%'")[0]!["c"]), 5);
  assert.equal(a.h.calls("records.get").length, 5, "the other type was not read");
  const b = world({ n: 5, extra: 5, history: "unreadable" });
  await run(b.h, 0);
  assert.equal(Number(b.h.rows("SELECT count(*) AS c FROM search_docs WHERE body LIKE '%zqkeepold%'")[0]!["c"]), 0);
  assert.equal(state(b.h).before, 10);
  const c = world({ n: 5, history: "none" });
  await run(c.h, 0);
  assert.equal(stale(c.h), 5, "no destructive change: nothing could have been dropped, nothing is read");
  assert.equal(state(c.h).state, "done");
});

test("a record that is gone or cannot be read leaves the index instead of keeping text that may be old", async () => {
  const { h, list, gone, broken } = world({ n: 6 });
  gone.add(list[1]!);
  broken.add(list[2]!);
  await run(h, 0);
  assert.equal(Number(h.rows("SELECT count(*) AS c FROM search_docs WHERE record_type = 'matter'")[0]!["c"]), 4);
  assert.equal(state(h).before, 6);
});

test("a record that exists and has no index entry is put in, across pages, and counted; one that is already indexed is left", async () => {
  const all = ids(47);
  const h = harness({
    respond: {
      "records.get": (i) => ({
        record: {
          id: i["recordId"],
          type: "matter",
          label: 1,
          fields: { name: `Matter ${i["recordId"]}` },
          updatedAt: 5,
        },
      }),
      "schema.types.get": (i) => ({ type: { key: i["type"], titleField: "name" } }),
      "schema.changes.list": () => ({ changes: [] }),
      "schema.map": () => ({
        nodes: [
          { type: "matter", rowCount: 47 },
          { type: "empty", rowCount: 0 },
        ],
      }),
      "records.query": (i) => {
        const from = i["cursor"] ? Number(i["cursor"]) : 0;
        const rows = all.slice(from, from + 20).map((id) => ({ id }));
        return { rows, ...(from + 20 < all.length ? { next: String(from + 20) } : {}) };
      },
    },
  });
  for (const id of all.slice(0, 5))
    seed(h, {
      id,
      title: `Matter ${id}`,
      body: "",
      kind: "record",
      entity: "record:matter",
      recordType: "matter",
      resource: { type: "record", id },
    });
  await run(h, 0);
  assert.equal(Number(h.rows("SELECT count(*) AS c FROM search_docs WHERE record_type = 'matter'")[0]!["c"]), 47);
  const s = state(h);
  assert.deepEqual([s.state, s.added], ["done", 42]);
});

test("a read that fails once is tried again and the document stays; one that fails past the limit is removed and counted; a record that is gone is removed at once", async () => {
  const { h, list, broken } = world({ n: 5 });
  let failsLeft = 1;
  const base = h.respond["records.get"]!;
  h.respond["records.get"] = (i) => {
    if (i["recordId"] === list[2] && failsLeft > 0) {
      failsLeft--;
      throw new Error("the snapshot is not folded yet");
    }
    return base(i);
  };
  await run(h, 0);
  assert.equal(Number(h.rows("SELECT count(*) AS c FROM search_docs WHERE record_type = 'matter'")[0]!["c"]), 5);
  assert.equal(stale(h), 0, "the document that failed once was read again and rebuilt");
  assert.equal(state(h).unreadable ?? 0, 0);
  // fails every time: tried five times, then removed and counted
  const b = world({ n: 5 });
  b.broken.add(b.list[3]!);
  const seen = b.h.calls("records.get");
  await run(b.h, 0);
  assert.equal(b.h.calls("records.get").filter((c) => c.input["recordId"] === b.list[3]).length, 5);
  assert.equal(Number(b.h.rows("SELECT count(*) AS c FROM search_docs WHERE record_type = 'matter'")[0]!["c"]), 4);
  assert.equal(state(b.h).unreadable, 1);
  void seen;
  void broken;
  // gone: one read, removed at once
  const g = world({ n: 5 });
  g.gone.add(g.list[1]!);
  await run(g.h, 0);
  assert.equal(g.h.calls("records.get").filter((c) => c.input["recordId"] === g.list[1]).length, 1);
  assert.equal(Number(g.h.rows("SELECT count(*) AS c FROM search_docs WHERE record_type = 'matter'")[0]!["c"]), 4);
  assert.equal(state(g.h).unreadable ?? 0, 0);
});

test("while a read is being tried again the type stays held back and the position does not move past it", async () => {
  const { h, list } = world({ n: 5 });
  const base = h.respond["records.get"]!;
  h.respond["records.get"] = (i) => {
    if (i["recordId"] === list[3]) throw new Error("busy");
    return base(i);
  };
  const r = await scrubStep(h.ctx, 0);
  assert.equal(r.waiting, true);
  assert.equal(h.rows("SELECT k FROM search_meta WHERE k = 'scrubhide:matter'").length, 1, "still held back");
  const pos = String(h.rows("SELECT v FROM search_meta WHERE k = 'scrubpos:matter'")[0]!["v"]);
  assert.equal(pos, `record:matter\u0000${list[2]}`);
  const again = await scrubStep(h.ctx, 0);
  assert.equal(again.waiting, true, "no new try before the pause is over");
  assert.equal(h.calls("records.get").length, 4);
});
