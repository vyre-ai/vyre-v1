// Golden replay of Automations (spec 2.12; ported from kernel/flows/golden-replay.test.js): every recorded scenario gives the same ledger twice, and the ledger is the one in golden.json.
// A change that moves a byte of it fails here and names the scenario. If the change is meant, `VYRE_GOLDEN_WRITE=1 node --test modules/automations/tests/golden-replay/replay.test.ts` rewrites golden.json,
// and the diff is what a reviewer reads.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { SCENARIOS } from "./scenarios.ts";
import type { Ledger } from "./scenarios.ts";

const FILE = new URL("./golden.json", import.meta.url);
const record = async (name: string): Promise<Ledger> => JSON.parse(JSON.stringify(await SCENARIOS[name]!.run())) as Ledger;

test("replay: a scenario's ledger is the same every time", async () => {
  for (const name of Object.keys(SCENARIOS)) {
    assert.deepEqual(await record(name), await record(name), `${name}: two runs of the same scenario differ (an id or a time got into the ledger)`);
  }
});

test("replay: every scenario's ledger is the golden file's", async () => {
  if (process.env.VYRE_GOLDEN_WRITE === "1") {
    const all: Record<string, Ledger> = {};
    for (const name of Object.keys(SCENARIOS)) all[name] = await record(name);
    writeFileSync(FILE, `${JSON.stringify(all, null, 2)}\n`);
  }
  const golden = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, Ledger>;
  assert.deepEqual(Object.keys(golden).sort(), Object.keys(SCENARIOS).sort(), "the golden file and the scenarios name the same things");
  for (const name of Object.keys(SCENARIOS)) assert.deepEqual(await record(name), golden[name], `${name}: the replay differs from the golden file`);
});

test("replay: recorded Runs keep the version and principal they started with", async () => {
  const golden = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, { runs: { version: number; principal: string; parentRun: string | null }[] }>;
  const runs = golden["versions: a Run keeps the version it started on, replay picks same or current"]!.runs;
  assert.deepEqual(runs.map((r) => r.version), [1, 2, 1, 2]);
  assert.deepEqual(runs.map((r) => r.parentRun), [null, null, "run_t1", "run_t1"]);
  assert.ok(runs.every((r) => r.principal === "person:usr_alice"));
});
