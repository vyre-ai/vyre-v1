// waitForScheduled: the time the daemon reports its own loop blocked is credited to a wait on something its scheduler does; nothing else is.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loopLagMs, waitForScheduled } from "./eco-live.ts";

function fakeDaemon(lags: number[]): { d: never; done: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wait-"));
  const file = path.join(dir, "logs.db");
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE logs (id INTEGER PRIMARY KEY, level INTEGER, place TEXT, cap TEXT, msg TEXT, attrs TEXT)");
  for (const lag of lags)
    db.prepare(
      "INSERT INTO logs (level, place, cap, msg, attrs) VALUES (40, NULL, NULL, 'scheduler.loop_blocked', ?)",
    ).run(JSON.stringify({ lagMs: lag, jobs: [] }));
  db.prepare("INSERT INTO logs (level, place, cap, msg, attrs) VALUES (40, NULL, NULL, 'other', 'not json {')").run();
  db.close();
  return {
    d: { sink: { flush() {} }, paths: { logs: file } } as never,
    done: () => fs.rmSync(dir, { recursive: true, force: true }),
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

test("a thing that arrives after the plain deadline but inside the reported stall is waited for; without the stall it fails", async () => {
  const t0 = Date.now();
  const arrives = (): Promise<true | null> => Promise.resolve(Date.now() - t0 > 900 ? true : null);
  const stalled = fakeDaemon([1500]);
  try {
    assert.equal(await waitForScheduled(stalled.d, arrives, 300), true);
  } finally {
    stalled.done();
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

test("a thing that never happens still fails once the credit is spent", async () => {
  const { d, done } = fakeDaemon([400]);
  const t0 = Date.now();
  try {
    await assert.rejects(
      waitForScheduled(d, () => Promise.resolve(null), 300),
      /plus 400 ms/,
    );
    assert.ok(Date.now() - t0 < 5000);
  } finally {
    done();
  }
});
