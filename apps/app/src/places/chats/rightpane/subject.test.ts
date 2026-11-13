// K9 guard (13 Nov 2026): what each kind of chat's right pane opens on, as one table.
import test from "node:test";
import assert from "node:assert/strict";
import { paneSubject } from "./subject.ts";
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
  ["a reply thread keeps the agent", { kind: "thread", members: [person(ME), person("usr_a")], agents: [] }, { kind: "agent" }],
  ["a helper chat keeps the agent", { kind: "helper", members: [], agents: [] }, { kind: "agent" }],
];

for (const [name, thread, want] of TABLE) test(`pane subject: ${name}`, () => assert.deepEqual(paneSubject(thread, ME, ASSISTANT), want));
