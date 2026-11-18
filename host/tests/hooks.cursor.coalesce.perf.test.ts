// The speed half of hooks.cursor.coalesce.test.ts (a perf file, ruling 46): a hundred consumers moving past a busy head, stored in a real SQLite file. r38 profile on the firm's server: 2,526 ms of 90 s in cursor writes.
// Measured on box D: 75,177 ms before, 126 ms after.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHookRunner } from "../src/daemon/consumers.ts";
import type { ModuleHooks } from "../src/daemon/consumers.ts";
import type { Invoke } from "../src/invoke.ts";

/** The budget for 200 passes of a hundred consumers, in ms (the best of three runs). */
export const CURSORS_200_BUDGET_MS = 500;

test("cursors200: two hundred passes of a hundred consumers moving past a busy head are stored inside the speed budget", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-cursor-perf-"));
  const sql = new DatabaseSync(path.join(dir, "m.db"));
  sql.exec("CREATE TABLE host_hook_cursor (name TEXT PRIMARY KEY, seq INTEGER NOT NULL, at INTEGER NOT NULL)");
  const names = Array.from({ length: 100 }, (_, i) => `m.n${i}`);
  const hooks: ModuleHooks[] = [
    {
      module: "m",
      periodic: [],
      consumers: names.map((name) => ({ name, module: "m", on: ["never"], run: async () => undefined })) as never,
    },
  ];
  let head = 0;
  const r = createHookRunner({
    space: "spc_t",
    now: () => 1,
    invoke: (async () => ({ status: "ok", output: null, traceId: "t" })) as unknown as Invoke,
    emitsOf: () => [],
    capOf: () => undefined,
    warn: () => undefined,
    hooks,
    db: {
      all: (q: string, ...a: unknown[]) => sql.prepare(q).all(...(a as never[])) as never,
      run: (q: string, ...a: unknown[]) => {
        const res = sql.prepare(q).run(...(a as never[]));
        return { changes: Number(res.changes) };
      },
    },
    log: { read: async () => [] as never, currentHead: async () => ({ seq: head }) },
  } as never);
  await r.start();
  const runs: number[] = [];
  for (let run = 0; run < 3; run++) {
    const t = performance.now();
    for (let i = 0; i < 200; i++) {
      head += 1;
      await r.pump();
    }
    runs.push(performance.now() - t);
  }
  const best = Math.min(...runs);
  console.log(`cursors200 best ${best.toFixed(0)} ms (runs ${runs.map((x) => x.toFixed(0)).join(", ")})`);
  assert.ok(best <= CURSORS_200_BUDGET_MS, `200 passes took ${best.toFixed(0)} ms, budget ${CURSORS_200_BUDGET_MS}`);
  sql.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
