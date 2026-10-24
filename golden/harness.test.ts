import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { blockers, checkSequence, evaluate, exitCode, loadFlows, loadRegistryEvents, loadRegistryModules, ROOT, summary, defineFlow } from "./harness/index.ts";
import type { LoadSteps, ModuleStatus, Observed } from "./harness/index.ts";
import { dueAt, readyReport } from "../scripts/golden-ready.ts";

const flow = defineFlow({ n: 1, name: "demo", title: "Demo", needs: ["a", "b"], events: ["x.one", "x.two"] });
const mods = (a: "stub" | "live", b: "stub" | "live"): ModuleStatus[] => [{ id: "a", status: a }, { id: "b", status: b }];
const obs = (...t: string[]): Observed[] => t.map((type) => ({ type, traceId: "tr_1" }));
const noSteps: LoadSteps = async () => { throw new Error("steps must not load for a pending flow"); };

test("a flow with a stub need is PENDING, not red, and its steps never load", async () => {
  const r = await evaluate(flow, mods("live", "stub"), noSteps);
  assert.equal(r.status, "pending");
  assert.deepEqual(r.blockers, ["b"]);
  assert.match(r.line, /^PENDING \(1 module\) 01-demo: b$/);
  assert.equal(exitCode([r]), 0);
  assert.match((await evaluate(flow, mods("stub", "stub"), noSteps)).line, /PENDING \(2 modules\)/);
});

test("a ready flow passes on the right events and fails on wrong order, missing events and split trace ids", async () => {
  const run = (o: Observed[]): LoadSteps => async () => async () => o;
  assert.equal((await evaluate(flow, mods("live", "live"), run(obs("x.one", "other", "x.two")))).status, "pass");
  assert.equal((await evaluate(flow, mods("live", "live"), run(obs("x.two", "x.one")))).status, "fail");
  assert.equal((await evaluate(flow, mods("live", "live"), run(obs("x.one")))).status, "fail");
  const split = await evaluate(flow, mods("live", "live"), run([{ type: "x.one", traceId: "t1" }, { type: "x.two", traceId: "t2" }]));
  assert.equal(split.status, "fail");
  assert.match(split.reasons.join(), /2 trace ids/);
  assert.equal(exitCode([split]), 1);
});

test("a ready flow without a steps file, or whose steps throw, is red", async () => {
  assert.match((await evaluate(flow, mods("live", "live"), async () => null)).line, /^FAIL.*no steps file/);
  const boom = await evaluate(flow, mods("live", "live"), async () => async () => { throw new Error("boom"); });
  assert.match(boom.reasons.join(), /steps threw: boom/);
});

test("checkSequence needs a trace id on every event", () => {
  assert.ok(checkSequence(["x.one"], [{ type: "x.one", traceId: "" }]).length > 0);
});

test("blockers treats an unknown module as blocking", () => {
  assert.deepEqual(blockers(flow, [{ id: "a", status: "live" }]), ["b"]);
});

test("the 15 flow definitions name real modules and real events, in number order", async () => {
  const flows = await loadFlows();
  assert.deepEqual(flows.map((f) => f.n), Array.from({ length: 15 }, (_, i) => i + 1));
  const ids = new Set(loadRegistryModules().map((m) => m.id)), events = loadRegistryEvents();
  for (const f of flows) {
    for (const m of f.needs) assert.ok(ids.has(m), `flow ${f.n} needs unknown module ${m}`);
    for (const e of f.events) assert.ok(events.has(e), `flow ${f.n} names unknown event ${e}`);
    assert.ok(f.events.length >= 3 && f.needs.length >= 2, `flow ${f.n} is too thin`);
  }
});

test("golden-ready prints blockers per flow and applies the hour 6, 9 and 11 deadlines", async () => {
  const flows = await loadFlows();
  const all = loadRegistryModules();
  const stubbed = readyReport(flows, all.map((m) => ({ ...m, status: "stub" as const })));
  assert.equal(stubbed.lines.length, 16);
  assert.match(stubbed.lines[0]!, /^01-lead-to-client-to-project  PENDING \(\d+\): /);
  const live = all.map((m) => ({ ...m, status: "live" as const }));
  assert.match(readyReport(flows, live, 11).lines.at(-1)!, /15 ready, 0 pending; hour 11 deadline: met/);
  assert.deepEqual(dueAt(6, flows).map((f) => f.n), [1, 4, 14]);
  assert.ok(dueAt(9, flows).every((f) => !f.needs.includes("forms") && !f.needs.includes("campaigns")));
  assert.throws(() => dueAt(7, flows));
  // hour 6 is late while a module flow 4 needs is a stub
  const part = live.map((m) => (m.id === "conflicts" ? { ...m, status: "stub" as const } : m));
  assert.deepEqual(readyReport(flows, part, 6).late, ["04-offline-edit-conflict"]);
});

test("the CLIs run: pending flows keep the exit code at 0, golden-ready lists all 15", () => {
  const sh = (f: string, a: string[] = []) => spawnSync(process.execPath, [f, ...a], { cwd: ROOT, encoding: "utf8" });
  const g = sh("golden/harness/cli.ts");
  const m = /^15 flows: (\d+) pass, (\d+) pending, (\d+) fail$/m.exec(g.stdout);
  assert.ok(m, g.stdout + g.stderr);
  assert.equal(g.status, Number(m![3]) > 0 ? 1 : 0, "only failures turn the run red, never pending");
  const r = sh("scripts/golden-ready.ts");
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim().split("\n").length, 16);
  assert.equal(summary([]), "0 flows: 0 pass, 0 pending, 0 fail");
});
