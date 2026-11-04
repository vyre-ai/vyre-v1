// CI runners: intake filtering, the JIT and machine sequence, teardown, the sweeper, the queue, the cap, the cost maths and admin-only settings. Fakes only: never a real cloud or GitHub call.
import test from "node:test";
import assert from "node:assert/strict";
import { costOf } from "../cost.ts";
import { userData } from "../handlers/runner.ts";
import { admin, DAY, HOUR, maya, MIN, world } from "../fixtures/world.ts";

test("settings: an admin reads and changes them, the defaults are the owner's, and the key is only a name", async () => {
  const w = world();
  const first = await w.call("ci.settings.get");
  assert.deepEqual(first.settings, { enabled: false, provider: "digitalocean", vaultKeyRef: null, region: "fra1", size: "s-2vcpu-4gb", image: "ubuntu-24-04-x64", maxConcurrent: 3, monthlyCapUsd: 0, maxJobMinutes: 60, labels: ["vyre"] });
  assert.equal(first.keyReady, false);
  const set = await w.turnOn({ maxConcurrent: 2 });
  assert.equal(set.settings.enabled, true);
  assert.equal(set.settings.maxConcurrent, 2);
  assert.equal((await w.call("ci.settings.get")).keyReady, true);
  const ev = w.named("ci.settings_changed");
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0]!.payload["fields"], ["enabled", "vaultKeyRef", "maxConcurrent", "monthlyCapUsd"]);
  assert.equal(JSON.stringify(ev).includes("Northwind_DO"), false);   // the event names fields, never values
});

test("settings: only an admin may read or change them", async () => {
  const w = world();
  await assert.rejects(w.call("ci.settings.get", {}, maya), (e: any) => e.error.code === "permission.no_grant");   // eslint-disable-line @typescript-eslint/no-explicit-any
  await assert.rejects(w.call("ci.settings.set", { enabled: false }, maya), (e: any) => e.error.code === "permission.no_grant");   // eslint-disable-line @typescript-eslint/no-explicit-any
  await assert.rejects(w.call("ci.cost.month", {}, maya), (e: any) => e.error.code === "permission.no_grant");   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(w.named("ci.settings_changed").length, 0);
});

test("settings: turning runners on needs a key and a cap; a size Vyre cannot price is refused", async () => {
  const w = world();
  await assert.rejects(w.call("ci.settings.set", { enabled: true, monthlyCapUsd: 5 }), (e: any) => e.error.code === "validation.precondition_failed");   // eslint-disable-line @typescript-eslint/no-explicit-any
  await assert.rejects(w.call("ci.settings.set", { enabled: true, vaultKeyRef: "#K" }), (e: any) => e.error.code === "validation.precondition_failed");   // eslint-disable-line @typescript-eslint/no-explicit-any
  await assert.rejects(w.call("ci.settings.set", { size: "gpu-h100x8-640gb" }), (e: any) => e.error.code === "validation.bad_input");   // eslint-disable-line @typescript-eslint/no-explicit-any
});

test("intake: a job that is not for the Space's labels, or from an unlinked repository, or while runners are off, is left alone", async () => {
  const w = world();
  await w.job("queued", { jobId: 1 });                                     // runners are off
  assert.equal(w.state.droplets.length, 0);
  await w.turnOn();
  await w.job("queued", { jobId: 2, labels: ["ubuntu-latest"] });          // GitHub's own label
  await w.job("queued", { jobId: 3, repo: "stranger/elsewhere" });         // no project of this Space
  await w.job("queued", { jobId: 4, labels: ["self-hosted", "other"] });   // the Space's label is missing
  assert.equal(w.state.droplets.length, 0);
  assert.equal(w.state.jit.length, 0);
  assert.equal((await w.call("ci.runs.list", { repo: "northwind/site" })).runs.length, 0);
  assert.equal(w.named("ci.job.refused").length, 0);
});

test("intake: a fork pull request is refused while the repository holds secrets (or when that cannot be told), and runs when it holds none", async () => {
  const w = world({ secrets: 3 });
  await w.turnOn();
  await w.job("queued", { jobId: 10, fork: "yes" });
  await w.job("queued", { jobId: 11, fork: "unknown" });
  assert.equal(w.state.droplets.length, 0);
  assert.equal(w.state.jit.length, 0);
  const refused = w.named("ci.job.refused");
  assert.equal(refused.length, 2);
  assert.equal(refused[0]!.payload["code"], "fork_with_secrets");
  assert.match(String(refused[0]!.payload["reason"]), /fork/);
  assert.match(String(refused[1]!.payload["reason"]), /could not tell/);
  const runs = (await w.call("ci.runs.list", { repo: "northwind/site" })).runs;
  assert.deepEqual(runs.map((r: { state: string }) => r.state), ["refused", "refused"]);
  w.state.secrets = null;   // GitHub would not say: still refused
  await w.job("queued", { jobId: 12, fork: "yes" });
  assert.equal(w.state.droplets.length, 0);
  w.state.secrets = 0;
  await w.job("queued", { jobId: 13, fork: "yes" });
  assert.equal(w.state.droplets.length, 1);
});

test("start: the just-in-time runner comes first, then one machine tagged for the Space, running that runner and powering off", async () => {
  const w = world();
  await w.turnOn();
  await w.job("queued", { jobId: 20 });
  assert.equal(w.state.jit.length, 1);
  assert.deepEqual(w.state.jit[0], { repo: "northwind/site", name: w.state.jit[0]!["name"], labels: ["vyre"] });
  assert.match(String(w.state.jit[0]!["name"]), /^vyre-ci-[a-z0-9]{12}$/);
  const [d] = w.state.droplets;
  assert.ok(d);
  assert.deepEqual(d.tags, ["vyre-ci", "vyre-space-spc_test"]);
  assert.equal(d.size, "s-2vcpu-4gb");
  assert.match(d.user_data, /run\.sh --jitconfig eyJhbGciOiJIUzI1NiJ9abc123==/);
  assert.match(d.user_data, /actions-runner-linux-x64-2\.338\.2\.tar\.gz/);
  assert.match(d.user_data, /sha256sum -c/);
  assert.match(d.user_data, /trap poweroff EXIT/);
  assert.match(d.user_data, /sleep 3600/);
  assert.deepEqual(w.state.keysUsed, ["#Northwind_DO"]);
  const { runs } = await w.call("ci.runs.list", { projectId: "prj_site" });
  assert.equal(runs[0].state, "running");
  assert.equal(runs[0].dropletId, d.id);
  assert.equal(runs[0].size, "s-2vcpu-4gb");
  assert.equal(runs[0].startedAt, w.state.now);
  const started = w.named("ci.run.started");
  assert.equal(started.length, 1);
  assert.equal(started[0]!.payload["dropletId"], d.id);
  await w.job("queued", { jobId: 20 });   // delivered twice: still one machine
  assert.equal(w.state.droplets.length, 1);
});

test("start: a runner config that is not what GitHub sends never reaches a script", () => {
  assert.throws(() => userData("abc; rm -rf /", 60));
  assert.match(userData("abc_-=/+", 60), /--jitconfig abc_-=\/\+/);
});

test("start: when the cloud refuses, the run fails with a plain note, the runner is taken back and the admins' count stays clean", async () => {
  const w = world();
  await w.turnOn();
  w.state.failCreate = 401;
  await w.job("queued", { jobId: 30 });
  const r = (await w.call("ci.runs.list", { repo: "northwind/site" })).runs[0];
  assert.equal(r.state, "failed");
  assert.match(r.note, /did not accept the key/);
  assert.equal(r.costUsd, 0);
  assert.deepEqual(w.state.removed, [7001]);
  assert.equal(w.named("ci.run.failed").length, 1);
  assert.equal(JSON.stringify(w.state.events).includes("eyJhbGci"), false);
  w.state.failCreate = 403;   // the account is held for a balance: the provider's own words reach the admin
  await w.job("queued", { jobId: 32 });
  assert.match((await w.call("ci.runs.list", { repo: "northwind/site" })).runs[0].note, /^The cloud refused to make a machine/);
  w.state.jitFails = true;
  await w.job("queued", { jobId: 31 });
  assert.equal((await w.call("ci.runs.get", { runId: (await w.call("ci.runs.list", { repo: "northwind/site" })).runs[0].runId })).run.state, "failed");
  assert.equal(w.state.droplets.length, 0);
});

test("teardown: when the job ends the machine is deleted, the cost is recorded and the run finishes", async () => {
  const w = world();
  await w.turnOn();
  await w.job("queued", { jobId: 40 });
  w.advance(10 * MIN);
  await w.job("completed", { jobId: 40, conclusion: "success" });
  assert.equal(w.state.droplets.length, 0);
  const r = (await w.call("ci.runs.list", { repo: "northwind/site" })).runs[0];
  assert.equal(r.state, "finished");
  assert.equal(r.conclusion, "success");
  assert.equal(r.endedAt, w.state.now);
  assert.equal(r.costUsd, costOf(0.03571, 600));
  const fin = w.named("ci.run.finished");
  assert.equal(fin.length, 1);
  assert.equal(fin[0]!.payload["minutes"], 10);
  await w.job("completed", { jobId: 40, conclusion: "success" });   // twice: nothing more
  assert.equal(w.named("ci.run.finished").length, 1);
  await w.job("completed", { jobId: 999, conclusion: "success" });  // a job on GitHub's own runners: ignored
});

test("teardown: a machine that cannot be deleted yet is left for the sweeper, which deletes it", async () => {
  const w = world();
  await w.turnOn();
  await w.job("queued", { jobId: 41 });
  w.state.failDelete = true;
  await w.job("completed", { jobId: 41, conclusion: "failure" });
  assert.equal(w.state.droplets.length, 1);
  w.state.failDelete = false;
  const out = await w.sweepNow();
  assert.equal(out.deleted, 1);
  assert.equal(w.state.droplets.length, 0);
  assert.equal(w.named("ci.run.swept")[0]!.payload["reason"], "no_run");
});

test("sweeper: an orphan tagged vyre-ci with no live run is deleted; a live one is kept; another Space's machine is never touched", async () => {
  const w = world();
  await w.turnOn();
  await w.job("queued", { jobId: 50 });
  w.state.droplets.push({ id: "9001", created_at: new Date(w.state.now - 5 * MIN).toISOString(), tags: ["vyre-ci", "vyre-space-spc_test"], user_data: "", name: "orphan", size: "s-2vcpu-4gb" });
  w.state.droplets.push({ id: "9002", created_at: new Date(w.state.now - 5 * DAY).toISOString(), tags: ["vyre-ci", "vyre-space-spc_other"], user_data: "", name: "theirs", size: "s-2vcpu-4gb" });
  w.advance(2 * MIN);
  const out = await w.sweepNow();
  assert.equal(out.deleted, 1);
  assert.deepEqual(w.state.droplets.map((d) => d.name).sort(), ["theirs", `vyre-ci-${(w.state.jit[0]!["name"] as string).slice(8)}`].sort());
  const swept = w.named("ci.run.swept");
  assert.equal(swept.length, 1);
  assert.equal(swept[0]!.payload["dropletId"], "9001");
  assert.equal(swept[0]!.payload["runId"], null);
});

test("sweeper: a machine past the time limit plus 10 minutes is deleted and its run marked swept with the cost", async () => {
  const w = world();
  await w.turnOn({ maxJobMinutes: 30 });
  await w.job("queued", { jobId: 51 });
  w.advance(39 * MIN);
  assert.equal((await w.sweepNow()).deleted, 0);   // under 40 minutes: kept
  w.advance(2 * MIN);
  assert.equal((await w.sweepNow()).deleted, 1);
  const r = (await w.call("ci.runs.list", { repo: "northwind/site" })).runs[0];
  assert.equal(r.state, "swept");
  assert.equal(r.costUsd, costOf(0.03571, 41 * 60));
  assert.equal(w.named("ci.run.swept")[0]!.payload["reason"], "too_long");
});

test("sweeper: it never deletes on a guess when the cloud cannot be listed, and calls a vanished machine's run lost", async () => {
  const w = world();
  await w.turnOn();
  await w.job("queued", { jobId: 52 });
  w.state.failList = true;
  w.advance(HOUR);
  assert.deepEqual(await w.sweepNow(), { deleted: 0, started: 0 });
  assert.equal(w.state.droplets.length, 1);
  w.state.failList = false;
  w.state.droplets.length = 0;   // deleted by hand
  await w.sweepNow();
  const r = (await w.call("ci.runs.list", { repo: "northwind/site" })).runs[0];
  assert.equal(r.state, "failed");
  assert.match(r.note, /lost/);
});

test("queue: at the concurrency limit a job waits, and starts when a machine frees", async () => {
  const w = world();
  await w.turnOn({ maxConcurrent: 2 });
  await w.job("queued", { jobId: 60 });
  await w.job("queued", { jobId: 61 });
  await w.job("queued", { jobId: 62 });
  assert.equal(w.state.droplets.length, 2);
  let runs = (await w.call("ci.runs.list", { repo: "northwind/site" })).runs;
  assert.deepEqual(runs.map((r: { jobId: number; state: string }) => [r.jobId, r.state]), [[62, "queued"], [61, "running"], [60, "running"]]);
  assert.match(runs[0].note, /2 of 2/);
  assert.equal((await w.call("ci.project.get", { projectId: "prj_site" })).queued, 1);
  w.advance(MIN);
  await w.job("completed", { jobId: 60, conclusion: "success" });
  assert.equal(w.state.droplets.length, 2);
  runs = (await w.call("ci.runs.list", { repo: "northwind/site" })).runs;
  assert.equal(runs.find((r: { jobId: number }) => r.jobId === 62).state, "running");
  assert.equal(w.named("ci.run.started").length, 3);
});

test("queue: the sweeper starts a waiting job when room appears without a webhook", async () => {
  const w = world();
  await w.turnOn({ maxConcurrent: 1 });
  await w.job("queued", { jobId: 63 });
  await w.job("queued", { jobId: 64 });
  w.state.droplets.length = 0;
  w.advance(10 * MIN);
  const out = await w.sweepNow();
  assert.equal(out.started, 1);
  assert.equal(w.state.droplets.length, 1);
});

test("cap: a job that would pass the monthly cap is refused with a plain notice, and the admins are told once for the month", async () => {
  const w = world();
  await w.turnOn({ monthlyCapUsd: 0.05 });   // one 60 minute job is estimated at 3.6 cents
  await w.job("queued", { jobId: 70 });
  w.advance(30 * MIN);
  await w.job("completed", { jobId: 70, conclusion: "success" });   // costs 1.8 cents
  await w.job("queued", { jobId: 71 });                             // 1.8 + 3.6 > 5
  await w.job("queued", { jobId: 72 });
  assert.equal(w.state.droplets.length, 0);
  const runs = (await w.call("ci.runs.list", { repo: "northwind/site" })).runs;
  assert.deepEqual(runs.slice(0, 2).map((r: { state: string }) => r.state), ["refused", "refused"]);
  assert.equal(runs[0].note, "CI paused: this month's cap of $0.05 is reached");
  const paused = w.named("ci.paused");
  assert.equal(paused.length, 1);
  assert.equal(paused[0]!.payload["title"], "CI paused: this month's cap of $0.05 is reached");
  assert.equal(w.named("ci.job.refused").filter((e) => e.payload["code"] === "cap_reached").length, 2);
  const cost = await w.call("ci.cost.month", {});
  assert.equal(cost.paused, true);
  assert.equal(cost.spentUsd, costOf(0.03571, 1800));
  assert.equal(cost.leftUsd, Math.round((0.05 - cost.spentUsd) * 10000) / 10000);
  assert.deepEqual(cost.byRepo, [{ repo: "northwind/site", runs: 1, costUsd: cost.spentUsd }]);
  w.advance(40 * DAY);   // the next month: money again, and a new notice if it runs out again
  await w.job("queued", { jobId: 73 });
  assert.equal(w.state.droplets.length, 1);
});

test("cap: the cost already running counts against the cap", async () => {
  const w = world();
  await w.turnOn({ monthlyCapUsd: 0.11, maxConcurrent: 5 });
  await w.job("queued", { jobId: 80 });
  await w.job("queued", { jobId: 81 });
  await w.job("queued", { jobId: 82 });   // 3 x the 3.6 cent estimate = 10.8 < 11: all three fit when nothing has run
  assert.equal(w.state.droplets.length, 3);
  w.advance(HOUR);
  await w.job("queued", { jobId: 83 });   // an hour of three machines is already 10.7 cents
  assert.equal(w.state.droplets.length, 3);
  assert.equal(w.named("ci.paused").length, 1);
});

test("cost: per second with a 60 second floor and a one cent floor, rounded up, quoted from the provider's rule", () => {
  assert.equal(costOf(0.03571, 0), 0.01);
  assert.equal(costOf(0.03571, 59), 0.01);
  assert.equal(costOf(0.03571, 3600), 0.0358);               // 0.03571 rounds up to the next hundredth of a cent
  assert.equal(costOf(0.03571, 1800), 0.0179);               // 0.017855
  assert.equal(costOf(0.00893, 100), 0.01);                  // under a cent: the cent
  assert.equal(costOf(0.14286, 7200), 0.2858);               // 0.28572 up
  assert.equal(costOf(0.03571, 90.2), 0.01);
  assert.equal(costOf(0.14286, 3600 * 3), 0.4286);           // 0.42858 up
});

test("reads: a member sees the runs of a project they are in, not another's; the CI tab shows only on a linked project with runners on", async () => {
  const w = world({ links: { "northwind/site": "prj_site", "northwind/app": "prj_app" }, members: { prj_site: ["usr_maya"] } });
  await w.turnOn();
  await w.job("queued", { jobId: 90 });
  const mine = await w.call("ci.runs.list", { projectId: "prj_site" }, maya);
  assert.equal(mine.runs.length, 1);
  assert.equal((await w.call("ci.runs.list", { repo: "Northwind/Site" }, maya)).runs.length, 1);
  await assert.rejects(w.call("ci.runs.list", { projectId: "prj_app" }, maya), (e: any) => e.error.code === "permission.no_grant");   // eslint-disable-line @typescript-eslint/no-explicit-any
  await assert.rejects(w.call("ci.runs.list", {}, admin), (e: any) => e.error.code === "validation.bad_input");   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal((await w.call("ci.runs.get", { runId: mine.runs[0].runId }, maya)).run.jobId, 90);
  const p = await w.call("ci.project.get", { projectId: "prj_site" }, maya);
  assert.deepEqual(p, { linked: true, repo: "northwind/site", enabled: true, labels: ["vyre"], live: 1, queued: 0 });
  const off = world({ links: { "northwind/site": "prj_site" } });
  assert.equal((await off.call("ci.project.get", { projectId: "prj_site" })).enabled, false);
});

test("linked tab: a run shows on its project as Running, then Passed or Failed, with the job, the time and the address; a missing links capability changes nothing", async () => {
  const w = world();
  await w.turnOn();
  await w.job("queued", { jobId: 100 });
  const [first] = w.state.links_;
  assert.equal(first!["kind"], "ci.run");
  assert.equal(first!["projectId"], "prj_site");
  assert.equal(first!["state"], "Running");
  assert.match(String(first!["ref"]), /^cir_[a-z0-9]{12}$/);
  assert.equal(first!["url"], "https://github.com/northwind/site/actions/runs/600/job/100");
  w.advance(4 * MIN);
  await w.job("completed", { jobId: 100, conclusion: "success" });
  const done = w.state.links_.at(-1)!;
  assert.equal(done["ref"], first!["ref"]);
  assert.equal(done["state"], "Passed");
  assert.equal(done["label"], "build · northwind/site · 4 min");
  await w.job("queued", { jobId: 101 });
  w.advance(2 * MIN);
  await w.job("completed", { jobId: 101, conclusion: "failure" });
  assert.equal(w.state.links_.at(-1)!["state"], "Failed");
  w.state.noLinkCap = true;
  await w.job("queued", { jobId: 102 });
  assert.equal(w.state.droplets.length, 1, "the job still runs when the project cannot be linked");
});
