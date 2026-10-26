// Group g24a (P-L2_24a): threads.get, list, close, reopen, update, add_agent, remove_agent, members.add, members.remove, set_folder, set_plan_mode, mark_read, against the frozen contract.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { handlers } from "../impl.ts";
import { g24aHandlers, ensureReadTable, unreadOf } from "../handlers/g24a.ts";
import { DANA, DRAFTER, INTAKE, LEO, MAYA, NOW, REVIEWER, assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Fn = (ctx: Harness["ctx"], input: any) => Promise<any>;
const h = handlers as unknown as Record<string, Fn>;
const g = g24aHandlers as unknown as Record<string, Fn>;
const OURS = Object.keys(g24aHandlers);
const ALWAYS = ["validation.bad_input", "internal.unexpected", "permission.no_grant", "permission.above_clearance"];
let n = 0;
const key = () => `g${++n}`;

/** Call a capability and check the input and the answer against the contract. */
async function ok(cap: string, ctx: Harness["ctx"], input: Record<string, unknown>) {
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap} input`);
  const res = await g[cap]!(ctx, input);
  assert.deepEqual(contractErrors(cap, "out", res), [], `${cap} output`);
  return res;
}
/** Call a capability that must fail with a code the capability declares. */
async function refused(cap: string, ctx: Harness["ctx"], input: Record<string, unknown>, code: string) {
  try { await g[cap]!(ctx, input); } catch (e) {
    assert.equal(codeOf(e), code);
    const declared = registry.capabilities.find((c) => c.name === cap)!.errors as string[];
    assert.ok(declared.includes(code) || ALWAYS.includes(code), `${cap} raised ${code}, which it does not declare`);
    return;
  }
  assert.fail(`${cap} should have failed with ${code}`);
}
const chatOf = async (hn: Harness, extra: Record<string, unknown> = {}) => (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: key(), ...extra })).thread.threadId as string;
const channelOf = async (hn: Harness, name = "intake") => (await h["channels.create"]!(hn.ctx, { name, visibility: "public", memberIds: [MAYA], agentIds: [INTAKE], idempotencyKey: key() })).channel;

test("the table holds the twelve capabilities of this group, all frozen chat capabilities, and every example input is valid", () => {
  assert.equal(OURS.length, 12);
  for (const name of OURS) {
    const cap = registry.capabilities.find((c) => c.module === "chat" && c.name === name);
    assert.ok(cap, name);
    assert.ok(cap.examples.length > 0, `${name} has an example`);
    for (const ex of cap.examples) assert.deepEqual(contractErrors(name, "in", ex.input), [], `${name}: example ${ex.name}`);
  }
});

test("threads.get reads a thread; another person and a missing id get not found", async () => {
  const hn = harness();
  const id = await chatOf(hn);
  const { thread } = await ok("threads.get", hn.ctx, { threadId: id });
  assert.equal(thread.threadId, id);
  assert.deepEqual(thread.agents.map((a: any) => [a.agentId, a.mode]), [[INTAKE, "lead"]]);
  assert.equal((await ok("threads.get", hn.agent(INTAKE), { threadId: id })).thread.threadId, id, "an agent in the chat reads it");
  await refused("threads.get", hn.person(MAYA), { threadId: id }, "validation.not_found");
  await refused("threads.get", hn.ctx, { threadId: "thr_none" }, "validation.not_found");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("threads.list: the sidebar, kind and parent filters, paging, and only what the person may see", async () => {
  const hn = harness();
  const a = await chatOf(hn), b = await chatOf(hn), ch = await channelOf(hn);
  const ask = (await h["chat.start"]!(hn.ctx, { kind: "ask", agentIds: [INTAKE], scopeType: "record", scopeId: "rec_a", idempotencyKey: key() })).thread.threadId as string;
  const all = await ok("threads.list", hn.ctx, {});
  assert.deepEqual(all.threads.map((t: any) => t.threadId).sort(), [a, b, ch.mainThreadId].sort(), "no filter: listed threads only");
  assert.equal(all.total, 3);
  assert.equal("next" in all, false);
  assert.deepEqual((await ok("threads.list", hn.ctx, { kind: ["ask"] })).threads.map((t: any) => t.threadId), [ask], "a filter reaches unlisted kinds");
  assert.deepEqual((await ok("threads.list", hn.ctx, { kind: ["channel"] })).threads.map((t: any) => t.threadId), [ch.mainThreadId]);
  const p1 = await ok("threads.list", hn.ctx, { limit: 2 });
  assert.equal(p1.threads.length, 2);
  assert.equal(p1.total, 3);
  const p2 = await ok("threads.list", hn.ctx, { limit: 2, cursor: p1.next });
  assert.equal(p2.threads.length, 1);
  assert.deepEqual([...p1.threads, ...p2.threads].map((t: any) => t.threadId).sort(), [a, b, ch.mainThreadId].sort());
  assert.deepEqual((await ok("threads.list", hn.person(MAYA), {})).threads.map((t: any) => t.threadId), [ch.mainThreadId], "Maya sees the public channel, not Dana's chats");
  await refused("threads.list", hn.ctx, { cursor: "thr_nope" }, "validation.bad_input");
  await refused("threads.list", hn.ctx, { kind: ["bogus"] }, "validation.bad_input");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("threads.close and reopen: events once, closed threads take no posts, waiting questions block a close", async () => {
  const hn = harness();
  const id = await chatOf(hn);
  hn.clear();
  const closed = await ok("threads.close", hn.ctx, { threadId: id });
  assert.equal(closed.thread.closedAt, NOW);
  assert.deepEqual(hn.named("thread.closed").map((e) => e.payload), [{ threadId: id }]);
  await ok("threads.close", hn.ctx, { threadId: id });
  assert.equal(hn.named("thread.closed").length, 1, "closing twice is the same close");
  await assert.rejects(() => h["chat.post"]!(hn.ctx, { threadId: id, body: "hi", idempotencyKey: key() }));
  const reopened = await ok("threads.reopen", hn.ctx, { threadId: id });
  assert.equal("closedAt" in reopened.thread, false);
  await ok("threads.reopen", hn.ctx, { threadId: id });
  assert.equal(hn.named("thread.reopened").length, 1);
  assert.deepEqual(assertEventsConform(hn), []);

  hn.seedQuestion(id, { mode: "free" });
  await refused("threads.close", hn.ctx, { threadId: id }, "validation.bad_input");
  await refused("threads.close", hn.ctx, { threadId: (await channelOf(hn)).mainThreadId }, "validation.bad_input");
  await refused("threads.close", hn.person(MAYA), { threadId: id }, "validation.not_found");
  await refused("threads.reopen", hn.ctx, { threadId: "thr_none" }, "validation.not_found");
});

test("threads.update renames; threads.set_folder sets and clears the work folder", async () => {
  const hn = harness();
  const id = await chatOf(hn);
  hn.clear();
  assert.equal((await ok("threads.update", hn.ctx, { threadId: id, title: "  Launch   plan " })).thread.title, "Launch plan");
  assert.deepEqual(hn.named("thread.updated")[0]!.payload, { threadId: id, fields: ["title"] });
  await ok("threads.update", hn.ctx, { threadId: id, title: "Launch plan" });
  assert.equal(hn.named("thread.updated").length, 1, "the same name is no change");
  await refused("threads.update", hn.ctx, { threadId: id, title: "   " }, "validation.bad_input");
  await refused("threads.update", hn.ctx, { threadId: id, title: "x".repeat(201) }, "validation.bad_input");
  await refused("threads.update", hn.ctx, { threadId: (await channelOf(hn)).mainThreadId, title: "New" }, "validation.bad_input");
  await refused("threads.update", hn.person(MAYA), { threadId: id, title: "Mine" }, "validation.not_found");

  assert.equal((await ok("threads.set_folder", hn.ctx, { threadId: id, folderId: "fld_c1" })).thread.folderId, "fld_c1");
  assert.deepEqual(hn.named("thread.updated")[1]!.payload, { threadId: id, fields: ["folderId"] });
  assert.equal("folderId" in (await ok("threads.set_folder", hn.ctx, { threadId: id, folderId: null })).thread, false);
  assert.equal(hn.named("thread.updated").length, 3);
  await ok("threads.set_folder", hn.ctx, { threadId: id, folderId: null });
  assert.equal(hn.named("thread.updated").length, 3, "clearing an empty folder is no change");
  await refused("threads.set_folder", hn.ctx, { threadId: id, folderId: "nope" }, "validation.bad_input");
  await refused("threads.set_folder", hn.ctx, { threadId: "thr_none", folderId: null }, "validation.not_found");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("threads.set_plan_mode switches plan mode and says who did it", async () => {
  const hn = harness();
  const id = await chatOf(hn);
  hn.clear();
  assert.equal((await ok("threads.set_plan_mode", hn.ctx, { threadId: id, planMode: true })).thread.planMode, true);
  assert.deepEqual(hn.named("thread.plan_mode_changed")[0]!.payload, { threadId: id, planMode: true, by: DANA });
  await ok("threads.set_plan_mode", hn.ctx, { threadId: id, planMode: true });
  assert.equal(hn.named("thread.plan_mode_changed").length, 1);
  assert.equal((await ok("threads.set_plan_mode", hn.ctx, { threadId: id, planMode: false })).thread.planMode, false);
  assert.equal(hn.rows("SELECT modePlan FROM chat_thread WHERE id = ?", id)[0]!["modePlan"], 0);
  await refused("threads.set_plan_mode", hn.person(MAYA), { threadId: id, planMode: true }, "validation.not_found");
  await refused("threads.set_plan_mode", hn.ctx, { threadId: id, planMode: "yes" }, "validation.bad_input");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("threads.add_agent and remove_agent: modes, one lead, events, and who may change the line-up", async () => {
  const hn = harness();
  const id = await chatOf(hn);
  hn.clear();
  const t1 = (await ok("threads.add_agent", hn.ctx, { threadId: id, agentId: DRAFTER })).thread;
  assert.deepEqual(t1.agents.map((a: any) => [a.agentId, a.mode]), [[INTAKE, "lead"], [DRAFTER, "listen"]]);
  assert.deepEqual(hn.named("agent.engaged")[0]!.payload, { threadId: id, agentId: DRAFTER, mode: "listen", by: DANA });
  await ok("threads.add_agent", hn.ctx, { threadId: id, agentId: DRAFTER });
  assert.equal(hn.named("agent.engaged").length, 1, "adding again is no change");
  const t2 = (await ok("threads.add_agent", hn.ctx, { threadId: id, agentId: DRAFTER, mode: "lead" })).thread;
  assert.deepEqual(t2.agents.map((a: any) => [a.agentId, a.mode]), [[INTAKE, "listen"], [DRAFTER, "lead"]], "one lead at a time");
  await refused("threads.add_agent", hn.agent(INTAKE), { threadId: id, agentId: REVIEWER }, "permission.role_lacks_permission");
  await ok("threads.add_agent", hn.agent(DRAFTER), { threadId: id, agentId: REVIEWER });
  await refused("threads.add_agent", hn.ctx, { threadId: id, agentId: LEO }, "validation.bad_input");
  await refused("threads.add_agent", hn.person(MAYA), { threadId: id, agentId: REVIEWER }, "validation.not_found");

  const solo = await chatOf(hn, { agentIds: [DRAFTER] });
  hn.clear();
  assert.equal((await ok("threads.remove_agent", hn.ctx, { threadId: solo, agentId: DRAFTER })).thread.agents.length, 0);
  assert.deepEqual(hn.named("agent.disengaged")[0]!.payload, { threadId: solo, agentId: DRAFTER, by: DANA });
  assert.equal((await ok("threads.add_agent", hn.ctx, { threadId: solo, agentId: INTAKE })).thread.agents[0].mode, "lead", "the only agent leads");
  await refused("threads.remove_agent", hn.ctx, { threadId: solo, agentId: DRAFTER }, "validation.not_found");
  await refused("threads.remove_agent", hn.agent(REVIEWER), { threadId: id, agentId: INTAKE }, "permission.role_lacks_permission");
  assert.equal((await ok("threads.remove_agent", hn.agent(INTAKE), { threadId: id, agentId: INTAKE })).thread.agents.some((a: any) => a.agentId === INTAKE), false, "an agent may leave");
  await ok("threads.close", hn.ctx, { threadId: id });
  await refused("threads.add_agent", hn.ctx, { threadId: id, agentId: INTAKE }, "validation.precondition_failed");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("threads.members.add and remove: a private chat offers a channel; a channel adds, removes, keeps its last person", async () => {
  const hn = harness();
  const chat = await chatOf(hn);
  await refused("threads.members.add", hn.ctx, { threadId: chat, personId: LEO }, "validation.precondition_failed");
  const ch = await channelOf(hn);
  hn.clear();
  const t = (await ok("threads.members.add", hn.ctx, { threadId: ch.mainThreadId, personId: LEO })).thread;
  assert.deepEqual(t.members.map((m: any) => m.id), [DANA, MAYA, LEO]);
  assert.deepEqual(hn.named("channel.member_added")[0]!.payload, { personId: LEO, by: DANA, threadId: ch.mainThreadId, channelId: ch.channelId });
  await ok("threads.members.add", hn.ctx, { threadId: ch.mainThreadId, personId: LEO });
  assert.equal(hn.named("channel.member_added").length, 1);
  await refused("threads.members.add", hn.ctx, { threadId: ch.mainThreadId, personId: INTAKE }, "validation.bad_input");

  await refused("threads.members.remove", hn.person(MAYA), { threadId: ch.mainThreadId, personId: LEO }, "permission.no_grant");
  await ok("threads.members.remove", hn.person(MAYA), { threadId: ch.mainThreadId, personId: MAYA });
  assert.deepEqual(hn.named("channel.member_removed")[0]!.payload, { personId: MAYA, by: MAYA, threadId: ch.mainThreadId, channelId: ch.channelId });
  const after = await ok("threads.members.remove", hn.ctx, { threadId: ch.mainThreadId, personId: LEO });
  assert.deepEqual(after.thread.members.map((m: any) => m.id), [DANA]);
  await refused("threads.members.remove", hn.ctx, { threadId: ch.mainThreadId, personId: LEO }, "validation.not_found");
  await refused("threads.members.remove", hn.ctx, { threadId: ch.mainThreadId, personId: DANA }, "validation.bad_input");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("threads.mark_read keeps a cursor per person in chat_thread_read; unreadOf counts what is after it", async () => {
  const hn = harness();
  const ch = await channelOf(hn);
  for (const body of ["one", "two", "three"]) await h["chat.post"]!(hn.person(MAYA), { threadId: ch.mainThreadId, body, idempotencyKey: key() });
  await h["chat.post"]!(hn.ctx, { threadId: ch.mainThreadId, body: "mine", idempotencyKey: key() });
  assert.equal(unreadOf(hn.ctx, ch.mainThreadId, DANA), 3, "own messages are never unread");
  assert.equal(unreadOf(hn.ctx, ch.mainThreadId, MAYA), 1);
  assert.deepEqual(await ok("threads.mark_read", hn.ctx, { threadId: ch.mainThreadId, upto: 2 }), { unread: 1 });
  assert.deepEqual(await ok("threads.mark_read", hn.ctx, { threadId: ch.mainThreadId, upto: 1 }), { unread: 1 }, "the cursor never moves back");
  assert.deepEqual(await ok("threads.mark_read", hn.ctx, { threadId: ch.mainThreadId }), { unread: 0 });
  assert.deepEqual(await ok("threads.mark_read", hn.ctx, { threadId: ch.mainThreadId, upto: 99 }), { unread: 0 }, "not past the newest message");
  const rows = hn.rows("SELECT thread, principal, seq FROM chat_thread_read");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!["thread"], ch.mainThreadId);
  assert.equal(rows[0]!["principal"], DANA);
  assert.equal(rows[0]!["seq"], 4);
  assert.equal(unreadOf(hn.ctx, ch.mainThreadId, MAYA), 1, "Maya's cursor is her own");
  assert.deepEqual(await ok("threads.mark_read", hn.agent(INTAKE), { threadId: ch.mainThreadId, upto: 0 }), { unread: 0 }, "an agent reads for the person it acts for");
  ensureReadTable(hn.ctx);
  ensureReadTable(hn.ctx);
  await refused("threads.mark_read", hn.ctx, { threadId: ch.mainThreadId, upto: -1 }, "validation.bad_input");
  await refused("threads.mark_read", hn.ctx, { threadId: "thr_none" }, "validation.not_found");
  const priv = await chatOf(hn);
  await refused("threads.mark_read", hn.person(MAYA), { threadId: priv }, "validation.not_found");
  assert.deepEqual(assertEventsConform(hn), []);
});
