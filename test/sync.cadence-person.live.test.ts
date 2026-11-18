// A synced type whose chain of polls has gone quiet is started again by the server's cadence (17 Nov 2026: the firm's first sync). The pass the cadence starts runs as the person who set the sync up,
// like every other pass of the type; the server never runs it as itself (it is not in the Space's access list, so a pass run as it was refused: "There is no such connection").
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { call, hostLog, waitFor } from "./support/eco-live.ts";
import { pump, rowsOf, spec, world } from "./support/sync-live.ts";

const readsBy = (
  d: { sink: { flush(): void }; paths: { logs: string } },
  after: number,
): Array<{ actor: string; result: string }> => {
  d.sink.flush();
  const ro = new DatabaseSync(d.paths.logs, { readOnly: true });
  try {
    return ro
      .prepare("SELECT actor, result FROM logs WHERE cap = 'connectors.read' AND id > ? ORDER BY id")
      .all(after) as Array<{ actor: string; result: string }>;
  } finally {
    ro.close();
  }
};
const callsSince = (d: { sink: { flush(): void }; paths: { logs: string } }, after: number): unknown[] => {
  d.sink.flush();
  const ro = new DatabaseSync(d.paths.logs, { readOnly: true });
  try {
    return ro
      .prepare(
        "SELECT cap, actor, result, msg FROM logs WHERE (cap LIKE 'connectors.%' OR cap LIKE 'runs.%') AND id > ? ORDER BY id LIMIT 30",
      )
      .all(after);
  } finally {
    ro.close();
  }
};
/** What a chain that went quiet looks like: no poll waiting and none scheduled. */
const quiet = (dir: string): void => {
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".db"))) {
    const db = new DatabaseSync(path.join(dir, f));
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      for (const sql of [
        "DELETE FROM cn_sync_poll",
        "DELETE FROM cn_sync_running",
        `UPDATE cn_synced_types SET polling = '{"activeSec":1,"idleSec":1,"dormantSec":1}'`,
        "DELETE FROM host_schedule WHERE cap = 'connectors.sync_poll'",
      ])
        try {
          db.exec(sql);
        } catch {
          /* the table is in another file */
        }
    } finally {
      db.close();
    }
  }
};

test("a pass the cadence starts for a type whose chain went quiet runs as the person who set the sync up", async () => {
  let skew = 0;
  const w = await world(
    true,
    { bulk: 20 },
    {
      now: () => Date.now() + skew,
      // every caller is the owner, a person of the Space (the plain admin token is not one)
      session: () => ({ space: CORE_SPACE, principal: { kind: "person", id: "usr_olivia" }, device: "fixture" }),
    },
  );
  try {
    assert.equal(w.item.status, 200, JSON.stringify(w.item.data));
    const applied = await call(w.d, "sync_specs.apply", { spec: spec("people", 50), idempotencyKey: "apply-cad" });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    await waitFor(
      async () => {
        await pump(w.d);
        return (await rowsOf(w.d, "person")).length >= 22 ? true : null;
      },
      90_000,
      () => hostLog(w.d),
    );
    const who = "usr_olivia";
    quiet(w.dir);
    await new Promise((r) => setTimeout(r, 2500)); // the type is due again
    w.d.sink.flush();
    const lastId = new DatabaseSync(w.d.paths.logs, { readOnly: true });
    const before = (lastId.prepare("SELECT coalesce(max(id), 0) AS n FROM logs").get() as { n: number }).n;
    lastId.close();
    await w.d.hooks!.runPeriodic("connectors.cadence");
    const reads = await waitFor(
      async () => {
        await pump(w.d);
        const r = readsBy(w.d, before);
        return r.length > 0 ? r : null;
      },
      60_000,
      () => `no connectors.read ran after the cadence: ${JSON.stringify(callsSince(w.d, before))}`,
    );
    assert.deepEqual(
      [...new Set(reads.map((r) => `${r.actor} ${r.result}`))],
      [`${who} allow`],
      "every read of the cadence's pass ran as the person who set the sync up, and was allowed",
    );
    const st = (await call(w.d, "sync_types.status", { type: "person" })).data;
    assert.deepEqual(st.failures ?? [], [], "the pass did not fail");
  } finally {
    await w.close();
  }
});

test("a poll job queued as the server before the update is handed to the person who set the sync up when it runs, and the server never reads as itself", async () => {
  const w = await world(
    true,
    { bulk: 20 },
    { session: () => ({ space: CORE_SPACE, principal: { kind: "person", id: "usr_olivia" }, device: "fixture" }) },
  );
  try {
    assert.equal(w.item.status, 200, JSON.stringify(w.item.data));
    const applied = await call(w.d, "sync_specs.apply", {
      spec: spec("people", 50),
      idempotencyKey: "apply-stale-job",
    });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    await waitFor(
      async () => {
        await pump(w.d);
        return (await rowsOf(w.d, "person")).length >= 22 ? true : null;
      },
      90_000,
      () => hostLog(w.d),
    );
    quiet(w.dir);
    // the job an earlier version left in the queue: a poll, scheduled as the server
    for (const f of fs.readdirSync(w.dir).filter((n) => n.endsWith(".db"))) {
      const db = new DatabaseSync(path.join(w.dir, f));
      try {
        db.exec("PRAGMA busy_timeout = 5000");
        db.prepare(
          "INSERT INTO host_schedule (id, space, cap, input, principal_kind, principal_id, acting_for, trace_id, run_at, created_at) VALUES (?, ?, 'connectors.sync_poll', ?, 'service', 'svc_host', NULL, '', ?, ?)",
        ).run(
          "sch_stale_server_poll",
          CORE_SPACE,
          JSON.stringify({ type: "person" }),
          Date.now() - 1000,
          Date.now() - 2000,
        );
      } catch {
        /* the queue is in another file */
      } finally {
        db.close();
      }
    }
    w.d.sink.flush();
    const lastId = new DatabaseSync(w.d.paths.logs, { readOnly: true });
    const before = (lastId.prepare("SELECT coalesce(max(id), 0) AS n FROM logs").get() as { n: number }).n;
    lastId.close();
    const reads = await waitFor(
      async () => {
        await pump(w.d);
        const r = readsBy(w.d, before);
        return r.length > 0 ? r : null;
      },
      60_000,
      () => `no connectors.read ran for the queued poll: ${JSON.stringify(callsSince(w.d, before))}`,
    );
    assert.deepEqual(
      [...new Set(reads.map((r) => `${r.actor} ${r.result}`))],
      ["usr_olivia allow"],
      "the poll ran as the person who set the sync up",
    );
  } finally {
    await w.close();
  }
});
