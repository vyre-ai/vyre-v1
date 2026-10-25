// P-L11_03: the perf seed builder, checked at the small `ci` scale so the fast lane stays fast. The full scale is built by scripts/seed-perf.ts and measured in perf/server/server.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PERF_LIVE, PERF_SIZES, bootPerf, contactRows, extraEvents } from "./build.ts";
import { startSeeded } from "../small/build.ts";
import { PERF_TARGET } from "./recipe.ts";
import { seedPerf } from "../../../scripts/seed-perf.ts";

const scratch = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "perf-seed-test-"));
const cache = scratch();
let built: Awaited<ReturnType<typeof bootPerf>> | undefined;
const first = async (): Promise<Awaited<ReturnType<typeof bootPerf>>> => (built ??= await bootPerf({ scale: "ci", cache, scratch: scratch() }));

const count = (dir: string, where: string): number => {
  const db = new DatabaseSync(path.join(dir, "events.db"), { readOnly: true });
  try { return (db.prepare(`SELECT COUNT(*) AS n FROM events WHERE ${where}`).get() as { n: number }).n; } finally { db.close(); }
};

test("the sizes: full scale is the budgets' Space, ci is a hundredth of it", () => {
  assert.equal(PERF_SIZES.full.contacts, PERF_TARGET.records);
  assert.equal(PERF_SIZES.full.channels, PERF_TARGET.channels);
  assert.deepEqual([PERF_SIZES.full.tasks, PERF_SIZES.full.agents, PERF_SIZES.full.messages, PERF_SIZES.full.files], [2000, 50, 10_000, 10_000]);
  assert.ok(PERF_SIZES.ci.contacts <= PERF_SIZES.full.contacts / 100);
  assert.deepEqual(contactRows(5, 2), contactRows(5, 2));
  assert.equal(new Set(contactRows(0, 5000).map((r) => r["email"])).size, 5000, "every match key is unique");
  const ev = extraEvents(PERF_SIZES.ci);
  assert.equal(new Set(ev.map((e) => e.id)).size, ev.length);
});

test("the ci perf Space is built through capabilities and holds its sizes", async () => {
  const s = await first();
  assert.equal(s.hit, false);
  assert.ok(count(s.dir, "type = 'record.created'") >= PERF_SIZES.ci.contacts, "the contacts");
  assert.equal(count(s.dir, "type = 'task.created'"), PERF_SIZES.ci.tasks, "the tasks");
  assert.equal(count(s.dir, "type = 'resource.created' AND json_extract(CAST(payload AS TEXT), '$.type') = 'channel'"), PERF_SIZES.ci.channels, "the channels");
  assert.equal(count(s.dir, "type = 'principal.created' AND json_extract(CAST(payload AS TEXT), '$.kind') = 'agent'"), PERF_SIZES.ci.agents, "the agents");
  assert.ok(s.gaps.some((g) => g.startsWith("messages")) && s.gaps.some((g) => g.startsWith("files")), `what could not be built is recorded: ${s.gaps.join(" | ")}`);
});

test("a second boot is a cache hit and a daemon starts on the copy", async () => {
  const a = await first();
  const b = await bootPerf({ scale: "ci", cache, scratch: scratch() });
  assert.equal(b.hit, true);
  assert.equal(b.key, a.key);
  const d = await startSeeded(b.dir, PERF_LIVE);
  try {
    const res = await fetch(`${d.url}/healthz`);
    assert.equal(res.status, 200);
  } finally { await d.stop(); b.close(); }
});

test("scripts/seed-perf.ts: builds then finds the template, and refuses an unknown scale", async () => {
  const dir = scratch();
  const one = await seedPerf(["--scale", "ci", "--cache", dir]);
  const two = await seedPerf(["--scale", "ci", "--cache", dir]);
  assert.deepEqual([one.hit, two.hit], [false, true]);
  assert.equal(one.key, two.key);
  assert.equal(one.sizes.contacts, PERF_SIZES.ci.contacts);
  await assert.rejects(() => seedPerf(["--scale", "huge"]), /unknown scale huge/);
});
