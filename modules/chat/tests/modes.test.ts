// Chat modes (Ask first, Auto, Plan) and the per-chat choice of model, effort and account. The new capabilities are not in generated/registry yet (the regen bot writes it), so these tests call the handlers
// directly and check the answers against the shape the manifest declares.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, INTAKE, MAYA, assertEventsConform, codeOf, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Fn = (ctx: Harness["ctx"], input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
let n = 0;
const chatOf = async (hn: Harness) => (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: `m${++n}` })).thread.threadId as string;
const failure = async (p: Promise<unknown>): Promise<string> => { try { await p; } catch (e) { return codeOf(e); } return "none"; };

test("a new chat is Ask first; threads.get says so, and planMode stays false", async () => {
  const hn = harness();
  const id = await chatOf(hn);
  const { thread } = await h["threads.get"]!(hn.ctx, { threadId: id });
  assert.equal(thread.mode, "ask");
  assert.equal(thread.planMode, false);
});

test("threads.set_mode stores the mode, answers with the thread, says what changed, and does nothing when it is the same", async () => {
  const hn = harness();
  const id = await chatOf(hn);
  hn.clear();
  assert.equal((await h["threads.set_mode"]!(hn.ctx, { threadId: id, mode: "auto" })).thread.mode, "auto");
  assert.equal((await h["threads.get"]!(hn.ctx, { threadId: id })).thread.planMode, false, "auto is not plan mode");
  assert.deepEqual(hn.named("thread.updated")[0]!.payload, { threadId: id, fields: ["mode"] });
  assert.equal(hn.named("thread.plan_mode_changed").length, 0, "plan did not change");
  await h["threads.set_mode"]!(hn.ctx, { threadId: id, mode: "auto" });
  assert.equal(hn.named("thread.updated").length, 1, "the same mode is no change");

  const plan = await h["threads.set_mode"]!(hn.ctx, { threadId: id, mode: "plan" });
  assert.deepEqual([plan.thread.mode, plan.thread.planMode], ["plan", true]);
  assert.deepEqual(hn.named("thread.plan_mode_changed")[0]!.payload, { threadId: id, planMode: true, by: DANA }, "the older plan event still fires, for older clients");
  const back = await h["threads.set_mode"]!(hn.ctx, { threadId: id, mode: "ask" });
  assert.deepEqual([back.thread.mode, back.thread.planMode], ["ask", false]);
  assert.equal(hn.named("thread.plan_mode_changed")[1]!.payload["planMode"], false);

  assert.equal(await failure(h["threads.set_mode"]!(hn.ctx, { threadId: id, mode: "yolo" })), "validation.bad_input");
  assert.equal(await failure(h["threads.set_mode"]!(hn.person(MAYA), { threadId: id, mode: "auto" })), "validation.not_found");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("threads.set_plan_mode is an alias: on is Plan, off leaves Plan for Ask first, and a chat on Auto stays on Auto", async () => {
  const hn = harness();
  const id = await chatOf(hn);
  assert.equal((await h["threads.set_plan_mode"]!(hn.ctx, { threadId: id, planMode: true })).thread.mode, "plan");
  assert.equal((await h["threads.set_plan_mode"]!(hn.ctx, { threadId: id, planMode: false })).thread.mode, "ask");
  await h["threads.set_mode"]!(hn.ctx, { threadId: id, mode: "auto" });
  const kept = await h["threads.set_plan_mode"]!(hn.ctx, { threadId: id, planMode: false });
  assert.deepEqual([kept.thread.mode, kept.thread.planMode], ["auto", false]);
  assert.equal((await h["threads.set_plan_mode"]!(hn.ctx, { threadId: id, planMode: true })).thread.mode, "plan", "plan from auto");
  assert.equal(await failure(h["threads.set_plan_mode"]!(hn.ctx, { threadId: id, planMode: "yes" })), "validation.bad_input");
});

test("the mode lives in the column older clients read as plan mode: 0 ask, 1 plan, 2 auto", async () => {
  const hn = harness();
  const id = await chatOf(hn);
  const code = () => hn.rows("SELECT modePlan FROM chat_thread WHERE id = ?", id)[0]!["modePlan"];
  assert.equal(code(), 0);
  await h["threads.set_mode"]!(hn.ctx, { threadId: id, mode: "plan" });
  assert.equal(code(), 1);
  await h["threads.set_mode"]!(hn.ctx, { threadId: id, mode: "auto" });
  assert.equal(code(), 2);
});

test("approving a plan ends Plan and leaves Ask first", async () => {
  const hn = harness();
  const id = await chatOf(hn);
  await h["threads.set_mode"]!(hn.ctx, { threadId: id, mode: "plan" });
  const seeded = hn.seedPlan(id);
  await h["chat.approve_plan"]!(hn.ctx, { threadId: id, planId: seeded.planId });
  assert.equal((await h["threads.get"]!(hn.ctx, { threadId: id })).thread.mode, "ask");
});

test("a fork keeps the mode of the chat it came from", async () => {
  const hn = harness();
  const id = await chatOf(hn);
  await h["threads.set_mode"]!(hn.ctx, { threadId: id, mode: "auto" });
  const m = await h["chat.post"]!(hn.ctx, { threadId: id, body: "hello", idempotencyKey: `p${++n}` });
  const forked = await h["chat.fork"]!(hn.ctx, { threadId: id, messageId: m.message.messageId, idempotencyKey: `f${++n}` });
  assert.equal(forked.thread.mode, "auto");
});

test("threads.agent.configure sets model, provider, effort and account for this chat; null clears; absent stays; the thread says so", async () => {
  const hn = harness();
  const id = await chatOf(hn);
  hn.clear();
  const set = await h["threads.agent.configure"]!(hn.ctx, { threadId: id, agentId: INTAKE, model: "claude-opus-5-5", provider: "anthropic", effort: "high", accountRef: "#Dana_Anthropic" });
  assert.deepEqual(set.thread.agents[0], { agentId: INTAKE, mode: "lead", model: "claude-opus-5-5", provider: "anthropic", effort: "high", accountRef: "#Dana_Anthropic" });
  assert.deepEqual(hn.named("thread.updated")[0]!.payload, { threadId: id, fields: ["agents"] });
  const effort = await h["threads.agent.configure"]!(hn.ctx, { threadId: id, agentId: INTAKE, effort: "max" });
  assert.deepEqual([effort.thread.agents[0].model, effort.thread.agents[0].effort, effort.thread.agents[0].accountRef], ["claude-opus-5-5", "max", "#Dana_Anthropic"], "only the effort changed");
  const cleared = await h["threads.agent.configure"]!(hn.ctx, { threadId: id, agentId: INTAKE, accountRef: null, effort: null });
  assert.equal("accountRef" in cleared.thread.agents[0], false);
  assert.equal("effort" in cleared.thread.agents[0], false);
  assert.equal(cleared.thread.agents[0].model, "claude-opus-5-5");
  assert.equal(hn.callLog.some((c) => c.cap === "agents.update"), false, "scope chat touches no agent");

  assert.equal(await failure(h["threads.agent.configure"]!(hn.ctx, { threadId: id, agentId: INTAKE, effort: "extreme" })), "validation.bad_input");
  assert.equal(await failure(h["threads.agent.configure"]!(hn.ctx, { threadId: id, agentId: "agt_nobody" })), "validation.not_found");
  assert.equal(await failure(h["threads.agent.configure"]!(hn.ctx, { threadId: id, agentId: INTAKE, scope: "space" })), "validation.bad_input");
  assert.equal(await failure(h["threads.agent.configure"]!(hn.person(MAYA), { threadId: id, agentId: INTAKE, model: "x" })), "validation.not_found");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("scope agent also stores the model and the account as the agent's default through agents.update; a refused agent change changes nothing here", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const hn = harness({ calls: { "agents.update": (i) => { seen.push(i); return { agent: {} }; } } });
  const id = await chatOf(hn);
  const r = await h["threads.agent.configure"]!(hn.ctx, { threadId: id, agentId: INTAKE, model: "claude-sonnet-5-5", accountRef: "#Team_Anthropic_Key", scope: "agent" });
  assert.deepEqual(seen, [{ agentId: INTAKE, patch: { model: "claude-sonnet-5-5", accountPolicy: "key", accountKey: "#Team_Anthropic_Key" } }]);
  assert.deepEqual([r.thread.agents[0].model, r.thread.agents[0].accountRef], ["claude-sonnet-5-5", "#Team_Anthropic_Key"], "this chat follows the default it just set");

  await h["threads.agent.configure"]!(hn.ctx, { threadId: id, agentId: INTAKE, accountRef: null, scope: "agent" });
  assert.deepEqual(seen[1], { agentId: INTAKE, patch: { accountPolicy: "asker", accountKey: null } }, "clearing goes back to the asker's own account");

  assert.equal(await failure(h["threads.agent.configure"]!(hn.ctx, { threadId: id, agentId: INTAKE, accountRef: "not a vault name", scope: "agent" })), "validation.bad_input");
  const denied = harness({ calls: { "agents.update": () => { throw Object.assign(new Error("no"), { code: "permission.no_grant" }); } } });
  const id2 = await chatOf(denied);
  await failure(h["threads.agent.configure"]!(denied.ctx, { threadId: id2, agentId: INTAKE, model: "gpt-5", scope: "agent" }));
  assert.equal((await h["threads.get"]!(denied.ctx, { threadId: id2 })).thread.agents[0].model, undefined, "the chat is unchanged when the agent change is refused");
});
