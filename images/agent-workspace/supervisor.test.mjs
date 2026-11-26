// The job supervisor (rc.44): a job is started, stopped, started again after it dies (with a growing wait), left alone when it ended for good, and started again after a restart of the supervisor itself (a reboot).
// Real processes in a temporary folder; the supervisor's `tick` is called by hand so no test waits for a clock.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-jobs-"));
process.env.VYRE_JOBS_DIR = dir;
process.env.VYRE_JOBS_GRACE_MS = "300";
const sup = await import("./supervisor.mjs?a");
const mods = [sup];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const spec = (id, o) => {
  fs.mkdirSync(path.join(dir, id), { recursive: true });
  fs.writeFileSync(path.join(dir, id, "spec.json"), JSON.stringify({ id, desired: "running", restart: "on-failure", at: Date.now(), ...o }));
};
const status = (id) => JSON.parse(fs.readFileSync(path.join(dir, id, "status.json"), "utf8"));
const log = (id) => {
  try {
    return fs.readFileSync(path.join(dir, id, "log"), "utf8");
  } catch {
    return "";
  }
};
const until = async (f, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    sup.tick();
    if (f()) return true;
    await sleep(40);
  }
  return false;
};

test("a job with desired running is started, its output goes to its log, and its status says running with a pid", async () => {
  spec("a1", { command: "echo hello-job; sleep 30" });
  assert.ok(await until(() => log("a1").includes("hello-job")));
  const st = status("a1");
  assert.equal(st.state, "running");
  assert.ok(st.pid > 0);
  assert.equal(typeof st.startedAt, "number");
  spec("a1", { command: "echo hello-job; sleep 30", desired: "stopped" });
  assert.ok(await until(() => status("a1").state === "stopped"), "asked to stop, it stops");
  assert.throws(() => process.kill(st.pid, 0), "and the process is gone");
});

test("a job that fails is started again after a wait, and the status says how often; a job that ends well is done and stays done", async () => {
  spec("f1", { command: "echo try; exit 3" });
  assert.ok(await until(() => (log("f1").match(/try/g) ?? []).length >= 2, 8000), "started again after a failure");
  const st = status("f1");
  assert.ok(["restarting", "running"].includes(st.state));
  assert.ok(st.restarts >= 1);
  spec("f1", { command: "echo try; exit 3", desired: "stopped" });
  await until(() => ["stopped"].includes(status("f1").state));
  spec("d1", { command: "echo once", restart: "on-failure" });
  assert.ok(await until(() => status("d1").state === "done"));
  const n = (log("d1").match(/once/g) ?? []).length;
  for (let i = 0; i < 8; i++) {
    sup.tick();
    await sleep(30);
  }
  assert.equal((log("d1").match(/once/g) ?? []).length, n, "an ended job is not started again by the next looks");
  spec("d1", { command: "echo once", restart: "on-failure", at: Date.now() + 1 });
  assert.ok(await until(() => (log("d1").match(/once/g) ?? []).length === n + 1), "but is when it is asked for again");
});

test("restart always starts a job that ended well; never leaves a failed one failed", async () => {
  spec("w1", { command: "echo again", restart: "always" });
  assert.ok(await until(() => (log("w1").match(/again/g) ?? []).length >= 2, 8000));
  spec("w1", { command: "echo again", restart: "always", desired: "stopped" });
  await until(() => status("w1").state === "stopped");
  spec("n1", { command: "exit 2", restart: "never" });
  assert.ok(await until(() => status("n1").state === "failed"));
  assert.equal(status("n1").exitCode, 2);
});

test("after the supervisor itself is started again (a reboot) every job that should be running is started again", async () => {
  spec("r1", { command: "echo boot-run; sleep 30" });
  assert.ok(await until(() => log("r1").includes("boot-run")));
  const first = status("r1").pid;
  // a new supervisor knows nothing of the old one's processes: the folder is all it has
  const again = await import("./supervisor.mjs?b");
  mods.push(again);
  try {
    process.kill(-first, "SIGKILL");
  } catch {
    /* gone */
  }
  await sleep(100);
  again.tick();
  await sleep(300);
  assert.equal((log("r1").match(/boot-run/g) ?? []).length, 2, "started again from its spec");
  assert.notEqual(status("r1").pid, first);
  spec("r1", { command: "echo boot-run; sleep 30", desired: "stopped" });

});

test("the log is kept to its last part when it grows large", async () => {
  fs.mkdirSync(path.join(dir, "l1"), { recursive: true });
  fs.writeFileSync(path.join(dir, "l1", "log"), "x".repeat(1_200_000));
  spec("l1", { command: "echo tail-marker" });
  assert.ok(await until(() => log("l1").includes("tail-marker")));
  assert.ok(log("l1").length < 400_000, `log is ${log("l1").length} bytes`);
});

test.after(async () => {
  // every job is asked to stop, and both supervisors look until nothing of theirs is alive, so no process or timer outlives the file
  for (const id of fs.readdirSync(dir)) {
    const f = path.join(dir, id, "spec.json");
    if (fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, "utf8")), desired: "stopped" }));
  }
  for (let i = 0; i < 60; i++) {
    for (const m of mods) m.tick();
    await sleep(50);
  }
  await sleep(400);
  fs.rmSync(dir, { recursive: true, force: true });
});
