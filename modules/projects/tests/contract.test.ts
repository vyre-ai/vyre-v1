// The contract of the projects module against its real handlers (ARCH 12.4: a module goes live only when the contract holds for the handlers, not the stubs): the handler table covers exactly the
// frozen capabilities, each example input is accepted and each answer conforms to its output schema, every error a handler raises is one the capability declares, and every event it emits is
// one it declares, with a payload that matches the frozen event schema.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";
import { DAY, NOW, BOT, DANA, LEO, MAYA, assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { mkChain, mkProject, run } from "../fixtures/seed.ts";

const mine = registry.capabilities.filter((c) => c.module === "projects");

test("the handler table covers exactly the 22 capabilities of the projects manifest", () => {
  assert.equal(mine.length, 22);
  assert.deepEqual(Object.keys(handlers).sort(), mine.map((c) => c.name).sort());
  for (const c of mine) assert.equal(typeof handlers[c.name], "function", c.name);
});

test("each example input is a valid input", () => {
  for (const c of mine) for (const ex of c.examples) assert.deepEqual(contractErrors(c.name, "in", ex.input), [], `${c.name}: example ${ex.name}`);
});

interface Scenario { cap: string; setup?: (hn: Harness) => Promise<any> | any; run: (hn: Harness, s: any) => Promise<unknown> | unknown; expect?: string }   // eslint-disable-line @typescript-eslint/no-explicit-any

const withProject = (hn: Harness) => mkProject(hn);
const withTask = async (hn: Harness) => { const p = await mkProject(hn); const t = hn.task(p, { title: "Brief", start: NOW, due: NOW + DAY }); hn.clear(); return { ...p, t }; };
const withChain = async (hn: Harness) => mkChain(hn);
const withProposal = async (hn: Harness) => {
  const c = await mkChain(hn);
  const out = await run(hn, "projects.reschedule", { projectId: c.p.projectId, taskId: c.a, due: NOW + 5 * DAY });
  hn.clear();
  return { ...c, proposalId: out.proposalId as string };
};
const NONE = "prj_none";

const scenarios: Scenario[] = [
  { cap: "projects.create", run: (hn) => run(hn, "projects.create", { type: "project", title: "New", summary: "s", goal: "g", lead: MAYA, start: NOW, due: NOW + DAY, stages: [{ title: "Draft" }], members: [{ principal: LEO, role: "member" }] }) },
  { cap: "projects.create", run: (hn) => run(hn, "projects.create", { type: "project", title: "" }), expect: "validation.bad_input" },
  { cap: "projects.from_channel", setup: (hn) => (hn.world.handlers["channels.create"]!({ name: "Intake", visibility: "invite" }) as { channel: { channelId: string } }).channel, run: (hn, ch) => run(hn, "projects.from_channel", { channelId: ch.channelId }) },
  { cap: "projects.from_channel", run: (hn) => run(hn, "projects.from_channel", { channelId: "chn_none" }), expect: "validation.not_found" },
  { cap: "projects.get", setup: withProject, run: (hn, p) => run(hn, "projects.get", { projectId: p.projectId }) },
  { cap: "projects.get", run: (hn) => run(hn, "projects.get", { projectId: NONE }), expect: "validation.not_found" },
  { cap: "projects.list", setup: withProject, run: (hn) => run(hn, "projects.list", { mine: true, limit: 10 }) },
  { cap: "projects.overview", setup: withTask, run: (hn, p) => run(hn, "projects.overview", { projectId: p.projectId }) },
  { cap: "projects.overview", run: (hn) => run(hn, "projects.overview", { projectId: NONE }), expect: "validation.not_found" },
  { cap: "projects.templates.list", run: (hn) => run(hn, "projects.templates.list", {}) },
  { cap: "projects.members.list", setup: withProject, run: (hn, p) => run(hn, "projects.members.list", { projectId: p.projectId }) },
  { cap: "projects.members.list", run: (hn) => run(hn, "projects.members.list", { projectId: NONE }), expect: "validation.not_found" },
  { cap: "projects.members.set", setup: withProject, run: (hn, p) => run(hn, "projects.members.set", { projectId: p.projectId, principal: MAYA, role: "member" }) },
  { cap: "projects.members.set", setup: withProject, run: (hn, p) => run(hn, "projects.members.set", { projectId: p.projectId, principal: "rol_x", role: "member" }), expect: "validation.bad_input" },
  { cap: "projects.members.set", run: (hn) => run(hn, "projects.members.set", { projectId: NONE, principal: MAYA, role: "member" }), expect: "validation.not_found" },
  { cap: "projects.members.remove", setup: async (hn) => { const p = await mkProject(hn); await run(hn, "projects.members.set", { projectId: p.projectId, principal: BOT, role: "member" }); hn.clear(); return p; }, run: (hn, p) => run(hn, "projects.members.remove", { projectId: p.projectId, principal: BOT }) },
  { cap: "projects.members.remove", run: (hn) => run(hn, "projects.members.remove", { projectId: NONE, principal: MAYA }), expect: "validation.not_found" },
  { cap: "projects.plan", setup: withChain, run: (hn, c) => run(hn, "projects.plan", { projectId: c.p.projectId }) },
  { cap: "projects.plan", run: (hn) => run(hn, "projects.plan", { projectId: NONE }), expect: "validation.not_found" },
  { cap: "projects.stages.set", setup: withProject, run: (hn, p) => run(hn, "projects.stages.set", { projectId: p.projectId, stages: [{ title: "Draft" }, { title: "Review" }] }) },
  { cap: "projects.stages.set", setup: async (hn) => { const p = await mkProject(hn); await run(hn, "projects.stages.set", { projectId: p.projectId, stages: [{ title: "Draft" }] }); hn.task(p, { title: "T", stage: "draft" }); hn.clear(); return p; }, run: (hn, p) => run(hn, "projects.stages.set", { projectId: p.projectId, stages: [] }), expect: "validation.precondition_failed" },
  { cap: "projects.stages.set", run: (hn) => run(hn, "projects.stages.set", { projectId: NONE, stages: [] }), expect: "validation.not_found" },
  { cap: "projects.reschedule", setup: withChain, run: (hn, c) => run(hn, "projects.reschedule", { projectId: c.p.projectId, taskId: c.a, due: NOW + 5 * DAY }) },
  { cap: "projects.reschedule", setup: withTask, run: (hn, p) => run(hn, "projects.reschedule", { projectId: p.projectId, taskId: p.t, start: NOW + 9 * DAY }), expect: "validation.bad_input" },
  { cap: "projects.reschedule", setup: withTask, run: (hn, p) => run(hn, "projects.reschedule", { projectId: p.projectId, taskId: "tsk_none", due: NOW }), expect: "validation.not_found" },
  { cap: "projects.link_tasks", setup: async (hn) => { const p = await mkProject(hn); const a = hn.task(p, { title: "A" }); const b = hn.task(p, { title: "B" }); hn.clear(); return { p, a, b }; }, run: (hn, s) => run(hn, "projects.link_tasks", { projectId: s.p.projectId, fromTaskId: s.a, toTaskId: s.b }) },
  { cap: "projects.link_tasks", setup: withChain, run: (hn, c) => run(hn, "projects.link_tasks", { projectId: c.p.projectId, fromTaskId: c.c, toTaskId: c.a }), expect: "validation.precondition_failed" },
  { cap: "projects.link_tasks", setup: withTask, run: (hn, p) => run(hn, "projects.link_tasks", { projectId: p.projectId, fromTaskId: p.t, toTaskId: "tsk_none" }), expect: "validation.not_found" },
  { cap: "projects.unlink_tasks", setup: withChain, run: (hn, c) => run(hn, "projects.unlink_tasks", { projectId: c.p.projectId, fromTaskId: c.a, toTaskId: c.b }) },
  { cap: "projects.unlink_tasks", run: (hn) => run(hn, "projects.unlink_tasks", { projectId: NONE, fromTaskId: "tsk_a", toTaskId: "tsk_b" }), expect: "validation.not_found" },
  { cap: "projects.cascade", setup: withChain, run: (hn, c) => run(hn, "projects.cascade", { projectId: c.p.projectId, taskId: c.a, due: NOW + 6 * DAY }) },
  { cap: "projects.cascade", setup: withChain, run: (hn, c) => run(hn, "projects.cascade", { projectId: c.p.projectId, taskId: c.a }), expect: "validation.bad_input" },
  { cap: "projects.cascade", setup: withChain, run: (hn, c) => run(hn, "projects.cascade", { projectId: c.p.projectId, taskId: "tsk_none", due: NOW }), expect: "validation.not_found" },
  { cap: "projects.apply_cascade", setup: withProposal, run: (hn, s) => run(hn, "projects.apply_cascade", { projectId: s.p.projectId, proposalId: s.proposalId, decision: "apply" }) },
  { cap: "projects.apply_cascade", setup: withProposal, run: (hn, s) => run(hn, "projects.apply_cascade", { projectId: s.p.projectId, proposalId: s.proposalId, decision: "keep" }) },
  { cap: "projects.apply_cascade", setup: withProposal, run: (hn, s) => run(hn, "projects.apply_cascade", { projectId: s.p.projectId, proposalId: s.proposalId, decision: "apply" }, hn.agent(BOT, DANA)), expect: "permission.no_grant" },
  { cap: "projects.apply_cascade", setup: withProposal, run: (hn, s) => run(hn, "projects.apply_cascade", { projectId: s.p.projectId, proposalId: "csc_none", decision: "apply" }), expect: "validation.not_found" },
  { cap: "projects.apply_cascade", setup: async (hn) => { const s = await withProposal(hn); await run(hn, "projects.apply_cascade", { projectId: s.p.projectId, proposalId: s.proposalId, decision: "keep" }); return s; }, run: (hn, s) => run(hn, "projects.apply_cascade", { projectId: s.p.projectId, proposalId: s.proposalId, decision: "apply" }), expect: "validation.precondition_failed" },
  { cap: "projects.open_task_thread", setup: withTask, run: (hn, p) => run(hn, "projects.open_task_thread", { projectId: p.projectId, taskId: p.t }) },
  { cap: "projects.open_task_thread", setup: withTask, run: (hn, p) => run(hn, "projects.open_task_thread", { projectId: p.projectId, taskId: "tsk_none" }), expect: "validation.not_found" },
  { cap: "projects.post_update", setup: withProject, run: (hn, p) => run(hn, "projects.post_update", { projectId: p.projectId, text: "On track.", status: "active" }) },
  { cap: "projects.post_update", setup: withProject, run: (hn, p) => run(hn, "projects.post_update", { projectId: p.projectId, text: " " }), expect: "validation.bad_input" },
  { cap: "projects.pin_file", setup: withProject, run: (hn, p) => run(hn, "projects.pin_file", { projectId: p.projectId, fileId: "fil_a" }) },
  { cap: "projects.pin_file", setup: withProject, run: (hn, p) => run(hn, "projects.pin_file", { projectId: p.projectId, fileId: "fil_missing" }), expect: "validation.not_found" },
  { cap: "projects.unpin_file", setup: async (hn) => { const p = await mkProject(hn); await run(hn, "projects.pin_file", { projectId: p.projectId, fileId: "fil_a" }); hn.clear(); return p; }, run: (hn, p) => run(hn, "projects.unpin_file", { projectId: p.projectId, fileId: "fil_a" }) },
  { cap: "projects.unpin_file", run: (hn) => run(hn, "projects.unpin_file", { projectId: NONE, fileId: "fil_a" }), expect: "validation.not_found" },
  { cap: "projects.file_chat", setup: withProject, run: (hn, p) => run(hn, "projects.file_chat", { projectId: p.projectId, threadId: "thr_mine" }) },
  { cap: "projects.file_chat", setup: withProject, run: (hn, p) => run(hn, "projects.file_chat", { projectId: p.projectId, threadId: "thr_missing" }), expect: "validation.not_found" },
  { cap: "projects.share_out", setup: withProject, run: (hn, p) => run(hn, "projects.share_out", { projectId: p.projectId, expiresAt: NOW + DAY }) },
  { cap: "projects.share_out", setup: withProject, run: (hn, p) => run(hn, "projects.share_out", { projectId: p.projectId, expiresAt: NOW - DAY }), expect: "validation.bad_input" },
];

test("every path through every capability: answers match the schema, errors are declared, events are declared and match their schemas", async () => {
  let happy = 0, unhappy = 0;
  const covered = new Set<string>();
  for (const s of scenarios) {
    const cap = mine.find((c) => c.name === s.cap)!;
    const hn = harness();
    const state = s.setup ? await s.setup(hn) : undefined;
    hn.emitted.length = 0;
    let out: unknown;
    let code: string | null = null;
    try { out = await s.run(hn, state); } catch (e) { code = codeOf(e); }
    if (s.expect !== undefined) {
      unhappy++;
      assert.equal(code, s.expect, `${s.cap}: expected ${s.expect}`);
      assert.ok((cap.errors as readonly string[]).includes(s.expect), `${s.cap} does not declare ${s.expect}`);
    } else {
      happy++;
      covered.add(s.cap);
      assert.equal(code, null, `${s.cap} raised ${String(code)}`);
      assert.deepEqual(contractErrors(s.cap, "out", out), [], `${s.cap}: answer`);
    }
    for (const e of hn.emitted) assert.ok((cap.emits as readonly string[]).includes(e.name), `${s.cap} emitted undeclared ${e.name}`);
    assert.deepEqual(assertEventsConform(hn), [], s.cap);
  }
  assert.deepEqual([...covered].sort(), mine.map((c) => c.name).sort(), "every capability has a happy path");
  assert.ok(happy >= 22 && unhappy >= 25, `${happy} happy, ${unhappy} unhappy`);
});

test("the capabilities that change something raise their declared events and the reads raise none", async () => {
  const hn = harness();
  const { p, a, b } = await mkChain(hn);
  hn.clear();
  await run(hn, "projects.stages.set", { projectId: p.projectId, stages: [{ title: "Draft" }] });
  await run(hn, "projects.members.set", { projectId: p.projectId, principal: MAYA, role: "member" });
  await run(hn, "projects.members.remove", { projectId: p.projectId, principal: MAYA });
  await run(hn, "projects.unlink_tasks", { projectId: p.projectId, fromTaskId: a, toTaskId: b });
  await run(hn, "projects.link_tasks", { projectId: p.projectId, fromTaskId: a, toTaskId: b });
  await run(hn, "projects.post_update", { projectId: p.projectId, text: "x" });
  await run(hn, "projects.pin_file", { projectId: p.projectId, fileId: "fil_a" });
  await run(hn, "projects.unpin_file", { projectId: p.projectId, fileId: "fil_a" });
  await run(hn, "projects.file_chat", { projectId: p.projectId, threadId: "thr_mine" });
  await run(hn, "projects.share_out", { projectId: p.projectId });
  assert.deepEqual(hn.names(), [
    "project.stages_changed", "project.member_set", "project.member_removed", "project.tasks_unlinked", "project.tasks_linked", "project.update_posted", "project.file_pinned", "project.file_unpinned",
    "project.chat_filed", "project.shared_out",
  ]);
  assert.deepEqual(assertEventsConform(hn), []);
  const before = hn.emitted.length;
  for (const [cap, input] of [
    ["projects.get", { projectId: p.projectId }], ["projects.list", {}], ["projects.overview", { projectId: p.projectId }], ["projects.templates.list", {}],
    ["projects.members.list", { projectId: p.projectId }], ["projects.plan", { projectId: p.projectId }],
  ] as const) await run(hn, cap, input);
  assert.equal(hn.emitted.length, before, "reads emit nothing");
});
