// A fill of a computed field that the process did not live to finish goes on from its cursor: no record is skipped and none is computed twice, the job says it is still running (the app shows updating) until the
// last record is done, and the values are right. The process is "killed" inside a slice (the slice's savepoint dies with it, as an open transaction does) and the store is closed and opened again from the file.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openRecords } from "../impl.ts";
import { backfillType, ensureComputedTables, updatingFields } from "../handlers/computed.ts";
import type { ComputedDef, ComputedEnv } from "../handlers/computed.ts";
import type { Tx } from "../../../kernel/src/store/projection.ts";

const SPACE = "spc_aaaaaaaaaaaa";
const LINE = Object.freeze({
  name: "line",
  label: "Line",
  fields: [
    { name: "name", kind: "text", label: "Name" },
    { name: "qty", kind: "number", label: "Qty" },
  ],
});
const DEFS: ComputedDef[] = [{ key: "double", type: "formula", options: { expr: "qty * 2" } }];
const N = 3_000;

const envOf = (rec: ReturnType<typeof openRecords>, tx: Tx): ComputedEnv => ({
  tx,
  store: rec.store,
  now: () => 1_800_000_000_000,
  defsOf: async () => DEFS,
  shapes: async () => new Map([["line", { key: "line", fields: [{ key: "qty", type: "number" }] }]]),
});

test("a fill stopped halfway goes on from its cursor after a restart: each record once, none missing, updating until it ends", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-computed-resume-")), "space.db");
  const first = openRecords({ space: SPACE, path: file });
  await first.store.define({ add_types: [LINE] as never });
  const ids: string[] = [];
  for (let i = 0; i < N; i++) {
    const r = await first.store.create("line", `rec_${i.toString(16).padStart(32, "0")}`, {
      name: `L${i}`,
      qty: i % 11,
    });
    ids.push(r.id);
  }
  // every write of a computed value is counted by record, across both runs
  const writes = new Map<string, number>();
  const counting = (raw: Tx, killAfter: number): Tx => {
    let n = 0;
    return {
      ...raw,
      run: (sql, ...a) => {
        if (/INSERT INTO records_computed \(/.test(sql)) {
          if (++n > killAfter) throw new Error("the process died here");
          const id = String(a[1]);
          writes.set(id, (writes.get(id) ?? 0) + 1);
        }
        return raw.run(sql, ...a);
      },
    } as Tx;
  };
  ensureComputedTables(first.host.tx);
  await assert.rejects(backfillType(envOf(first, counting(first.host.tx, 1_000)), "line"), /died/);
  const job = first.host.tx.get<{ state: string; cursor: string | null; done: number }>(
    "SELECT state, cursor, done FROM records_computed_job WHERE type = 'line' AND field = 'double'",
  )!;
  const before = Number(first.host.tx.get<{ c: number }>("SELECT count(*) AS c FROM records_computed")!.c);
  assert.equal(job.state, "running", "the job is not done");
  assert.ok(job.cursor && before > 0 && before < N, `some, not all, are done (${before} of ${N})`);
  assert.equal(
    before,
    job.done,
    "the progress row says exactly what was written (the slice that died left nothing behind)",
  );
  assert.deepEqual(
    updatingFields(first.host.tx, "line"),
    ["double"],
    "a read in the gap reports the field as updating",
  );
  first.host.close();

  // the restart: a new process, the same file
  const second = openRecords({ space: SPACE, path: file });
  assert.deepEqual(updatingFields(second.host.tx, "line"), ["double"], "still updating after the restart");
  const out = await backfillType(envOf(second, counting(second.host.tx, Infinity)), "line");
  assert.equal(out.ran, true);
  const all = second.host.tx.all<{ id: string; value: string }>(
    "SELECT id, value FROM records_computed WHERE field = 'double' ORDER BY id",
  );
  assert.equal(all.length, N, "every record has its value");
  assert.deepEqual(updatingFields(second.host.tx, "line"), [], "nothing is updating once it is done");
  for (const r of all) {
    const i = parseInt(r.id.slice(4), 16);
    assert.equal(JSON.parse(r.value), (i % 11) * 2, `a value is right (${r.id})`);
  }
  assert.equal(writes.size, N, "every record was written");
  const twice = [...writes].filter(([, n]) => n > 1);
  assert.deepEqual(twice, [], "no record was computed twice across the stop and the restart");
  const done = second.host.tx.get<{ state: string; done: number }>(
    "SELECT state, done FROM records_computed_job WHERE type = 'line'",
  )!;
  assert.deepEqual({ state: done.state, done: done.done }, { state: "done", done: N });
  // control: a second call has nothing left to do
  assert.equal((await backfillType(envOf(second, counting(second.host.tx, Infinity)), "line")).ran, false);
  second.host.close();
});
