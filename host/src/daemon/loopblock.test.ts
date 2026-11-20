// A large Space (a firm's 280,000 records, Nov 2026) froze the server for 10 to 50 s at a time: background passes did their work in one synchronous stretch. Each pass now works in slices of at most
// 20 ms and lets the event loop run between them. Here a backlog of events whose work costs a few ms each is run through the pass, and the longest stretch the loop was held is measured.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openRecordStore } from "../../../kernel/src/store/records.ts";
import type { StoredEvent } from "../../../kernel/src/log/index.ts";
import type { AsyncConsumer } from "../../../kernel/src/store/projection.ts";
import { ScheduleQueue } from "../ctx/schedule.ts";
import { createProjectionRunner } from "./projections.ts";
import type { HostDb } from "./sqlite.ts";

const BUDGET_MS = 100;
const busy = (ms: number): void => {
  const end = performance.now() + ms;
  while (performance.now() < end);
};
/** The longest time the loop went without running a 2 ms timer. */
function watchLoop(): { stop(): Promise<number> } {
  let last = performance.now(),
    max = 0;
  const t = setInterval(() => {
    const at = performance.now();
    max = Math.max(max, at - last - 2);
    last = at;
  }, 2);
  return {
    stop: async () => {
      await new Promise<void>((r) => setTimeout(r, 10)); // the timer's turn: a block that ended with the pass is seen only when the loop next runs it
      clearInterval(t);
      return Math.round(max);
    },
  };
}

test("a projection pass over a backlog of heavy events never holds the loop past the budget", async () => {
  const raw = new DatabaseSync(":memory:");
  const db = {
    run: (sql: string, ...a: never[]) => {
      const r = raw.prepare(sql).run(...a);
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    all: (sql: string, ...a: never[]) => raw.prepare(sql).all(...a),
    exec: (sql: string) => raw.exec(sql),
    tx: <T>(fn: () => T): T => fn(),
    close: () => raw.close(),
  } as unknown as HostDb;
  let cursorWrites = 0;
  const run = db.run.bind(db);
  (db as { run: unknown }).run = (sql: string, ...a: never[]) => {
    if (/INSERT INTO host_projection_cursor/.test(sql)) cursorWrites++;
    return (run as (q: string, ...x: never[]) => unknown)(sql, ...a);
  };
  const events = Array.from(
    { length: 1000 },
    (_, i) => ({ seq: i + 1, type: "record.created" }) as unknown as StoredEvent,
  );
  let handled = 0;
  const p: AsyncConsumer = {
    name: "test.heavy",
    version: 1,
    mode: "async",
    on: {
      "record.created": () => {
        busy(3); // a record of several hundred fields: one search document, one row of a table
        handled++;
      },
    },
  } as unknown as AsyncConsumer;
  const runner = createProjectionRunner({
    now: () => Date.now(),
    db,
    log: {
      read: async (q) => events.filter((e) => e.seq > (q.after ?? 0)).slice(0, q.limit ?? 200),
      currentHead: async () => ({ seq: 0 }),
    },
    projections: [p],
    warn: () => undefined,
  });
  await runner.start(); // a projection first seen starts at the head: put it back to 0 for the backlog
  db.run("UPDATE host_projection_cursor SET seq = 0");
  const w = watchLoop();
  await runner.pump();
  const max = await w.stop();
  assert.equal(handled, 1000);
  assert.equal(
    db
      .all("SELECT seq FROM host_projection_cursor WHERE name = 'test.heavy'")
      .map((r) => (r as { seq: number }).seq)[0],
    1000,
    "the cursor ends at the last event",
  );
  assert.ok(cursorWrites <= 200, `${cursorWrites} cursor writes for 1,000 events: one each slice, not one each event`);
  assert.ok(max <= BUDGET_MS, `the loop was held for ${max} ms (budget ${BUDGET_MS} ms)`);
});

test("a schedule tick with fifty due jobs never holds the loop past the budget", async () => {
  const db = openRecordStore({ path: ":memory:", space: "sp_lb" }).host.tx;
  let ran = 0;
  const q = new ScheduleQueue({
    db,
    batch: 50,
    run: async () => {
      busy(5); // the start of a sync pass or a poll
      ran++;
    },
  });
  for (let i = 0; i < 50; i++)
    await q.add({ space: "spc_1", principal: { kind: "person", id: "usr_dana" } }, 0, "connectors.sync_poll", {
      type: `t${i}`,
    });
  const w = watchLoop();
  await q.tick();
  const max = await w.stop();
  assert.equal(ran, 50);
  assert.ok(max <= BUDGET_MS, `the loop was held for ${max} ms (budget ${BUDGET_MS} ms)`);
});
