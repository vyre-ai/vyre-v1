// The modules.db mirror of logs.db keeps to running caps: host spans for a week, a span and a row cap, pruned in small transactions with the daemon free between them. Rows the host only
// counted (a poll's job.ran, invoke.reads) never enter it. modules.db is vacuumed only in small steps, and only when it was made for that.
// @reads ../migrations/0001_init.sql
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../../../host/src/daemon/sqlite.ts";
import type { HostDb } from "../../../host/src/daemon/sqlite.ts";
import { createTelemetryRecorder } from "../../../host/src/seams/telemetry.ts";
import * as logs from "../telemetry.ts";
import { capTelemetry, ROW_CAP, SPAN_CAP, TELEMETRY_KEEP_MS } from "../telemetry.ts";

// the shipped caps, and the small ones these tests fill past
const CAPS = { spans: 6_000, rows: 6_000 };
import { placeHold } from "../handlers/sink.ts";

const SPACE = "spc_caps";
const T0 = 1_800_000_000_000;
const DAY = 86_400_000;
const MIGRATIONS = path.join(path.dirname(new URL(import.meta.url).pathname), "../migrations");

function mirror(o: { incremental?: boolean } = {}): { db: HostDb; file: string } {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-mirror-")), "modules.db");
  if (o.incremental) { const first = openDb(file); first.exec("PRAGMA auto_vacuum = INCREMENTAL"); first.exec("VACUUM"); first.close(); }
  const db = openDb(file);
  for (const f of fs.readdirSync(MIGRATIONS).sort()) db.exec(fs.readFileSync(path.join(MIGRATIONS, f), "utf8"));
  return { db, file };
}
const count = (db: HostDb, table: string): number => Number((db.all(`SELECT COUNT(*) AS n FROM ${table}`)[0] as { n: number }).n);
function spans(db: HostDb, n: number, at: (i: number) => number, from = 0): void {
  db.tx(() => { for (let i = from; i < from + n; i++) db.run("INSERT INTO logs_span (space, trace_id, span_id, parent, name, at, dur_us, attrs) VALUES (?, ?, ?, NULL, 'invoke', ?, 1, NULL)", SPACE, i.toString(16).padStart(32, "0"), "a".repeat(16), at(i)); });
}
function rows(db: HostDb, n: number, at: (i: number) => number): void {
  db.tx(() => { for (let i = 0; i < n; i++) db.run("INSERT INTO logs_row (at, level, space, cap, result, msg) VALUES (?, 20, ?, 'x.get', 'ok', 'invoke')", at(i), SPACE); });
}
const step = (db: HostDb, now: number): number => db.tx(() => capTelemetry({ space: SPACE, db, now: () => now, caps: CAPS }));

test("spans older than a week go in batches of at most 2,000, oldest first, and the young stay", () => {
  const { db } = mirror();
  spans(db, 5000, (i) => T0 - 8 * DAY + i);
  spans(db, 10, (i) => T0 - DAY + i, 5000);
  const removed: number[] = [];
  for (let n = step(db, T0); n; n = step(db, T0)) removed.push(n);
  assert.deepEqual(removed, [2000, 2000, 1000]);
  assert.equal(count(db, "logs_span"), 10);
  assert.equal(TELEMETRY_KEEP_MS, 7 * DAY);
  db.close();
});

test("over the span cap the oldest spans go, a batch at a time, until the cap holds", () => {
  const { db } = mirror();
  assert.equal(SPAN_CAP, 200_000);
  spans(db, CAPS.spans + 2500, (i) => T0 - DAY + i);
  while (step(db, T0)) { /* batches */ }
  assert.equal(count(db, "logs_span"), CAPS.spans - 1500, "two batches of 2,000: the second ends under the cap");
  assert.equal((db.all("SELECT MIN(at) AS m FROM logs_span")[0] as { m: number }).m, T0 - DAY + 4000);
  db.close();
});

test("rows past the full-detail window and rows over the row cap fold into the per-day aggregates", () => {
  const { db } = mirror();
  rows(db, 3000, (i) => T0 - 40 * DAY + i);
  assert.equal(ROW_CAP, 200_000);
  rows(db, CAPS.rows + 100, (i) => T0 - DAY + i);
  while (step(db, T0)) { /* batches */ }
  assert.equal(count(db, "logs_row"), CAPS.rows + 100 - 2000, "the 3,000 old rows, then one 2,000 batch for the cap");
  const agg = db.all("SELECT SUM(n_rows) AS n FROM logs_aggregate")[0] as { n: number };
  assert.equal(agg.n, 5000, "nothing removed is lost from the daily counts");
  db.close();
});

test("a hold on the logs stops the caps", () => {
  const { db } = mirror();
  spans(db, 100, (i) => T0 - 30 * DAY + i);
  placeHold(db, SPACE, "hold_1");
  assert.equal(step(db, T0), 0);
  assert.equal(count(db, "logs_span"), 100);
  db.close();
});

test("the recorder runs the caps in short transactions and gives pages back only to a modules.db made for incremental vacuum", async () => {
  for (const incremental of [false, true]) {
    const { db, file } = mirror({ incremental });
    spans(db, 30_000, (i) => T0 - 10 * DAY + i);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const before = fs.statSync(file).size;
    const rec = createTelemetryRecorder({ space: SPACE, db, module: logs as unknown as Record<string, unknown>, now: () => T0, secrets: () => [], capabilities: [] })!;
    let txs = 0;
    const tx = db.tx.bind(db);
    db.tx = (fn) => { txs++; return tx(fn); };
    assert.equal(await rec.cap(5), 10_000, "five rounds of 2,000");
    assert.equal(txs, 5, "one transaction per round");
    assert.equal(await rec.cap(), 20_000);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const after = fs.statSync(file).size;
    if (incremental) assert.ok(after < before, `incremental: the file gave pages back (${before} -> ${after})`);
    else assert.equal(after, before, "no vacuum on a file not made for it: the pages are kept for reuse");
    db.close();
  }
});

test("rows the host only counted never enter the mirror; failures and changes do", () => {
  const { db } = mirror();
  const rec = createTelemetryRecorder({ space: SPACE, db, module: logs as unknown as Record<string, unknown>, now: () => T0, secrets: () => [], capabilities: ["x.get"] })!;
  db.run("INSERT INTO logs_settings (space, level, full_days, aggregate_days) VALUES (?, 10, 30, 180)", SPACE);
  const row = (msg: string, level: number, attrs?: Record<string, unknown>) => ({ at: T0, space: SPACE, level, msg, ...(attrs ? { attrs } : {}) });
  rec.write({ source: "src", position: { rowId: 4, spanId: 0 }, spans: [], rows: [row("job.ran", 10, { count: 3600, ms: 900 }), row("invoke.reads", 10, { count: 50, ms: 70 }), row("job.ran", 10), row("invoke", 20, { count: 4, status: "error" })] });
  assert.deepEqual((db.all("SELECT msg, level FROM logs_row ORDER BY id") as { msg: string; level: number }[]).map((r) => [r.msg, r.level]), [["job.ran", 10], ["invoke", 20]]);
  db.close();
});
