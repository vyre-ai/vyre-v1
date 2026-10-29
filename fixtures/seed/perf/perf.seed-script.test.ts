// P-L11_03: scripts/seed-perf.ts builds the template, finds it again and refuses an unknown scale. Its own file: with the builder checks in perf.seed.test.ts the three builds took about 115 s of the 120 s cap on the shared CI hosts (10 s on an idle machine).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PERF_SIZES } from "./build.ts";
import { seedPerf } from "../../../scripts/seed-perf.ts";

const scratch = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "perf-seed-script-"));

test("scripts/seed-perf.ts: builds then finds the template, and refuses an unknown scale", async () => {
  const dir = scratch();
  const one = await seedPerf(["--scale", "ci", "--cache", dir]);
  const two = await seedPerf(["--scale", "ci", "--cache", dir]);
  assert.deepEqual([one.hit, two.hit], [false, true]);
  assert.equal(one.key, two.key);
  assert.equal(one.sizes.contacts, PERF_SIZES.ci.contacts);
  await assert.rejects(() => seedPerf(["--scale", "huge"]), /unknown scale huge/);
});
