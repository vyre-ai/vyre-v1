// Startup budget (perf/budgets.json "startup": app.usable p50 1000 ms on a mid laptop). The replica read path is a slice of it:
// key unwrap, engine unlock, schema check and prepared statements on a 200,000-row replica must leave most of that budget free.
// Node run with the keyed-file doubles over node:sqlite; the browser number for the same shape (sqlite3mc on OPFS, 200k rows reopen 77 ms) is spike S5, run 40109672513.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createReplicaKeyVault, memoryKeyBox, openDeviceReplica, slotOf } from "../src/device/index.ts";
import { createFakeMc } from "../src/device/testing.ts";

const ROWS = 200_000;
const OPEN_BUDGET_MS = 500; // half the 1000 ms app.usable budget
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

test("startup: open a 200k-row replica through key unwrap, unlock and first read under the replica budget", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-startup-"));
  const mc = createFakeMc(dir);
  const vault = createReplicaKeyVault(memoryKeyBox());
  const base = {
    target: "web" as const, spaceId: "spc_big", deviceId: "dev_1", vault, personKey: new Uint8Array(32).fill(5),
    openers: { sqlite3mc: { mod: mc.mod, vfs: "opfs-sahpool" } }, registryHash: "hash-startup", personId: "prs_me",
  };

  const seed = await openDeviceReplica(base);
  assert.equal(seed.keyCreated, true);
  const insert = seed.driver.prepare('INSERT INTO "calendar_event" (id, calendarId, title) VALUES (?, ?, ?)');
  const t0 = performance.now();
  seed.driver.transaction(() => {
    for (let i = 0; i < ROWS; i++) insert.run([`evt_${i}`, `cal_${i % 50}`, `Event ${i}`]);
  });
  const seedMs = performance.now() - t0;
  await seed.store.close();

  const opens: number[] = [];
  const reads: number[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await openDeviceReplica(base);
    assert.equal(r.keyCreated, false);
    const t1 = performance.now();
    const row = r.store.read("calendar_event", `evt_${ROWS - 1}`);
    reads.push(performance.now() - t1);
    assert.equal(row?.title, `Event ${ROWS - 1}`);
    const count = r.driver.prepare('SELECT count(*) AS n FROM "calendar_event"').get([]);
    assert.equal(Number(count?.n), ROWS);
    opens.push(r.openMs);
    await r.store.close();
  }
  const open = median(opens);
  const read = median(reads);
  console.log(`# perf startup replica rows=${ROWS} seed_ms=${seedMs.toFixed(0)} open_median_ms=${open.toFixed(1)} open_max_ms=${Math.max(...opens).toFixed(1)} first_read_median_ms=${read.toFixed(2)} budget_ms=${OPEN_BUDGET_MS} (engine double over node:sqlite)`);
  assert.ok(open < OPEN_BUDGET_MS, `replica open ${open.toFixed(1)} ms is over ${OPEN_BUDGET_MS} ms`);
  assert.ok(read < 50, `first read ${read.toFixed(2)} ms is over 50 ms`);
  assert.ok(await vault.has(slotOf("spc_big", "dev_1")));
});
