// The speed half of test-run.test.ts (a separate file so only this one is a perf file, ruling 46): the watchdog stops a file that runs past its cap within 1.5 s of the cap.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runFile } from "./test-run.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trun-perf-"));
const fixture = path.join(dir, "slowish.test.mjs");
fs.writeFileSync(fixture, [
  'import test from "node:test";',
  'test("fast one", () => {});',
  'test("takes a while", async () => { await new Promise((r) => setTimeout(r, 1600)); });',
].join("\n") + "\n");

test("the watchdog stops a file that runs past a 1 s cap within 2.5 s", async () => {
  const r = await runFile(fixture, { cwd: dir, capMs: 1000 });
  assert.equal(r.overCap, true);
  console.log("METRIC " + JSON.stringify({ name: "file_cap.watchdog", cap_ms: 1000, stopped_after_ms: r.ms, budget_ms: 1000 + 1500, pass: r.ms < 2500 }));
  assert.ok(r.ms < 2500, `watchdog took ${r.ms} ms to stop a 1000 ms cap`);
});
