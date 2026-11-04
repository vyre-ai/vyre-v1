// A chat's one name in the list: the title the server made or a person gave, else who is in it. No first line of a message and no date stand in for it (lib/chat-name.ts has the rule, rowOf applies it).
import assert from "node:assert/strict";
import { test } from "node:test";
import { displayTitle } from "./titles.ts";
import { rowOf } from "./model.ts";

const item = (over: Record<string, unknown>) => ({ threadId: "thr_1", kind: "chat", title: "", agents: [], unread: 0, working: false, starred: false, lastAt: 1, ...over }) as never;
const agentName = (id: string): string => ({ agt_dex: "Dex", agt_mira: "Mira" }[id] ?? id);
const personName = (id: string): string => ({ usr_aliza: "Aliza", usr_omar: "Omar" }[id] ?? id);

test("one name in the list: a direct message is the person, a chat with no real title shows who is in it, a real title wins", () => {
  assert.equal(displayTitle(rowOf(item({ title: "Heyy", people: ["usr_aliza"] }), agentName, personName)), "Aliza");
  assert.equal(displayTitle(rowOf(item({ title: "", agents: ["agt_dex"] }), agentName, personName)), "Dex");
  assert.equal(displayTitle(rowOf(item({ title: "New chat", agents: ["agt_dex"], people: ["usr_aliza"] }), agentName, personName)), "Dex and Aliza");
  assert.equal(displayTitle(rowOf(item({ title: "GHL onboarding goal", agents: ["agt_dex"] }), agentName, personName)), "GHL onboarding goal");
});

import { titleOf } from "../conversation/model.ts";

test("the sidebar and the header agree on every kind of chat, and renaming changes both", () => {
  const nameOf = (id: string): string => agentName(id.startsWith("usr_") ? personName(id) : id).replace("usr_", "");
  const cases = [
    { title: "Heyy", agents: [] as string[], people: ["usr_aliza"] },
    { title: "", agents: ["agt_dex"], people: [] as string[] },
    { title: "", agents: ["agt_dex"], people: ["usr_aliza"] },
    { title: "GHL onboarding goal", agents: ["agt_dex"], people: ["usr_aliza"] },
  ];
  for (const c of cases) {
    const row = rowOf(item({ title: c.title, agents: c.agents, people: c.people }), agentName, personName);
    const thread = { threadId: "thr_1", kind: "chat", title: c.title, agents: c.agents.map((agentId) => ({ agentId, mode: "lead" })), members: [{ kind: "person", id: "usr_me" }, ...c.people.map((id) => ({ kind: "person", id }))] } as never;
    assert.equal(titleOf(thread, (id) => (id.startsWith("agt_") ? agentName(id) : personName(id)), "usr_me"), displayTitle(row), JSON.stringify(c));
  }
  void nameOf;
  // a rename is a title: both show it, except in a direct message, which is always the person
  const renamed = rowOf(item({ title: "Sara notes", agents: ["agt_dex"], people: ["usr_aliza"] }), agentName, personName);
  assert.equal(displayTitle(renamed), "Sara notes");
});
