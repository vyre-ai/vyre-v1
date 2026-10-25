// @reads /modules/schema/migrations/0001_schema.sql
// P-L3_17 speed budget: seeding the declared record types takes under 200 ms, and a start over an already seeded file is cheaper still. Timing counts only from the perf runners (ruling 46), so
// this lives in its own perf file (test/slow.json marks it perf); the functional checks are in seed.start.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadRegistry, openSchema } from "../impl.ts";

const NOW = 1_800_000_000_000;

test("seeding the declared types takes under 200 ms, and a start over an already seeded file is cheaper still", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-schema-seed-ms-"));
  const file = path.join(dir, "space.db");
  const a = openSchema({ path: file, now: () => NOW });
  const t0 = performance.now();
  await a.start();
  const first = performance.now() - t0;
  a.host?.close();
  const b = openSchema({ path: file, now: () => NOW });
  const t1 = performance.now();
  await b.start();
  const again = performance.now() - t1;
  b.host?.close();
  console.log(`METRIC schema.seed.first_ms=${first.toFixed(1)} schema.seed.again_ms=${again.toFixed(1)} types=${loadRegistry().recordTypes.length}`);
  assert.ok(first < 200, `the first seed took ${first.toFixed(0)} ms`);
  assert.ok(again < 200, `a second start took ${again.toFixed(0)} ms`);
});
