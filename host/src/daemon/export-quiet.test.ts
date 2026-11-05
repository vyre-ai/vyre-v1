import test from "node:test";
import assert from "node:assert/strict";
import { isExportItself, waitForQuiet } from "./export-quiet.ts";

test("an export waits for the saves in progress and goes on once they finish", async () => {
  let writing = 2;
  setTimeout(() => { writing = 1; }, 20);
  setTimeout(() => { writing = 0; }, 50);
  assert.equal(await waitForQuiet(() => writing, { stepMs: 5, maxSteps: 100 }), true);
});

test("a Space that is quiet answers at once, and one that never goes quiet answers false after the wait", async () => {
  assert.equal(await waitForQuiet(() => 0), true);
  const t0 = Date.now();
  assert.equal(await waitForQuiet(() => 1, { stepMs: 5, maxSteps: 6 }), false);
  assert.ok(Date.now() - t0 < 1000);
});

test("the export does not count itself among the saves it waits for", () => {
  assert.equal(isExportItself("spaces.export"), true);
  assert.equal(isExportItself("spaces.update"), false);
});
