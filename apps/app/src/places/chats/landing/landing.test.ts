// @tsx
// The first screen's rules: who a new chat starts with, what sits under the composer and what it says.
import test from "node:test";
import assert from "node:assert/strict";
import { LANDING_NEEDS, moreLine, startInput, workingChats, workingLine } from "./model.ts";
import type { RecentOut } from "./model.ts";

test("a new chat starts with who is picked, and with the Assistant when nobody is", () => {
  assert.deepEqual(startInput([], "agt_me"), { agentIds: ["agt_me"] });
  assert.deepEqual(startInput([{ id: "agt_me", name: "Assistant", kind: "assistant" }], "agt_me"), { agentIds: ["agt_me"] });
  assert.deepEqual(startInput([{ id: "a", name: "Mira", kind: "agent" }, { id: "p", name: "Sara", kind: "person" }], "agt_me"), { agentIds: ["a"], personId: "p" });
  assert.deepEqual(startInput([{ id: "p", name: "Sara", kind: "person" }], "agt_me"), { agentIds: [], personId: "p" });
});

test("the top three need you and the rest are a line that leads to Tasks", () => {
  assert.equal(LANDING_NEEDS, 3);
  assert.equal(moreLine(3, 3), null);
  assert.equal(moreLine(4, 3), "1 more in Tasks");
  assert.equal(moreLine(11, 3), "8 more in Tasks");
});

test("what is running shows once per chat, with who is on it", () => {
  const row = (threadId: string, working: boolean, agents: string[]) => ({ threadId, kind: "chat", title: threadId, agents, unread: 0, working, starred: false, lastAt: 1 });
  const recent = { starred: [row("a", true, ["m", "e", "r"])], today: [row("a", true, ["m", "e", "r"]), row("b", false, ["m"])], yesterday: [], earlier: [], archived: [], nextUnread: null } as unknown as RecentOut;
  const w = workingChats(recent);
  assert.deepEqual(w.map((x) => x.threadId), ["a"]);
  assert.equal(workingLine(w[0]!), "3 working in a");
  assert.deepEqual(workingChats(undefined), []);
});
