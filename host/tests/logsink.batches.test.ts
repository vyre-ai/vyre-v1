// The log sink writes in small batches and gives the event loop back between them (r39: its flush and the mirror's write held the loop 643 ms and 365 ms in a minute on the firm's server). No line is lost or
// reordered: fifty thousand lines written while other work competes for the loop are all read back, in the order they were written, in logs.db and counted by the mirror.
// @reads ../../modules/logs/migrations/0001_init.sql
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { FLUSH_BATCH, LogSink } from "../src/logsink/index.ts";
import { openDb } from "../src/daemon/sqlite.ts";
import { createTelemetryRecorder } from "../src/seams/telemetry.ts";
import * as logsModule from "../../modules/logs/telemetry.ts";

const SPACE = "spc_batches";
const MIGRATIONS = path.join(path.dirname(new URL(import.meta.url).pathname), "../../modules/logs/migrations");

test("one flush writes one small batch in one transaction, and the rest waits for the next turn of the loop", async () => {
  const sink = new LogSink({ batchMs: 60_000 });
  for (let i = 0; i < FLUSH_BATCH * 3 + 7; i++)
    sink.log({ space: SPACE, level: 20, msg: "service.state", attrs: { i } });
  sink.flush();
  assert.equal(sink.db.prepare("SELECT COUNT(*) AS n FROM logs").get()?.n, FLUSH_BATCH, "a batch, not the backlog");
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.ok(Number(sink.db.prepare("SELECT COUNT(*) AS n FROM logs").get()?.n) > FLUSH_BATCH, "the next turn went on");
  sink.close();
  assert.equal(sink.db.constructor, DatabaseSync);
});

test("fifty thousand lines under load are all read back in order, in logs.db and in the mirror's checkpoint", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sink-batches-"));
  try {
    const mirrorDb = openDb(path.join(dir, "modules.db"));
    for (const f of fs.readdirSync(MIGRATIONS).sort()) mirrorDb.exec(fs.readFileSync(path.join(MIGRATIONS, f), "utf8"));
    const recorder = createTelemetryRecorder({
      space: SPACE,
      db: mirrorDb,
      module: logsModule as unknown as Record<string, unknown>,
      now: Date.now,
      secrets: () => [],
      capabilities: [],
    })!;
    const sink = new LogSink({ path: path.join(dir, "logs.db"), batchMs: 5 });
    sink.setObserver(recorder.write, recorder.position(sink.sourceId));
    // other work competing for the loop: a timer that spends a few milliseconds each time it runs
    let busy = 0;
    const load = setInterval(() => {
      const end = performance.now() + 2;
      while (performance.now() < end) busy++;
    }, 1);
    const N = 50_000;
    for (let i = 0; i < N; i++) {
      sink.log({ space: SPACE, level: 20, msg: "service.state", attrs: { i } });
      if (i % 2_000 === 1_999) await new Promise((r) => setImmediate(r));
    }
    // everything waits to be written; it goes on while the loop is shared, and stops when it is all down
    const until = Date.now() + 120_000;
    while (Date.now() < until) {
      const n = Number(sink.db.prepare("SELECT COUNT(*) AS n FROM logs").get()?.n);
      if (n === N && recorder.position(sink.sourceId).rowId === N) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    clearInterval(load);
    assert.ok(busy > 0);
    const rows = sink.db.prepare("SELECT id, attrs FROM logs ORDER BY id").all() as { id: number; attrs: string }[];
    assert.equal(rows.length, N, "no line lost");
    for (let i = 0; i < N; i++) {
      assert.equal(rows[i]!.id, i + 1, "ids run unbroken");
      if ((JSON.parse(rows[i]!.attrs) as { i: number }).i !== i) assert.fail(`line ${i} is out of order`);
    }
    assert.equal(recorder.position(sink.sourceId).rowId, N, "the mirror's checkpoint is at the last line");
    const mirrored = Number((mirrorDb.all("SELECT COUNT(*) AS n FROM logs_row")[0] as { n: number }).n);
    assert.equal(mirrored, N, "and it holds every line");
    sink.close();
    mirrorDb.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
