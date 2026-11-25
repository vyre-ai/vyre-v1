// The daily purge of expired idempotency answers goes in slices and gives its pages back in steps: a month of 100 KB answers (a firm's sync pages: 34 GB of them) must never be one delete the log's single worker
// holds every append behind, and a file the purge emptied must be able to shrink without a VACUUM.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LogClient, LogStore } from "../src/log/index.ts";
import { IdempotencyTable, IDEM_TTL_MS } from "../src/idempotency/index.ts";
import { canReclaim, freePages, reclaimStep } from "../src/log/reclaim.ts";

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-idem-purge-"));
const fill = (db: DatabaseSync, rows: number, bytes: number, at: number): void => {
  const put = db.prepare("INSERT INTO idempotency (key, principal, cap, result, at) VALUES (?, 'usr_a', 'c.x', ?, ?)");
  const blob = new TextEncoder().encode("x".repeat(bytes));
  db.exec("BEGIN");
  for (let i = 0; i < rows; i++) put.run(`k${at}-${i}`, blob, at);
  db.exec("COMMIT");
};

test("a purge slice deletes a few rows and says there is more, until none is due", () => {
  const file = path.join(dir(), "events.db");
  const db = new DatabaseSync(file);
  new LogStore({ db, space: "sp_1" });
  const now = Date.now();
  fill(db, 300, 20_000, now - IDEM_TTL_MS - 1000); // due
  fill(db, 50, 20_000, now); // not due
  const t = new IdempotencyTable(db);
  let slices = 0;
  let deleted = 0;
  for (;;) {
    const r = t.purgeSlice(now, 0); // a budget of nothing: one batch of 20 per slice
    slices++;
    deleted += r.deleted;
    assert.ok(r.deleted <= 20, "a slice with no time to spend deletes one batch");
    if (!r.more) break;
  }
  assert.equal(deleted, 300);
  assert.ok(slices >= 15, `in many slices, not one (${slices})`);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM idempotency").get() as { n: number }).n, 50, "what is not due stays");
  db.close();
});

test("a new events.db gives freed pages back in steps; a file made before cannot, and is never vacuumed", () => {
  const fresh = path.join(dir(), "events.db");
  const db = new DatabaseSync(fresh);
  new LogStore({ db, space: "sp_1" });
  assert.equal(canReclaim(db), true, "auto_vacuum is incremental on a new file");
  const old = Date.now() - IDEM_TTL_MS - 1000;
  fill(db, 400, 30_000, old);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const big = fs.statSync(fresh).size;
  assert.ok(big > 10_000_000);
  new IdempotencyTable(db).purge(Date.now());
  assert.ok(freePages(db) > 1000, "the pages are free but still in the file");
  let steps = 0;
  while (reclaimStep(db, 256) > 0) steps++;
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  assert.ok(steps >= 4, `handed back in steps (${steps})`);
  assert.ok(fs.statSync(fresh).size < big / 4, "and the file is smaller");
  db.close();

  // a file made before: no auto_vacuum, nothing to hand back
  const legacy = path.join(dir(), "events.db");
  const ldb = new DatabaseSync(legacy);
  ldb.exec("CREATE TABLE t (x BLOB)");
  assert.equal(canReclaim(ldb), false);
  assert.equal(reclaimStep(ldb), 0);
  ldb.close();
});

test("the daily purge through the worker leaves the log answering, and takes only what is due", async () => {
  const file = path.join(dir(), "events.db");
  const log = await LogClient.open({ path: file, space: "sp_1" });
  try {
    const side = new DatabaseSync(file);
    side.exec("PRAGMA busy_timeout = 5000");
    fill(side, 500, 10_000, Date.now() - IDEM_TTL_MS - 5000);
    fill(side, 20, 10_000, Date.now());
    const purge = log.purgeIdempotency();
    // the log keeps taking appends while the purge runs
    for (let i = 0; i < 5; i++)
      await log.append({
        type: "record.updated",
        sv: 1,
        trace_id: "a".repeat(32),
        actor: "usr_dana",
        vis: "space",
        entity: "rec",
        entity_id: `r${i}`,
        fields: ["name"],
        payload: { i },
      });
    assert.equal(await purge, 500);
    assert.equal((side.prepare("SELECT COUNT(*) AS n FROM idempotency").get() as { n: number }).n, 20);
    side.close();
  } finally {
    await log.close();
  }
});
