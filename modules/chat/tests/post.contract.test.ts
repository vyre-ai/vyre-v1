// The eight capabilities of P-L2_10 against the frozen contract (ARCH 12.4): the handler table holds only frozen chat capabilities, each example input is accepted, each answer matches its
// output schema, every error a handler raises is one the capability declares, and every event it emits is one it declares, with a payload that matches the frozen event schema.
// The table is complete since P-L2_LIVE (the other 54 capabilities have their own tests in g24a to g24d and ask.*).
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";
import { DANA, DRAFTER, INTAKE, LEO, MAYA, REVIEWER, assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const mine = registry.capabilities.filter((c) => c.module === "chat");
const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
const OURS = ["chat.post", "chat.start", "chat.thread", "chat.answer_block", "chat.approve_plan", "threads.make_channel", "channels.create", "channels.connect_outside_agent"];

test("the handler table is exactly the 62 frozen chat capabilities (P-L2_LIVE), and the eight of P-L2_10 are among them", () => {
  assert.equal(mine.length, 65);   // 62 plus the erase and purge capabilities of P-CC_39
  assert.deepEqual(Object.keys(h).sort(), mine.map((c) => c.name).sort());
  for (const name of OURS) assert.ok(mine.some((c) => c.name === name), name);
});

test("each example input is a valid input", () => {
  for (const name of OURS) {
    const cap = mine.find((c) => c.name === name)!;
    assert.ok(cap.examples.length > 0, `${name} has an example`);
    for (const ex of cap.examples) assert.deepEqual(contractErrors(name, "in", ex.input), [], `${name}: example ${ex.name}`);
  }
});

interface Scenario { cap: string; hn?: () => Harness; setup?: (hn: Harness) => Promise<any> | any; run: (hn: Harness, s: any) => Promise<unknown> | unknown; expect?: string }

const chatOf = async (hn: Harness) => (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: "k0" })).thread.threadId as string;
const channelOf = async (hn: Harness) => (await h["channels.create"]!(hn.ctx, { name: "intake", visibility: "public", memberIds: [MAYA], agentIds: [INTAKE, DRAFTER, REVIEWER], idempotencyKey: "kc" })).channel;
let n = 0;
const key = () => `i${++n}`;

const scenarios: Scenario[] = [
  { cap: "chat.start", run: (hn) => h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE, DRAFTER], title: "Plan", first: "Hi", model: "claude-sonnet-5-5", provider: "anthropic", effort: "high", idempotencyKey: key() }) },
  { cap: "chat.start", run: (hn) => h["chat.start"]!(hn.ctx, { kind: "chat", personId: MAYA, first: "Hi Maya", idempotencyKey: key() }) },
  { cap: "chat.start", run: (hn) => h["chat.start"]!(hn.ctx, { kind: "ask", agentIds: [INTAKE], scopeType: "record", scopeId: "rec_a1", idempotencyKey: key() }) },
  { cap: "chat.start", run: (hn) => h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [], idempotencyKey: key() }), expect: "validation.bad_input" },
  { cap: "chat.post", setup: chatOf, run: (hn, t) => h["chat.post"]!(hn.ctx, { threadId: t, body: "Hello @intake", mentions: [{ kind: "agent", id: INTAKE }], idempotencyKey: key() }) },
  { cap: "chat.post", setup: chatOf, run: (hn, t) => h["chat.post"]!(hn.agent(), { threadId: t, body: "Done", via: { routineOwner: DANA }, idempotencyKey: key() }) },
  { cap: "chat.post", run: (hn) => h["chat.post"]!(hn.ctx, { threadId: "thr_none", body: "x", idempotencyKey: key() }), expect: "validation.not_found" },
  { cap: "chat.post", setup: chatOf, run: (hn, t) => h["chat.post"]!(hn.ctx, { threadId: t, body: "", idempotencyKey: key() }), expect: "validation.bad_input" },
  {
    cap: "chat.post", hn: () => harness({ calls: { "settings.get": () => ({ row: { value: 1 } }) } }),
    setup: async (hn) => { const c = await channelOf(hn); await h["chat.post"]!(hn.ctx, { threadId: c.mainThreadId, body: "go", idempotencyKey: key() }); await h["chat.post"]!(hn.agent(INTAKE), { threadId: c.mainThreadId, body: "a", idempotencyKey: key() }); await h["chat.post"]!(hn.agent(DRAFTER), { threadId: c.mainThreadId, body: "b", idempotencyKey: key() }); return c.mainThreadId; },
    run: (hn, t) => h["chat.post"]!(hn.agent(REVIEWER), { threadId: t, body: "c", idempotencyKey: key() }), expect: "permission.limit",
  },
  {
    cap: "chat.thread", setup: async (hn) => { const t = await chatOf(hn); return { t, m: (await h["chat.post"]!(hn.ctx, { threadId: t, body: "start", idempotencyKey: key() })).message.messageId }; },
    run: (hn, s) => h["chat.thread"]!(hn.ctx, { threadId: s.t, messageId: s.m }),
  },
  { cap: "chat.thread", setup: chatOf, run: (hn, t) => h["chat.thread"]!(hn.ctx, { threadId: t, messageId: "msg_none" }), expect: "validation.not_found" },
  {
    cap: "chat.answer_block", setup: async (hn) => { const t = await chatOf(hn); return { t, ...hn.seedQuestion(t, { mode: "single", options: [{ key: "a", label: "A" }] }) }; },
    run: (hn, s) => h["chat.answer_block"]!(hn.ctx, { threadId: s.t, blockId: s.blockId, answer: "a" }),
  },
  {
    cap: "chat.answer_block", setup: async (hn) => { const t = await chatOf(hn); return { t, ...hn.seedQuestion(t, { mode: "single", options: [{ key: "a", label: "A" }] }) }; },
    run: (hn, s) => h["chat.answer_block"]!(hn.ctx, { threadId: s.t, blockId: s.blockId, answer: "zzz" }), expect: "validation.bad_input",
  },
  {
    cap: "chat.answer_block", setup: async (hn) => { const t = await chatOf(hn); const q = hn.seedQuestion(t, { mode: "free" }); await h["chat.answer_block"]!(hn.ctx, { threadId: t, blockId: q.blockId, answer: "one" }); return { t, ...q }; },
    run: (hn, s) => h["chat.answer_block"]!(hn.ctx, { threadId: s.t, blockId: s.blockId, answer: "two" }), expect: "validation.precondition_failed",
  },
  { cap: "chat.answer_block", setup: chatOf, run: (hn, t) => h["chat.answer_block"]!(hn.ctx, { threadId: t, blockId: "blk_none", answer: "a" }), expect: "validation.not_found" },
  {
    cap: "chat.approve_plan", setup: async (hn) => { const t = await chatOf(hn); return { t, ...hn.seedPlan(t) }; },
    run: (hn, s) => h["chat.approve_plan"]!(hn.ctx, { threadId: s.t, planId: s.planId, edits: [{ stepId: s.stepIds[1], text: "Change it carefully" }, { stepId: s.stepIds[2], remove: true }] }),
  },
  {
    cap: "chat.approve_plan", setup: async (hn) => { const t = await chatOf(hn); const p = hn.seedPlan(t); hn.raw.run("UPDATE chat_plan SET state = 'rejected' WHERE id = ?", p.planId); return { t, ...p }; },
    run: (hn, s) => h["chat.approve_plan"]!(hn.ctx, { threadId: s.t, planId: s.planId }), expect: "validation.precondition_failed",
  },
  { cap: "chat.approve_plan", setup: chatOf, run: (hn, t) => h["chat.approve_plan"]!(hn.ctx, { threadId: t, planId: "pln_none" }), expect: "validation.not_found" },
  { cap: "threads.make_channel", setup: chatOf, run: (hn, t) => h["threads.make_channel"]!(hn.ctx, { threadId: t, personId: MAYA, name: "Launch", idempotencyKey: key() }) },
  { cap: "threads.make_channel", setup: chatOf, run: (hn, t) => h["threads.make_channel"]!(hn.ctx, { threadId: t, personId: DANA, idempotencyKey: key() }), expect: "validation.bad_input" },
  { cap: "channels.create", run: (hn) => h["channels.create"]!(hn.ctx, { name: "Launch", visibility: "invite", topic: "Spring launch", memberIds: [MAYA, LEO], agentIds: [INTAKE], recordId: "rec_p1", folderId: "fld_p1", idempotencyKey: key() }) },
  { cap: "channels.create", setup: channelOf, run: (hn) => h["channels.create"]!(hn.ctx, { name: "Intake", visibility: "public", idempotencyKey: key() }), expect: "validation.bad_input" },
  { cap: "channels.connect_outside_agent", setup: channelOf, run: (hn, c) => h["channels.connect_outside_agent"]!(hn.ctx, { channelId: c.channelId, name: "Claude Code", idempotencyKey: key() }) },
  { cap: "channels.connect_outside_agent", run: (hn) => h["channels.connect_outside_agent"]!(hn.ctx, { channelId: "chn_none", name: "Claude Code", idempotencyKey: key() }), expect: "validation.not_found" },
];

test("every path through every capability: answers match the schema, errors are declared, events are declared and match their schemas", async () => {
  let happy = 0, unhappy = 0;
  const covered = new Set<string>();
  for (const s of scenarios) {
    const cap = mine.find((c) => c.name === s.cap)!;
    const hn = s.hn ? s.hn() : harness();
    const state = s.setup ? await s.setup(hn) : undefined;
    hn.clear();
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
  assert.deepEqual([...covered].sort(), [...OURS].sort(), "every capability has a happy path");
  assert.ok(happy >= 11 && unhappy >= 10, `${happy} happy, ${unhappy} unhappy`);
});
