// K9 guard (13 Nov 2026): what each kind of chat's right pane opens on, as one table.
import test from "node:test";
import assert from "node:assert/strict";
import { paneAction, paneSubject } from "./subject.ts";
import type { PaneSubject, SubjectThread } from "./subject.ts";

const ME = "usr_me", ASSISTANT = "agt_assistant";
const person = (id: string) => ({ kind: "person", id });
const agent = (id: string) => ({ kind: "agent", id });

const TABLE: ReadonlyArray<[string, SubjectThread, PaneSubject]> = [
  ["a one-to-one chat with a person opens on that person", { kind: "chat", members: [person(ME), person("usr_maya")], agents: [] }, { kind: "person", id: "usr_maya" }],
  ["the assistant sitting in a one-to-one chat does not take the pane", { kind: "chat", members: [person(ME), person("usr_maya"), agent(ASSISTANT)], agents: [{ agentId: ASSISTANT }] }, { kind: "person", id: "usr_maya" }],
  ["a chat with one agent opens on the agent", { kind: "chat", members: [person(ME), agent("agt_dex")], agents: [{ agentId: "agt_dex" }] }, { kind: "agent" }],
  ["a chat with only the assistant opens on the assistant", { kind: "chat", members: [person(ME)], agents: [{ agentId: ASSISTANT }] }, { kind: "agent" }],
  ["a chat with two agents is a group", { kind: "chat", members: [person(ME), agent("agt_dex"), agent("agt_nova")], agents: [{ agentId: "agt_dex" }, { agentId: "agt_nova" }] }, { kind: "group" }],
  ["a chat with several people is a group", { kind: "chat", members: [person(ME), person("usr_a"), person("usr_b")], agents: [] }, { kind: "group" }],
  ["a person and an agent together are a group", { kind: "chat", members: [person(ME), person("usr_a"), agent("agt_dex")], agents: [{ agentId: "agt_dex" }] }, { kind: "group" }],
  ["a channel opens on the channel, whoever is in it", { kind: "channel", channelId: "chn_launch", members: [person(ME), agent("agt_dex")], agents: [{ agentId: "agt_dex" }] }, { kind: "channel", channelId: "chn_launch" }],
  ["two people in a chat that also carries a lead agent is a group, as the server counts it (modules/chat/handlers/post.ts isDirect: two people and no agent)", { kind: "chat", members: [person(ME), person("usr_maya")], agents: [{ agentId: "agt_dex" }] }, { kind: "group" }],
  ["one person with two agents is a group chat, the sidebar's word for it (places/chats/sidebar/model.ts)", { kind: "chat", members: [person(ME), agent("agt_a"), agent("agt_b")], agents: [{ agentId: "agt_a" }, { agentId: "agt_b" }] }, { kind: "group" }],
  ["a goal's chat with a person and an agent is the goal's, not a group: it keeps today's pane", { kind: "chat", scopeType: "goal", members: [person(ME), person("usr_maya")], agents: [{ agentId: "agt_dex" }] }, { kind: "agent" }],
  ["a task's chat is the task's, not a group", { kind: "chat", scopeType: "task", members: [person(ME), person("usr_maya")], agents: [{ agentId: "agt_dex" }] }, { kind: "agent" }],
  ["a reply thread keeps the agent", { kind: "thread", members: [person(ME), person("usr_a")], agents: [] }, { kind: "agent" }],
  ["a helper chat keeps the agent", { kind: "helper", members: [], agents: [] }, { kind: "agent" }],
];

for (const [name, thread, want] of TABLE) test(`pane subject: ${name}`, () => assert.deepEqual(paneSubject(thread, ME, ASSISTANT), want));

const base = { paneOpen: true, hasSubject: true, threadId: "thr_1", settledFor: null, rightOn: null, autoTab: null };
test("pane action: a closed pane clears its choice; an open one with a subject selects it once", () => {
  assert.equal(paneAction({ ...base, paneOpen: false }), "clear");
  assert.equal(paneAction(base), "select");
  assert.equal(paneAction({ ...base, settledFor: "thr_1" }), "skip");
  assert.equal(paneAction({ ...base, settledFor: "thr_0" }), "select", "another chat chooses again");
});

test("pane action: Knows, Skills and Hooks requests settle the chat, so they win even when they open a closed pane", () => {
  // the request marks the chat settled (ChatsMounted: onTab, openSkills, openHooks) before the parent effect reads it
  assert.equal(paneAction({ ...base, settledFor: "thr_1", rightOn: null }), "skip");
});

test("pane action: a face the person pressed is kept; the pane's own earlier choice is replaced", () => {
  assert.equal(paneAction({ ...base, rightOn: "profile:usr_x", autoTab: null }), "keep");
  assert.equal(paneAction({ ...base, rightOn: "profile:usr_maya", autoTab: "profile:usr_maya" }), "select");
  assert.equal(paneAction({ ...base, hasSubject: false }), "skip");
  assert.equal(paneAction({ ...base, threadId: null }), "skip");
});
