import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/daemon/sqlite.ts";
import { startCheckpointer } from "../src/daemon/checkpointer.ts";

const walSize = (f: string): number => {
  try {
    return fs.statSync(`${f}-wal`).size;
  } catch {
    return 0;
  }
};

test("with the checkpointer, a commit past 1,000 pages is not a checkpoint, and the worker brings the log back into the file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-cp-"));
  const file = path.join(dir, "m.db");
  const db = openDb(file);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  const cp = startCheckpointer(db, file, { minBytes: 256 * 1024, everyMs: 50 });
  try {
    assert.equal((db.all("PRAGMA wal_autocheckpoint")[0] as Record<string, number>)["wal_autocheckpoint"], 0);
    const blob = "x".repeat(2000);
    for (let i = 0; i < 6000; i++) db.run("INSERT INTO t (v) VALUES (?)", blob); // ~12 MB: SQLite's own checkpoint would have run a dozen times
    const grown = walSize(file);
    assert.ok(grown > 4 * 1024 * 1024, `the log grew to ${grown} bytes with no checkpoint on the main thread`);
    // the worker checkpoints (PASSIVE; here only looked at, NOOP): everything in the log is in the file, so the log is reused from its start
    let backfilled = false;
    for (let i = 0; i < 100 && !backfilled; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const r = db.all("PRAGMA wal_checkpoint(NOOP)")[0] as Record<string, number>;
      backfilled = r["log"] === r["checkpointed"];
    }
    assert.ok(backfilled, "the worker checkpointed the log (NOOP reads the counters and does nothing)");
    assert.equal((db.all("SELECT COUNT(*) AS n FROM t")[0] as { n: number }).n, 6000);
  } finally {
    await cp.stop();
    assert.equal((db.all("PRAGMA wal_autocheckpoint")[0] as Record<string, number>)["wal_autocheckpoint"], 1000, "stopped: SQLite's own checkpoint is back");
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
