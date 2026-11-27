// jobs-cli.mjs: list, write and stop against a throwaway HOME.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "jobs-cli.mjs");
const run = (home, args, env = {}) =>
  spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, HOME: home, ...env }, encoding: "utf8" });

test("write stores the spec atomically, list reads it with status and the tail of the log, stop marks it stopped and exits 3 for an unknown job", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-cli-"));
  try {
    assert.equal(run(home, ["list"]).stdout.trim(), "[]", "no folder: no jobs");
    const id = "job_aaaaaaaaaaaa";
    const spec = { name: "web", command: "node s.js", restart: "always" };
    assert.equal(run(home, ["write"], { VYRE_JOB: JSON.stringify({ id, spec }) }).status, 0);
    const dir = path.join(home, ".vyre", "jobs", id);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    assert.ok(!fs.existsSync(path.join(dir, "spec.json.tmp")), "no temporary file is left");
    fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify({ state: "running" }));
    fs.writeFileSync(path.join(dir, "log"), `${"x".repeat(3000)}last line\n`);
    const rows = JSON.parse(run(home, ["list"]).stdout);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].spec, spec);
    assert.equal(rows[0].status.state, "running");
    assert.equal(rows[0].tail.length, 1500);
    assert.ok(rows[0].tail.endsWith("last line\n"));
    assert.equal(run(home, ["stop"], { VYRE_JOB_ID: id }).status, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "spec.json"), "utf8")).desired, "stopped");
    assert.equal(run(home, ["stop"], { VYRE_JOB_ID: "job_bbbbbbbbbbbb" }).status, 3);
    assert.equal(run(home, ["nope"]).status, 2);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
