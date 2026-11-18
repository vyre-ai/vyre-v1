// The speed half of logsink.batches.test.ts (a perf file, ruling 46): how long the log sink holds the event loop. Fifty thousand lines go through the sink and the mirror's write while a timer measures how late it
// runs; the longest wait is the longest the loop was held. r39 profile on the firm's server: 643 ms of flush, 383 ms of observe and 365 ms of the mirror's write in 60 s.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LogSink } from "../src/logsink/index.ts";
import { openDb } from "../src/daemon/sqlite.ts";
import { createTelemetryRecorder } from "../src/seams/telemetry.ts";
import * as logsModule from "../../modules/logs/telemetry.ts";

/** The longest the loop may be held while fifty thousand lines are written, in ms (the best of three runs), and the time the whole write may take. */
export const LOOP_HELD_BUDGET_MS = 60;
export const WRITE_BUDGET_MS = 20_000;
const MIGRATIONS = path.join(path.dirname(new URL(import.meta.url).pathname), "../../modules/logs/migrations");

test("logsink50k: fifty thousand lines through the sink and the mirror hold the loop for no more than the budget", async () => {
  const held: number[] = [];
  const took: number[] = [];
  for (let run = 0; run < 3; run++) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sink-perf-"));
    try {
      const mirrorDb = openDb(path.join(dir, "modules.db"));
      for (const f of fs.readdirSync(MIGRATIONS).sort()) mirrorDb.exec(fs.readFileSync(path.join(MIGRATIONS, f), "utf8"));
      const recorder = createTelemetryRecorder({
        space: "spc_perf",
        db: mirrorDb,
        module: logsModule as unknown as Record<string, unknown>,
        now: Date.now,
        secrets: () => [],
        capabilities: [],
      })!;
      const sink = new LogSink({ path: path.join(dir, "logs.db"), batchMs: 5 });
      sink.setObserver(recorder.write, recorder.position(sink.sourceId));
      let worst = 0;
      let last = performance.now();
      const watch = setInterval(() => {
        const now = performance.now();
        worst = Math.max(worst, now - last - 1);
        last = now;
      }, 1);
      const t0 = performance.now();
      for (let i = 0; i < 50_000; i++) {
        sink.log({ space: "spc_perf", level: 20, msg: "service.state", attrs: { i, state: "running" } });
        if (i % 500 === 499) await new Promise((r) => setImmediate(r));
      }
      while (recorder.position(sink.sourceId).rowId < 50_000) await new Promise((r) => setTimeout(r, 5));
      took.push(performance.now() - t0);
      clearInterval(watch);
      held.push(worst);
      sink.close();
      mirrorDb.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const best = Math.min(...held);
  console.log(
    `logsink50k loop held at most ${best.toFixed(0)} ms (runs ${held.map((x) => x.toFixed(0)).join(", ")}); write took ${Math.min(...took).toFixed(0)} ms`,
  );
  assert.ok(best <= LOOP_HELD_BUDGET_MS, `the loop was held ${best.toFixed(0)} ms, budget ${LOOP_HELD_BUDGET_MS}`);
  assert.ok(Math.min(...took) <= WRITE_BUDGET_MS, `the write took ${Math.min(...took).toFixed(0)} ms, budget ${WRITE_BUDGET_MS}`);
});
