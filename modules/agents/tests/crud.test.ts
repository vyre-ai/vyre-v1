// agents: the record, its folder and files, the lifecycle (spec 2.6, 3.2). Real SQLite, an in-memory Files, every answer and event checked against the frozen contract.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { onTurn } from "../handlers/crud.ts";
import { CREATE_AGENT_SKILL, createAgentPlan, parseToml } from "../projections.ts";
import { DANA, LEO, MAYA, assertEventsConform, contractErrors, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const key = (): string => `k${++n}`;
const call = async (hn: Harness, cap: string, input: Record<string, unknown>, ctx: Harness["ctx"] = hn.ctx): Promise<any> => {
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap}: input`);
  const out = await h[cap]!(ctx, input);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap}: output`);
  return out;
};
const makeRaw = (hn: Harness, over: Record<string, unknown> = {}): Promise<any> => h["agents.create"]!(hn.ctx, { name: "Intake", role: "Use me when a new client form arrives.", idempotencyKey: key(), ...over });
const make = (hn: Harness, over: Record<string, unknown> = {}): Promise<any> => call(hn, "agents.create", { name: "Intake", role: "Use me when a new client form arrives.", idempotencyKey: key(), ...over });

// ---- create -----------------------------------------------------------------------------------------------------------------------------------------

test("create makes the record, Agents/<name> with the decided tree, AGENT.md and agent.toml, and announces it once", async () => {
  const hn = harness();
  const out = await make(hn, { model: "claude-sonnet-5-5", tools: { allowed: ["files", "records"], denied: ["terminal"] }, limits: { dayCostMicros: 5_000_000, turnsPerDay: 40 }, face: "intake-face" });
  const a = out.agent;
  assert.match(a.agentId, /^agt_[0-9a-z]+$/);
  assert.deepEqual({ name: a.name, role: a.role, face: a.face, status: a.status, ownerId: a.ownerId, model: a.model, hasComputer: a.hasComputer, accountPolicy: a.accountPolicy, captureMode: a.captureMode },
    { name: "Intake", role: "Use me when a new client form arrives.", face: "intake-face", status: "awake", ownerId: DANA, model: "claude-sonnet-5-5", hasComputer: false, accountPolicy: "asker", captureMode: "propose" });
  assert.deepEqual([a.toolsAllowed, a.toolsDenied, a.limits], [["files", "records"], ["terminal"], { dayCostMicros: 5_000_000, turnsPerDay: 40 }]);
  assert.equal(a.templateVersion, 1);

  const home = hn.world.folderNamed("Intake", hn.world.root)!;
  assert.equal(a.folderId, home.folderId);
  const tree = hn.world.tree(home.folderId);
  for (const want of ["AGENT.md", "agent.toml", "memory/", "memory/MAP.md", "memory/notes/", "memory/proposed/", "memory/recipes/", "memory/journal/", "skills/", "routines/", "knowledge/", "inbox/", "work/", "work/drafts/", "work/done/", "work/scratch/", "downloads/", "logs/", "chats/", ".vyre/", ".vyre/guide.md", ".index/"]) {
    assert.ok(tree.includes(want), `${want} is in the tree: ${tree.join(" ")}`);
  }
  const toml = parseToml(hn.world.text(hn.world.fileIn(home.folderId, "agent.toml")!.fileId)).value;
  assert.equal(toml["name"], "Intake");
  assert.equal(toml["description"], "Use me when a new client form arrives.");
  assert.equal(toml["model"], "claude-sonnet-5-5");
  assert.match(hn.world.text(hn.world.fileIn(home.folderId, "AGENT.md")!.fileId), /^# Intake\n\nInherits: VYRE\.md\n[\s\S]*Use me when a new client form arrives\./);
  const vyreDir = hn.world.folderNamed(".vyre", home.folderId)!;
  assert.match(hn.world.text(hn.world.fileIn(vyreDir.folderId, "guide.md")!.fileId), /How Vyre works for you/);

  assert.deepEqual(hn.names(), ["agent.created"]);
  assert.deepEqual(hn.named("agent.created")[0]!.payload, { agentId: a.agentId, name: "Intake", ownerId: DANA, templateVersion: 1 });
  assert.deepEqual(assertEventsConform(hn), []);
  const got = await call(hn, "agents.get", { agentId: a.agentId });
  assert.deepEqual(got.agent, out.agent);
});

test("create: a name is unique among agents (kept after a delete is freed), a person owns it, limits are numbers", async () => {
  const hn = harness();
  await make(hn);
  assert.equal(await failure(() => makeRaw(hn, { name: "  intake " })), "validation.duplicate", "case and spaces do not make another agent");
  for (const name of ["", "a/b", "Who: me", ".hidden", "x".repeat(61), 'q"uote']) assert.equal(await failure(() => makeRaw(hn, { name })), "validation.bad_input", JSON.stringify(name));
  assert.equal(await failure(() => makeRaw(hn, { name: "Other", ownerId: "agt_nope" })), "validation.bad_input");
  assert.equal(await failure(() => makeRaw(hn, { name: "Other", role: "two\nlines" })), "validation.bad_input");
  assert.equal(await failure(() => makeRaw(hn, { name: "Other", limits: { dayCostMicros: -1 } })), "validation.bad_input");
  const owned = await make(hn, { name: "Maya's", ownerId: MAYA });
  assert.equal(owned.agent.ownerId, MAYA);
  assert.equal(hn.rows("SELECT id FROM agents_agent").length, 2, "refused creations left nothing behind");
  assert.equal(hn.world.folderNamed("Other", hn.world.root), undefined, "nor a folder");
});

test("an agent that creates one for a person creates it as theirs; the computer flag is kept", async () => {
  const hn = harness();
  const out = await call(hn, "agents.create", { name: "Drafter", computer: true, idempotencyKey: key() }, hn.as({ kind: "agent", id: "agt_assistant" }, MAYA));
  assert.equal(out.agent.ownerId, MAYA);
  assert.equal(out.agent.hasComputer, true);
});

test("create-agent ends in one Approve card: the skill names one plan, and the plan lists what agents.create will make", async () => {
  // The skill is the file every agent carries (builtin_skills); it asks questions, proposes exactly one plan, and creates only after approval.
  assert.equal((CREATE_AGENT_SKILL.match(/plan_propose/g) ?? []).length, 1, "the skill proposes a plan in one place only");
  assert.match(CREATE_AGENT_SKILL, /Do not create anything yet/);
  assert.match(CREATE_AGENT_SKILL, /exactly one plan/);
  assert.match(CREATE_AGENT_SKILL, /After approval call agents\.create once/);
  const skills = await call(harness(), "agents.builtin_skills.list", {});
  assert.deepEqual(skills.skills.map((s: any) => s.key), ["working_in_vyre", "create_agent"]);
  assert.match(skills.skills[1].summary, /exactly one Approve card/);

  const input = { name: "Intake", role: "Use me when a form arrives", model: "claude-sonnet-5-5", computer: true, tools: { allowed: ["files"], denied: ["terminal"] }, limits: { dayCostMicros: 1_000_000 } };
  const plan = createAgentPlan("thr_a1", input);
  assert.deepEqual(contractErrors("chat.plan.propose", "in", plan), [], "it is a valid plan_propose call, which becomes the one plan block");
  assert.equal(plan.title, "Create the agent Intake");
  assert.deepEqual(plan.steps.map((s) => s.text), ["Create the agent Intake", "Make the folder Agents/Intake with AGENT.md, agent.toml and the decided tree", "Run it on claude-sonnet-5-5", "Give it a computer", "Set what it may use", "Set its limits"]);
  assert.equal(createAgentPlan("thr_a1", { name: "Bare" }).steps.length, 2, "only what was asked appears");

  // And what was approved is what is made: the same input to agents.create gives the agent the plan described.
  const hn = harness();
  const made = await make(hn, input);
  assert.equal(made.agent.hasComputer, true);
  assert.deepEqual(made.agent.toolsDenied, ["terminal"]);
  assert.equal(hn.named("agent.created").length, 1, "one creation, announced once");
});

// ---- reading ------------------------------------------------------------------------------------------------------------------------------------------

test("list shows the agents the person is in or that are shared with them; the admin toggle shows all, logged by the call", async () => {
  const hn = harness();
  const mine = (await make(hn, { name: "Mine" })).agent;
  const theirs = (await make(hn, { name: "Theirs", ownerId: MAYA })).agent;
  const secret = (await make(hn, { name: "Secret", ownerId: LEO })).agent;
  // Dana may see her own and what is shared with her (a grant on Theirs), not Secret.
  hn.allowOnly((a, r) => (a.perm === null && a.level === "view" && r.type === "agent" && r.id === theirs.agentId) || a.perm === "access.manage");
  const ids = async (input: Record<string, unknown> = {}) => (await call(hn, "agents.list", input)).agents.map((x: any) => x.agentId);
  assert.deepEqual((await ids()).sort(), [mine.agentId, theirs.agentId].sort());
  assert.deepEqual(await ids({ section: "personal" }), [mine.agentId]);
  assert.deepEqual(await ids({ section: "shared" }), [theirs.agentId]);
  assert.equal(await failure(() => call(hn, "agents.get", { agentId: secret.agentId })), "validation.not_found", "what exists is not leaked");
  assert.deepEqual(await call(hn, "agents.visibility.set", { all: true }), { all: true });
  assert.equal((await ids()).length, 3, "All in the Space");
  assert.equal((await call(hn, "agents.get", { agentId: secret.agentId })).agent.name, "Secret");
  hn.allowOnly(() => false);
  assert.equal((await ids()).length, 1, "the toggle stops counting when the admin permission goes: only her own are left");
  hn.allowOnly(() => true);
  await call(hn, "agents.visibility.set", { all: false });
  hn.allowOnly((a, r) => a.perm === null && r.id === mine.agentId);
  assert.deepEqual(await ids(), [mine.agentId]);
});

test("list pages and filters by status; status follows pause, work and the two idle minutes", async () => {
  const hn = harness();
  const a = (await make(hn, { name: "A" })).agent, b = (await make(hn, { name: "B" })).agent, c = (await make(hn, { name: "C" })).agent;
  const page1 = await call(hn, "agents.list", { limit: 2 });
  assert.deepEqual([page1.agents.length, page1.next, page1.total], [2, "2", 3]);
  assert.equal((await call(hn, "agents.list", { limit: 2, cursor: page1.next })).agents.length, 1);

  assert.equal((await call(hn, "agents.status", { agentId: a.agentId })).status, "awake");
  hn.advance(2 * 60_000 + 1);
  const asleep = await call(hn, "agents.status", { agentId: a.agentId });
  assert.equal(asleep.status, "asleep");
  assert.equal(asleep.since, a.lastActiveAt + 120_000);
  hn.raw.run("UPDATE agents_agent SET working = 1 WHERE id = ?", b.agentId);
  assert.equal((await call(hn, "agents.status", { agentId: b.agentId })).status, "working");
  await call(hn, "agents.pause", { agentId: c.agentId, reason: "Cost review" });
  const statuses = Object.fromEntries((await call(hn, "agents.list", {})).agents.map((x: any) => [x.name, x.status]));
  assert.deepEqual(statuses, { A: "asleep", B: "working", C: "paused" });
  assert.deepEqual((await call(hn, "agents.list", { status: ["paused", "working"] })).agents.map((x: any) => x.name).sort(), ["B", "C"]);
});

test("status of a paused agent carries the reason and who; the activity feed moves working and awake", async () => {
  const hn = harness();
  const a = (await make(hn)).agent;
  await call(hn, "agents.pause", { agentId: a.agentId, reason: "Over budget" }, hn.person(MAYA));
  const s = await call(hn, "agents.status", { agentId: a.agentId });
  assert.deepEqual([s.status, s.reason, s.by], ["paused", "Over budget", MAYA]);
  await call(hn, "agents.resume", { agentId: a.agentId });
  assert.equal((await call(hn, "agents.status", { agentId: a.agentId })).status, "awake", "resuming wakes it");
  hn.advance(10 * 60_000);
  assert.equal((await call(hn, "agents.status", { agentId: a.agentId })).status, "asleep");
  onTurn(hn.ctx, "started", { payload: { agentId: a.agentId } });
  onTurn(hn.ctx, "started", { payload: { agentId: a.agentId } });
  assert.equal((await call(hn, "agents.status", { agentId: a.agentId })).status, "working");
  onTurn(hn.ctx, "ended", { payload: { agentId: a.agentId } });
  assert.equal((await call(hn, "agents.status", { agentId: a.agentId })).status, "working", "one of two turns is still running");
  onTurn(hn.ctx, "ended", { payload: { agentId: a.agentId } });
  assert.equal((await call(hn, "agents.status", { agentId: a.agentId })).status, "awake");
  onTurn(hn.ctx, "ended", { payload: { agentId: a.agentId } });
  assert.equal(hn.rows("SELECT working FROM agents_agent WHERE id = ?", a.agentId)[0]!["working"], 0, "never below zero");
});

// ---- lifecycle ----------------------------------------------------------------------------------------------------------------------------------------

test("pause and resume are idempotent and announce once; pausing needs a visible agent", async () => {
  const hn = harness();
  const a = (await make(hn)).agent;
  hn.clear();
  const p = await call(hn, "agents.pause", { agentId: a.agentId, reason: "  Cost review  " });
  assert.deepEqual([p.agent.status, p.agent.pausedReason, p.agent.pausedBy], ["paused", "Cost review", DANA]);
  assert.deepEqual(hn.named("agent.paused")[0]!.payload, { agentId: a.agentId, reason: "Cost review", by: DANA });
  await call(hn, "agents.pause", { agentId: a.agentId, reason: "again" });
  assert.equal(hn.named("agent.paused").length, 1);
  assert.equal(p.agent.pausedReason, (await call(hn, "agents.get", { agentId: a.agentId })).agent.pausedReason);
  const r = await call(hn, "agents.resume", { agentId: a.agentId });
  assert.equal(r.agent.status, "awake");
  assert.equal(r.agent.pausedReason, undefined);
  await call(hn, "agents.resume", { agentId: a.agentId });
  assert.equal(hn.named("agent.resumed").length, 1);
  assert.deepEqual(assertEventsConform(hn), []);
  assert.equal(await failure(() => call(hn, "agents.pause", { agentId: "agt_none" })), "validation.not_found");
});

test("delete moves the agent and its folder to Trash and frees the name; restore brings both back unless the name was taken", async () => {
  const hn = harness();
  const a = (await make(hn)).agent;
  hn.clear();
  assert.deepEqual(await call(hn, "agents.delete", { agentId: a.agentId }), { deleted: true });
  assert.equal(hn.world.folders.get(a.folderId)!.deleted, true);
  assert.deepEqual(hn.named("agent.deleted")[0]!.payload, { agentId: a.agentId, by: DANA });
  assert.equal(await failure(() => call(hn, "agents.get", { agentId: a.agentId })), "validation.not_found");
  assert.equal((await call(hn, "agents.list", {})).total, 0);
  const again = await make(hn);
  assert.notEqual(again.agent.agentId, a.agentId, "the name is free again");
  assert.equal(await failure(() => call(hn, "agents.restore", { agentId: a.agentId })), "validation.bad_input", "that name is another agent's now");
  await call(hn, "agents.delete", { agentId: again.agent.agentId });
  hn.clear();
  const back = await call(hn, "agents.restore", { agentId: a.agentId });
  assert.equal(back.agent.name, "Intake");
  assert.equal(hn.world.folders.get(a.folderId)!.deleted, false);
  assert.deepEqual(hn.names(), ["agent.restored"]);
  assert.equal(await failure(() => call(hn, "agents.restore", { agentId: "agt_none" })), "validation.not_found");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("delete still works when Files is down: the agent is gone from the lists and the failure is logged, not thrown", async () => {
  const hn = harness();
  const a = (await make(hn)).agent;
  hn.world.answer("files.folder.delete", () => { throw new Error("files is down"); });
  assert.deepEqual(await call(hn, "agents.delete", { agentId: a.agentId }), { deleted: true });
  assert.ok(hn.warned.some((w) => /neighbour/.test(w)));
});
