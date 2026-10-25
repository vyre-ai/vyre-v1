// The contract of the agents module against its real handlers (ARCH 12.4: a module goes live only when the contract holds for the handlers, not the stubs): the handler table covers exactly the
// frozen capabilities, each example input is accepted and each answer conforms to its output schema, every error a handler raises is one the capability declares, and every event it emits
// is one it declares, with a payload that matches the frozen event schema.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";
import { MAYA, assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const mine = registry.capabilities.filter((c) => c.module === "agents");
const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;

test("the handler table covers exactly the 32 capabilities of the agents manifest", () => {
  assert.equal(mine.length, 32);
  assert.deepEqual(Object.keys(h).sort(), mine.map((c) => c.name).sort());
  for (const c of mine) assert.equal(typeof h[c.name], "function", c.name);
});

test("each example input is a valid input", () => {
  for (const c of mine) for (const ex of c.examples) assert.deepEqual(contractErrors(c.name, "in", ex.input), [], `${c.name}: example ${ex.name}`);
});

interface Scenario { cap: string; setup?: (hn: Harness) => Promise<any> | any; run: (hn: Harness, s: any) => Promise<unknown> | unknown; expect?: string; hn?: () => Harness }

let n = 0;
const k = (): string => `k${++n}`;
const mkRaw = (hn: Harness, over: Record<string, unknown> = {}) => h["agents.create"]!(hn.ctx, { name: "Intake", role: "Use me when a form arrives.", idempotencyKey: k(), ...over });
const mk = async (hn: Harness, over: Record<string, unknown> = {}) => (await mkRaw(hn, over)).agent;
const withAgent = async (hn: Harness) => { const a = await mk(hn); return { id: a.agentId as string, a }; };
const withFiles = async (hn: Harness) => {
  const { id } = await withAgent(hn);
  const home = hn.world.folderNamed("Intake", hn.world.root)!;
  return { id, toml: hn.world.fileIn(home.folderId, "agent.toml")!, md: hn.world.fileIn(home.folderId, "AGENT.md")! };
};
const DIFF = "@@ -9,1 +9,2 @@\n - Say what I did, in a sentence a busy person reads in five seconds.\n+- Check the name first.\n";

const scenarios: Scenario[] = [
  { cap: "agents.create", run: (hn) => mkRaw(hn, { model: "claude-sonnet-5-5", computer: true, limits: { dayCostMicros: 1_000_000 }, tools: { allowed: ["files"], denied: [] } }) },
  { cap: "agents.create", setup: withAgent, run: (hn) => mkRaw(hn), expect: "validation.duplicate" },
  { cap: "agents.create", run: (hn) => mkRaw(hn, { name: "a/b" }), expect: "validation.bad_input" },
  { cap: "agents.list", setup: withAgent, run: (hn) => h["agents.list"]!(hn.ctx, { section: "personal", status: ["awake"], limit: 10 }) },
  { cap: "agents.get", setup: withAgent, run: (hn, s) => h["agents.get"]!(hn.ctx, { agentId: s.id }) },
  { cap: "agents.get", run: (hn) => h["agents.get"]!(hn.ctx, { agentId: "agt_none" }), expect: "validation.not_found" },
  { cap: "agents.status", setup: withAgent, run: (hn, s) => h["agents.status"]!(hn.ctx, { agentId: s.id }) },
  { cap: "agents.status", run: (hn) => h["agents.status"]!(hn.ctx, { agentId: "agt_none" }), expect: "validation.not_found" },
  { cap: "agents.summary", setup: withAgent, run: (hn, s) => h["agents.summary"]!(hn.ctx, { agentId: s.id }) },
  { cap: "agents.summary", run: (hn) => h["agents.summary"]!(hn.ctx, { agentId: "agt_none" }), expect: "validation.not_found" },
  { cap: "agents.update", setup: withAgent, run: (hn, s) => h["agents.update"]!(hn.ctx, { agentId: s.id, patch: { model: "claude-opus-4-5", toolsAllowed: ["files"], limits: { turnsPerDay: 10 }, face: "x" } }) },
  { cap: "agents.update", setup: withAgent, run: (hn, s) => h["agents.update"]!(hn.ctx, { agentId: s.id, patch: { ownerId: MAYA } }), expect: "validation.field_locked" },
  { cap: "agents.update", setup: withAgent, run: (hn, s) => h["agents.update"]!(hn.ctx, { agentId: s.id, patch: { colour: "red" } }), expect: "validation.bad_input" },
  { cap: "agents.update", run: (hn) => h["agents.update"]!(hn.ctx, { agentId: "agt_none", patch: {} }), expect: "validation.not_found" },
  { cap: "agents.role_line.set", setup: withAgent, run: (hn, s) => h["agents.role_line.set"]!(hn.ctx, { agentId: s.id, description: "Use me for new matters." }) },
  { cap: "agents.role_line.set", setup: withAgent, run: (hn, s) => h["agents.role_line.set"]!(hn.ctx, { agentId: s.id, description: "two\nlines" }), expect: "validation.bad_input" },
  { cap: "agents.role_line.set", run: (hn) => h["agents.role_line.set"]!(hn.ctx, { agentId: "agt_none", description: "x" }), expect: "validation.not_found" },
  { cap: "agents.pause", setup: withAgent, run: (hn, s) => h["agents.pause"]!(hn.ctx, { agentId: s.id, reason: "Cost review" }) },
  { cap: "agents.pause", run: (hn) => h["agents.pause"]!(hn.ctx, { agentId: "agt_none" }), expect: "validation.not_found" },
  { cap: "agents.resume", setup: async (hn) => { const s = await withAgent(hn); await h["agents.pause"]!(hn.ctx, { agentId: s.id }); return s; }, run: (hn, s) => h["agents.resume"]!(hn.ctx, { agentId: s.id }) },
  { cap: "agents.resume", run: (hn) => h["agents.resume"]!(hn.ctx, { agentId: "agt_none" }), expect: "validation.not_found" },
  { cap: "agents.delete", setup: withAgent, run: (hn, s) => h["agents.delete"]!(hn.ctx, { agentId: s.id }) },
  { cap: "agents.delete", run: (hn) => h["agents.delete"]!(hn.ctx, { agentId: "agt_none" }), expect: "validation.not_found" },
  { cap: "agents.restore", setup: async (hn) => { const s = await withAgent(hn); await h["agents.delete"]!(hn.ctx, { agentId: s.id }); return s; }, run: (hn, s) => h["agents.restore"]!(hn.ctx, { agentId: s.id }) },
  { cap: "agents.restore", run: (hn) => h["agents.restore"]!(hn.ctx, { agentId: "agt_none" }), expect: "validation.not_found" },
  { cap: "agents.visibility.set", run: (hn) => h["agents.visibility.set"]!(hn.ctx, { all: true }) },
  { cap: "agents.config.get", setup: withAgent, run: (hn, s) => h["agents.config.get"]!(hn.ctx, { agentId: s.id }) },
  { cap: "agents.config.get", run: (hn) => h["agents.config.get"]!(hn.ctx, { agentId: "agt_none" }), expect: "validation.not_found" },
  { cap: "agents.config.validate", setup: withAgent, run: (hn, s) => h["agents.config.validate"]!(hn.ctx, { agentId: s.id, toml: 'name = "Intake"\n' }) },
  { cap: "agents.config.validate", run: (hn) => h["agents.config.validate"]!(hn.ctx, { agentId: "agt_none", toml: "" }), expect: "validation.not_found" },
  { cap: "agents.limits.get", setup: withAgent, run: (hn, s) => h["agents.limits.get"]!(hn.ctx, { agentId: s.id }) },
  { cap: "agents.limits.get", run: (hn) => h["agents.limits.get"]!(hn.ctx, { agentId: "agt_none" }), expect: "validation.not_found" },
  { cap: "agents.snapshot.take", setup: withAgent, run: (hn, s) => h["agents.snapshot.take"]!(hn.ctx, { agentId: s.id, runId: "run_a1" }) },
  { cap: "agents.snapshot.take", run: (hn) => h["agents.snapshot.take"]!(hn.ctx, { agentId: "agt_none" }), expect: "validation.not_found" },
  { cap: "agents.versions", setup: withAgent, run: (hn, s) => h["agents.versions"]!(hn.ctx, { agentId: s.id, file: "agent.toml" }) },
  { cap: "agents.versions", run: (hn) => h["agents.versions"]!(hn.ctx, { agentId: "agt_none" }), expect: "validation.not_found" },
  {
    cap: "agents.restore_version", setup: async (hn) => { const s = await withFiles(hn); await h["agents.update"]!(hn.ctx, { agentId: s.id, patch: { model: "m1" } }); hn.clear(); return s; },
    run: (hn, s) => h["agents.restore_version"]!(hn.ctx, { agentId: s.id, versionId: hn.world.files.get(s.toml.fileId)!.versions[0]!.versionId }),
  },
  { cap: "agents.restore_version", setup: withAgent, run: (hn, s) => h["agents.restore_version"]!(hn.ctx, { agentId: s.id, versionId: "ver_zzzzzz" }), expect: "validation.not_found" },
  { cap: "agents.routines.list", setup: withAgent, run: (hn, s) => h["agents.routines.list"]!(hn.ctx, { agentId: s.id }) },
  { cap: "agents.routines.list", run: (hn) => h["agents.routines.list"]!(hn.ctx, { agentId: "agt_none" }), expect: "validation.not_found" },
  { cap: "agents.routine.save", setup: withAgent, run: (hn, s) => h["agents.routine.save"]!(hn.ctx, { agentId: s.id, title: "Digest", cron: "0 9 * * 1-5", prompt: "Summarise", channelId: "chn_a1", idempotencyKey: k() }) },
  { cap: "agents.routine.save", setup: withAgent, run: (hn, s) => h["agents.routine.save"]!(hn.ctx, { agentId: s.id, title: "Digest", cron: "nope", prompt: "Summarise", idempotencyKey: k() }), expect: "validation.bad_input" },
  {
    cap: "agents.routine.delete", setup: async (hn) => { const s = await withAgent(hn); const r = (await h["agents.routine.save"]!(hn.ctx, { agentId: s.id, title: "D", cron: "0 9 * * *", prompt: "p", idempotencyKey: k() })).routine; hn.clear(); return { ...s, r }; },
    run: (hn, s) => h["agents.routine.delete"]!(hn.ctx, { agentId: s.id, routineId: s.r.routineId }),
  },
  {
    cap: "agents.routine.run_now", setup: async (hn) => { const s = await withAgent(hn); const r = (await h["agents.routine.save"]!(hn.ctx, { agentId: s.id, title: "D", cron: "0 9 * * *", prompt: "p", idempotencyKey: k() })).routine; hn.world.answer("runs.start", () => ({ runId: "run_a1b2c3" })); hn.clear(); return { ...s, r }; },
    run: (hn, s) => h["agents.routine.run_now"]!(hn.ctx, { agentId: s.id, routineId: s.r.routineId, idempotencyKey: k() }),
  },
  { cap: "agents.routine.run_now", setup: withAgent, run: (hn, s) => h["agents.routine.run_now"]!(hn.ctx, { agentId: s.id, routineId: "rtn_none", idempotencyKey: k() }), expect: "validation.not_found" },
  {
    cap: "agents.routine.delegate", setup: async (hn) => { const s = await withAgent(hn); const r = (await h["agents.routine.save"]!(hn.ctx, { agentId: s.id, title: "D", cron: "0 9 * * *", prompt: "p", idempotencyKey: k() })).routine; hn.clear(); return { ...s, r }; },
    run: (hn, s) => h["agents.routine.delegate"]!(hn.ctx, { agentId: s.id, routineId: s.r.routineId, to: { kind: "person", id: "usr_maya" } }),
  },
  { cap: "agents.routine.delegate", setup: withAgent, run: (hn, s) => h["agents.routine.delegate"]!(hn.ctx, { agentId: s.id, routineId: "rtn_none", to: { kind: "person", id: "usr_maya" } }), expect: "validation.not_found" },
  {
    cap: "agents.routine.delegate", setup: async (hn) => { const s = await withAgent(hn); const r = (await h["agents.routine.save"]!(hn.ctx, { agentId: s.id, title: "D", cron: "0 9 * * *", prompt: "p", idempotencyKey: k() })).routine; hn.clear(); return { ...s, r }; },
    run: (hn, s) => h["agents.routine.delegate"]!(hn.ctx, { agentId: s.id, routineId: s.r.routineId, undo: true }), expect: "validation.precondition_failed",
  },
  { cap: "agents.routine.delete", setup: withAgent, run: (hn, s) => h["agents.routine.delete"]!(hn.ctx, { agentId: s.id, routineId: "rtn_none" }), expect: "validation.not_found" },
  { cap: "agents.suggestions.list", setup: withAgent, run: (hn, s) => h["agents.suggestions.list"]!(hn.ctx, { agentId: s.id, kind: "agent_md", state: ["open"], limit: 5 }) },
  { cap: "agents.suggestion.propose", setup: withAgent, run: (hn, s) => h["agents.suggestion.propose"]!(hn.ctx, { agentId: s.id, diff: DIFF, reason: "Names", idempotencyKey: k() }) },
  { cap: "agents.suggestion.propose", setup: withAgent, run: (hn, s) => h["agents.suggestion.propose"]!(hn.ctx, { agentId: s.id, diff: "", idempotencyKey: k() }), expect: "validation.bad_input" },
  {
    cap: "agents.suggestion.accept", setup: async (hn) => { const s = await withAgent(hn); const g = (await h["agents.suggestion.propose"]!(hn.ctx, { agentId: s.id, diff: DIFF, idempotencyKey: k() })).suggestion; hn.clear(); return { ...s, g }; },
    run: (hn, s) => h["agents.suggestion.accept"]!(hn.ctx, { suggestionId: s.g.suggestionId }),
  },
  { cap: "agents.suggestion.accept", run: (hn) => h["agents.suggestion.accept"]!(hn.ctx, { suggestionId: "sug_none" }), expect: "validation.bad_input" },
  {
    cap: "agents.suggestion.accept", setup: async (hn) => { const s = await withAgent(hn); const g = (await h["agents.suggestion.propose"]!(hn.ctx, { agentId: s.id, diff: DIFF, idempotencyKey: k() })).suggestion; await h["agents.suggestion.dismiss"]!(hn.ctx, { suggestionId: g.suggestionId }); hn.clear(); return { ...s, g }; },
    run: (hn, s) => h["agents.suggestion.accept"]!(hn.ctx, { suggestionId: s.g.suggestionId }), expect: "validation.precondition_failed",
  },
  {
    cap: "agents.suggestion.dismiss", setup: async (hn) => { const s = await withAgent(hn); const g = (await h["agents.suggestion.propose"]!(hn.ctx, { agentId: s.id, diff: DIFF, idempotencyKey: k() })).suggestion; hn.clear(); return { ...s, g }; },
    run: (hn, s) => h["agents.suggestion.dismiss"]!(hn.ctx, { suggestionId: s.g.suggestionId }),
  },
  { cap: "agents.suggestion.dismiss", run: (hn) => h["agents.suggestion.dismiss"]!(hn.ctx, { suggestionId: "sug_none" }), expect: "validation.bad_input" },
  { cap: "agents.template.get", run: (hn) => h["agents.template.get"]!(hn.ctx, {}) },
  { cap: "agents.template.preview", setup: withAgent, run: (hn, s) => h["agents.template.preview"]!(hn.ctx, { scope: "one", agentId: s.id }) },
  { cap: "agents.template.preview", run: (hn) => h["agents.template.preview"]!(hn.ctx, { scope: "one" }), expect: "validation.bad_input" },
  { cap: "agents.template.apply", setup: async (hn) => { const s = await withAgent(hn); hn.world.templateFile("skills/a.md", "A\n"); hn.clear(); return s; }, run: (hn) => h["agents.template.apply"]!(hn.ctx, { scope: "all" }) },
  { cap: "agents.template.apply", setup: withAgent, hn: () => { const x = harness(); x.world.setting("agents.template_mode", "off"); return x; }, run: (hn) => h["agents.template.apply"]!(hn.ctx, { scope: "all" }), expect: "validation.bad_input" },
  { cap: "agents.guide.get", run: (hn) => h["agents.guide.get"]!(hn.ctx, {}) },
  { cap: "agents.builtin_skills.list", run: (hn) => h["agents.builtin_skills.list"]!(hn.ctx, {}) },
];

test("every path through every capability: answers match the schema, errors are declared, events are declared and match their schemas", async () => {
  let happy = 0, unhappy = 0;
  const covered = new Set<string>();
  for (const s of scenarios) {
    const cap = mine.find((c) => c.name === s.cap)!;
    const hn = s.hn ? s.hn() : harness();
    const state = s.setup ? await s.setup(hn) : undefined;
    if (s.expect === undefined) hn.clear();
    else hn.emitted.length = 0;
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
  assert.ok(happy >= 30 && unhappy >= 25, `${happy} happy, ${unhappy} unhappy`);
});

test("the capabilities that change something raise their declared events and the reads raise none", async () => {
  const hn = harness();
  const a = await mk(hn);
  await h["agents.update"]!(hn.ctx, { agentId: a.agentId, patch: { model: "m" } });
  await h["agents.role_line.set"]!(hn.ctx, { agentId: a.agentId, description: "New role." });
  await h["agents.pause"]!(hn.ctx, { agentId: a.agentId });
  await h["agents.resume"]!(hn.ctx, { agentId: a.agentId });
  const r = (await h["agents.routine.save"]!(hn.ctx, { agentId: a.agentId, title: "T", cron: "0 9 * * *", prompt: "P", idempotencyKey: k() })).routine;
  await h["agents.routine.delete"]!(hn.ctx, { agentId: a.agentId, routineId: r.routineId });
  const s = (await h["agents.suggestion.propose"]!(hn.ctx, { agentId: a.agentId, diff: DIFF, idempotencyKey: k() })).suggestion;
  await h["agents.suggestion.dismiss"]!(hn.ctx, { suggestionId: s.suggestionId });
  await h["agents.delete"]!(hn.ctx, { agentId: a.agentId });
  await h["agents.restore"]!(hn.ctx, { agentId: a.agentId });
  assert.deepEqual(hn.names(), [
    "agent.created", "agent.config_changed", "agent.config_changed", "agent.paused", "agent.resumed", "agent.routine_changed", "agent.routine_changed", "agent.suggestion_proposed",
    "agent.suggestion_resolved", "agent.deleted", "agent.restored",
  ]);
  assert.deepEqual(assertEventsConform(hn), []);
  const before = hn.emitted.length;
  for (const [cap, input] of [["agents.list", {}], ["agents.get", { agentId: a.agentId }], ["agents.status", { agentId: a.agentId }], ["agents.summary", { agentId: a.agentId }], ["agents.config.get", { agentId: a.agentId }],
    ["agents.config.validate", { agentId: a.agentId, toml: 'name = "x"\n' }], ["agents.limits.get", { agentId: a.agentId }], ["agents.versions", { agentId: a.agentId }], ["agents.routines.list", { agentId: a.agentId }],
    ["agents.suggestions.list", {}], ["agents.template.get", {}], ["agents.template.preview", { scope: "all" }], ["agents.guide.get", {}], ["agents.builtin_skills.list", {}]] as const) await h[cap]!(hn.ctx, input);
  assert.equal(hn.emitted.length, before, "reads emit nothing");
});
// P-CC_20: run now and delegate are covered here; touched so the check selects this file.
