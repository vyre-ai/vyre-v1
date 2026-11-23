// A sync that only registers objects writes two rows for each (access.sync, persistResources). A batch of a thousand of them was two thousand statements and as many commits in one synchronous stretch
// (147 ms in one stretch of a 200 ms block on a firm's Space, Nov 2026). The writes go in one transaction.
import test from "node:test";
import assert from "node:assert/strict";
import { NOW, SPACE, ctxOf, fresh, sync } from "../fixtures/incremental.ts";
import { loadStore } from "../projections.ts";
import type { Db } from "../projections.ts";

test("a batch of two thousand new objects is written in one stretch of under 100 ms, and every object is in the tables", () => {
  const { db: raw } = fresh("batch1000");
  sync(ctxOf(raw), {
    events: [
      {
        seq: 1,
        type: "resource.created",
        payload: { id: SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_owner", holds: 0 },
      },
    ],
  });
  // the server has run this path many times by the time a big batch arrives: warm it with a smaller batch first, so the measure is the work and not the compiler's threads
  sync(ctxOf(raw), {
    events: Array.from({ length: 300 }, (_, i) => ({
      seq: 2 + i,
      type: "resource.created",
      payload: { id: `rec_w${i}`, type: "record", parent_id: SPACE, label: 1, owner_id: "usr_owner", holds: 0 },
    })),
  });
  const events = Array.from({ length: 2000 }, (_, i) => ({
    seq: 400 + i,
    type: "resource.created",
    payload: { id: `rec_b${i}`, type: "record", parent_id: SPACE, label: 1, owner_id: "usr_owner", holds: 0 },
  }));
  raw.exec("PRAGMA wal_checkpoint(TRUNCATE)"); // the migrations left the log near its size for a checkpoint: not part of what is measured
  const t0 = process.cpuUsage();
  const snap = sync(ctxOf(raw), { events });
  const cpu = process.cpuUsage(t0);
  const took = (cpu.user + cpu.system) / 1000; // the work of the call, not the pauses of the machine
  process.stderr.write(`[access.batch] 2000 objects in ${Math.round(took)} ms\n`);
  assert.equal(snap.resource("rec_b1999")?.label, 1);
  const n = (raw.all("SELECT count(*) AS n FROM access_resources WHERE id LIKE 'rec_b%'")[0] as { n: number }).n;
  assert.equal(n, 2000);
  assert.ok(took <= 100, `${Math.round(took)} ms in one stretch (budget 100 ms)`);
  void NOW;
});

test("an object named twice in one batch is written once", () => {
  const { db: raw } = fresh("batchdup");
  const store = loadStore(raw);
  store.resources.set("rec_dup", {
    id: "rec_dup",
    type: "record",
    parentId: null,
    label: 1,
    ownerId: "usr_owner",
    holds: 0,
    row: null,
  } as never);
  const writes: string[] = [];
  const spy: Db = {
    all: (sql, ...a) => raw.all(sql, ...a),
    run: (sql, ...a) => {
      writes.push(sql);
      return raw.run(sql, ...a);
    },
  };
  store.persistResources(spy, ["rec_dup", "rec_dup", "rec_dup"], false);
  assert.equal(writes.filter((w) => /^INSERT INTO access_resources/.test(w)).length, 1, "one insert statement");
  const n = (raw.all("SELECT count(*) AS n FROM access_resources WHERE id = 'rec_dup'")[0] as { n: number }).n;
  assert.equal(n, 1);
  const params: unknown[][] = [];
  const spy2: Db = { all: spy.all, run: (sql, ...a) => (params.push(a), raw.run(sql, ...a)) };
  store.persistResources(spy2, ["rec_dup", "rec_dup"], false);
  assert.equal(params.find((p) => p.length === 7)?.length, 7, "one row of seven values, not two");
});
