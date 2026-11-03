// Ask an agent about a message sent without naming one (owner ruling, 3 Nov 2026): the picker's order and labels, the post that asks (the presser's own reply to that exact message),
// once and never twice, an edit that adds a mention, and the quiet line under your own unanswered message.
import test from "node:test";
import assert from "node:assert/strict";
import { ASK_AGENT_LABEL, addedAgentMentions, askClientId, askPost, pickerAgents, unansweredOwn } from "./askagent.ts";
import type { Message, Thread } from "./model.ts";

const names: Record<string, string> = { usr_me: "Dana Reyes", usr_maya: "Maya Chen", agt_docs: "Docs", agt_mine: "Dana's assistant", agt_intake: "Intake" };
const nameOf = (id: string): string => names[id] ?? id;
const channel = (agents: Array<{ agentId: string; mode: "lead" | "listen" }>): Thread => ({ threadId: "thr_c", kind: "channel", title: "intake", listed: true, planMode: false, members: [], createdAt: 1, agents } as unknown as Thread);
const msg = (id: string, author: { kind: "person" | "agent"; id: string }, body: string): Message => ({ messageId: id, threadId: "thr_c", threadSeq: 1, author, kind: author.kind === "agent" ? "agent" : "text", body, blocks: [], depth: 0, attachments: [], reactions: [], pinned: false, createdAt: 1 } as Message);
const directory = [{ id: "agt_docs", name: "Docs", kind: "agent" as const }, { id: "agt_intake", name: "Intake", kind: "agent" as const }, { id: "usr_maya", name: "Maya Chen", kind: "person" as const }];

test("the picker lists the channel's agents, your own Assistant first as Assistant; another person's Assistant and an outside agent are not offered", () => {
  const t = channel([{ agentId: "agt_docs", mode: "listen" }, { agentId: "agt_mine", mode: "listen" }, { agentId: "agt_intake", mode: "listen" }]);
  const meta = [{ agentId: "agt_docs", name: "Docs", ownerId: "usr_maya", kind: "agent" }, { agentId: "agt_mine", name: "Assistant", ownerId: "usr_me", kind: "assistant" }, { agentId: "agt_intake", name: "Intake", ownerId: "usr_me", kind: "agent" }];
  assert.deepEqual(pickerAgents(t, meta, "usr_me", nameOf).map((a) => a.label), ["Assistant", "Intake", "Docs"]);
  const crowded = channel([{ agentId: "agt_mine", mode: "listen" }, { agentId: "agt_maya_a", mode: "listen" }, { agentId: "agt_cc", mode: "listen" }, { agentId: "agt_docs", mode: "listen" }]);
  const more = [...meta, { agentId: "agt_maya_a", name: "Assistant", ownerId: "usr_maya", kind: "assistant" }, { agentId: "agt_cc", name: "Dana Reyes (Agent)", ownerId: "usr_me", kind: "agent" }];
  assert.deepEqual(pickerAgents(crowded, more, "usr_me", nameOf).map((a) => a.label), ["Assistant", "Docs"], "no one else's Assistant, no outside agent");
  assert.deepEqual(pickerAgents(t, [], "usr_me", nameOf).map((a) => a.label), ["Docs", "Dana's assistant", "Intake"], "before agents.list answers, the names it already knows");
  assert.equal(ASK_AGENT_LABEL, "Ask an Agent…");
});

test("the ask is the presser's own reply to that exact message, naming the agent, so the turn runs on the presser's account", () => {
  const p = askPost("thr_c", "msg_maya1", { id: "agt_docs", name: "Docs" }, "usr_me", "k1");
  assert.deepEqual({ ...p, clientId: undefined }, { threadId: "thr_c", body: "@Docs", mentions: [{ kind: "agent", id: "agt_docs" }], replyTo: "msg_maya1", clientId: undefined, idempotencyKey: "k1" });
  assert.match(p.clientId!, /^msg_[a-z0-9]+$/, "a valid message id");
  assert.equal(askPost("thr_c", "msg_maya1", { id: "agt_docs", name: "Docs" }, "usr_me", "k2").clientId, p.clientId, "the same ask is the same message: once, never twice");
  assert.notEqual(askClientId("msg_maya1", "agt_docs", "usr_maya"), p.clientId, "another person asking is their own ask");
  assert.notEqual(askClientId("msg_maya1", "agt_intake", "usr_me"), p.clientId);
  assert.notEqual(askClientId("msg_other", "agt_docs", "usr_me"), p.clientId);
});

test("an edit asks only the agents it newly names, and only ones in this chat", () => {
  assert.deepEqual(addedAgentMentions("check the dates", "@Docs check the dates", directory, ["agt_docs", "agt_intake"]), ["agt_docs"]);
  assert.deepEqual(addedAgentMentions("@Docs check the dates", "@Docs please check the dates", directory, ["agt_docs"]), [], "already named: no second reply");
  assert.deepEqual(addedAgentMentions("x", "@Intake x", directory, ["agt_docs"]), [], "not in this chat");
  assert.deepEqual(addedAgentMentions("x", "@Maya x", directory, ["agt_docs"]), [], "a person is not an agent");
});

test("the quiet line hangs under your own newest message in a channel when no agent will answer it", () => {
  const listening = channel([{ agentId: "agt_docs", mode: "listen" }]);
  const mine = msg("msg_m1", { kind: "person", id: "usr_me" }, "Can someone check the dates?");
  assert.equal(unansweredOwn(listening, [mine], "usr_me", directory)?.messageId, "msg_m1");
  assert.equal(unansweredOwn(listening, [msg("m", { kind: "person", id: "usr_me" }, "@Docs check")], "usr_me", directory), null, "named an agent");
  assert.equal(unansweredOwn(listening, [msg("m", { kind: "person", id: "usr_me" }, "@Maya can you?")], "usr_me", directory), null, "spoke to a person");
  assert.equal(unansweredOwn(listening, [mine, msg("a", { kind: "agent", id: "agt_docs" }, "On it")], "usr_me", directory), null, "an agent answered");
  assert.equal(unansweredOwn(listening, [msg("m", { kind: "person", id: "usr_maya" }, "x")], "usr_me", directory), null, "someone else's");
  assert.equal(unansweredOwn(channel([{ agentId: "agt_docs", mode: "lead" }]), [mine], "usr_me", directory), null, "a lead answers");
  assert.equal(unansweredOwn({ ...listening, kind: "chat" } as Thread, [mine], "usr_me", directory), null, "only in a channel");
});
