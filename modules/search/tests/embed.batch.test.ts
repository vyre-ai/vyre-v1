// search.embed.run writes a page of vectors in one transaction with one generation write: the statements per document used to be four (vector, mark, generation read and write), each its own commit.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ensure, putDoc, rowsOf, vectorsOf, writeVectors } from "../projections.ts";
import type { Db } from "../projections.ts";

function memDb(): { db: Db; stmts: string[]; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  const stmts: string[] = [];
  let depth = 0;
  const db: Db = {
    all: (sql, ...a) => {
      stmts.push(sql);
      return raw.prepare(sql).all(...(a as never[])) as unknown[];
    },
    run: (sql, ...a) => {
      stmts.push(sql);
      return { changes: Number(raw.prepare(sql).run(...(a as never[])).changes) };
    },
    batch: <T>(fn: () => T): T => {
      if (depth > 0) return fn();
      raw.exec("BEGIN");
      depth++;
      try {
        const r = fn();
        raw.exec("COMMIT");
        stmts.push("COMMIT");
        return r;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      } finally {
        depth--;
      }
    },
  };
  return { db, stmts, raw };
}

test("a page of vectors is one commit and one generation write, and every document is marked embedded", () => {
  const { db, stmts } = memDb();
  ensure(db);
  const ns: number[] = [];
  for (let i = 0; i < 5; i++) {
    putDoc(
      db,
      "spc_t",
      {
        entity: "note",
        id: `n${i}`,
        kind: "note",
        title: `T${i}`,
        body: `body ${i}`,
        link: `/n/${i}`,
        label: 0,
        resource: { type: "note", id: `n${i}` },
      } as never,
      1000 + i,
    );
    ns.push(Number((rowsOf(db, "SELECT n FROM search_docs WHERE id = ?", `n${i}`)[0] as { n: number }).n));
  }
  vectorsOf(db, "spc_t");
  stmts.length = 0;
  writeVectors(
    db,
    "spc_t",
    ns.map((n) => ({ n, v: new Float32Array(Array.from({ length: 384 }, (_, k) => (k === n % 384 ? 1 : 0))) })),
  );
  assert.equal(stmts.filter((s) => s === "COMMIT").length, 1, "one commit for the page of five");
  assert.equal(
    stmts.filter((s) => /vec_gen/.test(s) && /INSERT/.test(s)).length,
    1,
    "one generation write for the page",
  );
  assert.equal(
    stmts.filter((s) => /SELECT v FROM search_meta WHERE k = 'vec_gen'/.test(s)).length <= 2,
    true,
    "the generation is read once or twice, not once a document",
  );
  const marked = rowsOf(db, "SELECT count(*) AS c FROM search_docs WHERE embedded = 1")[0] as { c: number };
  assert.equal(Number(marked.c), 5);
  const vecs = rowsOf(db, "SELECT count(*) AS c FROM search_vectors")[0] as { c: number };
  assert.equal(Number(vecs.c), 5);
});
