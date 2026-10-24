// Plan mode (spec native environment, ARCH 6.7): read and plan only until a person approves the plan.
import test from "node:test";
import assert from "node:assert/strict";
import { createPlanMode, PlanError } from "../src/tools/index.ts";
import type { PlanEvent } from "../src/tools/index.ts";
import { ctx, makeSession, thread } from "../src/tools/harness.ts";

const dana = { kind: "person" as const, id: "per_dana" };
const agent = { kind: "agent" as const, id: "agt_intake" };

test("plan mode blocks writes until approve_plan, then the same call goes through", async () => {
  const { session, calls } = makeSession();
  const events: PlanEvent[] = [];
  const pm = createPlanMode("T1", { initial: true, emit: (e) => events.push(e) });
  const call = (name: string) => session.call(ctx({ thread: thread({ planMode: pm.planMode }) }), name, {});

  const blocked = await call("records_update");
  assert.equal(blocked.kind === "error" && blocked.error.code, "permission.plan_mode");
  assert.equal(calls.length, 0);
  assert.equal((await call("records_get")).kind, "result", "reads still work");

  const id = pm.propose(["Read the intake form", "Update the record"], agent);
  assert.equal(pm.state, "proposed");
  assert.equal((await call("records_update")).kind, "error", "a proposal is not an approval");
  assert.throws(() => pm.approve(agent), (e: unknown) => e instanceof PlanError && e.code === "not_a_person");
  assert.equal(pm.planMode, true);

  pm.approve(dana);
  assert.equal(pm.planMode, false);
  const ok = await call("records_update");
  assert.equal(ok.kind, "result");
  assert.equal(calls.length >= 1 && calls.at(-1)?.cap, "records.update");

  pm.stepDone(0);
  pm.stepDone(1);
  assert.deepEqual(pm.steps.map((s) => s.done), [true, true]);
  assert.deepEqual(events.map((e) => e.type), ["plan.proposed", "plan.approved", "plan.step_done", "plan.step_done"]);
  assert.ok(events.every((e) => e.planId === id));
});

test("in plan mode the listed tools are the read tools and the plan tools; blocked and outward tools are not offered", () => {
  const { session } = makeSession();
  const set = session.toolsFor(ctx({ thread: thread({ planMode: true }) }));
  const names = new Set([...set.listed, ...set.searchable].map((t) => t.name));
  for (const t of [...set.listed, ...set.searchable]) {
    assert.notEqual(t.planMode, "blocked", t.name);
    assert.notEqual(t.effects, "outward", t.name);
  }
  for (const n of ["plan_propose", "ask_question", "wait_for", "records_get", "tool_search"]) assert.ok(names.has(n), n);
  for (const n of ["records_update", "files_write", "terminal_run", "mail_send", "sites_promote"]) assert.ok(!names.has(n), n);
});

test("property: every blocked or outward tool is refused in plan mode and never reaches invoke", async () => {
  const { session, calls, loaded } = makeSession({ engineer: true });
  const c = ctx({ thread: thread({ planMode: true }) });
  let n = 0;
  for (const t of loaded.catalog.all) {
    if (t.planMode !== "blocked" && t.effects !== "outward") continue;
    n++;
    const out = await session.call(c, t.name, {});
    assert.equal(out.kind === "error" && out.error.code, "permission.plan_mode", t.name);
  }
  assert.ok(n > 600);
  assert.equal(calls.length, 0);
});

test("plan state machine: only a person edits, approves or rejects; steps tick only after approval; a rejected plan stays in plan mode", () => {
  const pm = createPlanMode("T1", { initial: true });
  assert.throws(() => pm.approve(dana), (e: unknown) => e instanceof PlanError && e.code === "no_plan");
  assert.throws(() => pm.propose(["  ", ""], agent), (e: unknown) => e instanceof PlanError && e.code === "bad_step");
  pm.propose(["one", "two"], agent);
  assert.throws(() => pm.stepDone(0), (e: unknown) => e instanceof PlanError && e.code === "wrong_state");
  assert.throws(() => pm.edit(["x"], agent), (e: unknown) => e instanceof PlanError && e.code === "not_a_person");
  pm.edit(["one", "two", "three"], dana);
  assert.equal(pm.steps.length, 3);
  pm.reject(dana);
  assert.equal(pm.state, "rejected");
  assert.equal(pm.planMode, true);
  assert.throws(() => pm.approve(dana), (e: unknown) => e instanceof PlanError && e.code === "wrong_state");
  pm.propose(["redo"], agent);
  pm.approve(dana);
  assert.throws(() => pm.stepDone(5), (e: unknown) => e instanceof PlanError && e.code === "bad_step");
  pm.stepDone(0);
  pm.stepDone(0);
  assert.equal(pm.steps[0]?.done, true);
});

test("the person can switch plan mode back on; an agent cannot switch it off", () => {
  const pm = createPlanMode("T1");
  assert.equal(pm.planMode, false);
  pm.setPlanMode(true, dana);
  assert.equal(pm.planMode, true);
  assert.throws(() => pm.setPlanMode(false, agent), (e: unknown) => e instanceof PlanError && e.code === "not_a_person");
  pm.propose(["a"], agent);
  pm.approve(dana);
  pm.setPlanMode(true, dana);
  assert.equal(pm.state, "none", "an old approval does not carry into a new plan mode");
  assert.equal(pm.planMode, true);
});
