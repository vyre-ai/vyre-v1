// waitForScheduled: the loop lag the daemon reports DURING a wait is credited to it (at most half the base), nothing else is, and a stall larger than the
// base fails the wait at once.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loopLagMs, waitForScheduled } from "./eco-live.ts";

function fakeDaemon(lags: number[]): { d: never; add: (lag: number) => void; done: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wait-"));
  const file = path.join(dir, "logs.db");
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE logs (id INTEGER PRIMARY KEY, level INTEGER, place TEXT, cap TEXT, msg TEXT, attrs TEXT)");
  const add = (lag: number): void => {
    db.prepare(
      "INSERT INTO logs (level, place, cap, msg, attrs) VALUES (40, NULL, NULL, 'scheduler.loop_blocked', ?)",
    ).run(JSON.stringify({ lagMs: lag, jobs: [] }));
  };
  for (const lag of lags) add(lag);
  db.prepare("INSERT INTO logs (level, place, cap, msg, attrs) VALUES (40, NULL, NULL, 'other', 'not json {')").run();
  return {
    d: { sink: { flush() {} }, paths: { logs: file } } as never,
    add,
    done: () => {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("the loop lag the daemon reported is summed; other lines and bad attributes count for nothing", () => {
  const { d, done } = fakeDaemon([260, 667, 3883]);
  try {
    assert.equal(loopLagMs(d), 260 + 667 + 3883);
  } finally {
    done();
  }
});

test("a stall reported during the wait extends it (at most by half); the same arrival with no stall fails", async () => {
  const w = fakeDaemon([]);
  const t0 = Date.now();
  setTimeout(() => w.add(200), 100); // the daemon reports 200 ms blocked while the wait runs
  try {
    assert.equal(await waitForScheduled(w.d, () => Promise.resolve(Date.now() - t0 > 400 ? true : null), 300), true);
  } finally {
    w.done();
  }
  const quiet = fakeDaemon([]);
  const t1 = Date.now();
  try {
    await assert.rejects(
      waitForScheduled(quiet.d, () => Promise.resolve(Date.now() - t1 > 900 ? true : null), 300),
      /never happened within 300 ms plus 0 ms/,
    );
  } finally {
    quiet.done();
  }
});

test("lag reported before the wait started is not credited", async () => {
  const w = fakeDaemon([5000]); // boot hooks, earlier steps
  const t0 = Date.now();
  try {
    await assert.rejects(
      waitForScheduled(w.d, () => Promise.resolve(Date.now() - t0 > 900 ? true : null), 300),
      /plus 0 ms/,
    );
  } finally {
    w.done();
  }
});

test("the credit is at most half the base: a stall of more than that does not buy more time", async () => {
  const w = fakeDaemon([]);
  const t0 = Date.now();
  setTimeout(() => w.add(250), 50); // 250 ms reported, base 300 ms: the credit is 150 ms, so 450 ms in all
  try {
    await assert.rejects(
      waitForScheduled(w.d, () => Promise.resolve(Date.now() - t0 > 2000 ? true : null), 300),
      /plus 150 ms/,
    );
    assert.ok(Date.now() - t0 < 1500);
  } finally {
    w.done();
  }
});

test("a stall larger than the whole base is the fault, not the runner: the wait fails at once", async () => {
  const w = fakeDaemon([]);
  setTimeout(() => w.add(900), 50);
  const t0 = Date.now();
  try {
    await assert.rejects(
      waitForScheduled(w.d, () => Promise.resolve(null), 300),
      /reported its loop blocked for 900 ms during a 300 ms wait/,
    );
    assert.ok(Date.now() - t0 < 1000);
  } finally {
    w.done();
  }
});
