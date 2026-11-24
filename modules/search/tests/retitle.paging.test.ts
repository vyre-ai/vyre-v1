// A re-titling pages by (entity, id), the table's own key: documents that share an id under different entities are not split by a page boundary (the second would be skipped).
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { retitleRun } from "../handlers/index.ts";
import { ensure, putDoc, rowsOf, setSource } from "../projections.ts";
import type { Db, SearchCtx } from "../projections.ts";

test("three documents with one id under three entities, across a page boundary, are both titled again", async () => {
  const raw = new DatabaseSync(":memory:");
  const db: Db = {
    all: (sql, ...a) => raw.prepare(sql).all(...(a as never[])) as unknown[],
    run: (sql, ...a) => ({ changes: Number(raw.prepare(sql).run(...(a as never[])).changes) }),
  };
  ensure(db);
  // a source of this test's own: the title is what the document should have
  setSource("thing", async (_ctx, id, sub) => ({
    doc: {
      entity: `thing:${sub}`,
      id,
      kind: "record",
      title: `new ${sub} ${id}`,
      body: "",
      link: `/t/${id}`,
      label: 0,
      resource: { type: "record", id },
      recordType: "tt",
    },
  }));
  const ids = Array.from({ length: 130 }, (_, i) => `rec_${String(i).padStart(4, "0")}`);
  for (const sub of ["a", "b", "c"])
    for (const id of ids)
      putDoc(
        db,
        "spc",
        {
          entity: `thing:${sub}`,
          id,
          kind: "record",
          title: "old",
          body: "",
          link: `/t/${id}`,
          label: 0,
          resource: { type: "record", id },
          recordType: "tt",
        },
        1,
      );
  db.run("INSERT INTO search_meta (k, v) VALUES (?, ?)", "retitle:tt", JSON.stringify({ to: "x", after: "", seq: 5 }));
  db.run("INSERT INTO search_meta (k, v) VALUES ('retitled_all', '1')");
  const ctx = {
    db,
    space: "spc",
    now: () => 1000,
    call: async () => ({}),
    authorize: () => ({ effect: "allow" }),
  } as unknown as SearchCtx;
  for (let i = 0; i < 6; i++) await retitleRun(ctx);
  const left = rowsOf(db, "SELECT entity, id FROM search_docs WHERE title = 'old'");
  assert.equal(left.length, 0, `${left.length} documents were skipped`);
  assert.equal(rowsOf(db, "SELECT count(*) AS c FROM search_docs WHERE title LIKE 'new %'")[0]!["c"], 390);
  assert.equal(rowsOf(db, "SELECT k FROM search_meta WHERE k = 'retitle:tt'").length, 0, "the marker ended");
});
