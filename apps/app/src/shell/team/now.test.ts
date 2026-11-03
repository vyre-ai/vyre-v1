// The team "Now" view (owner D24): one model for the Chats sidebar and Console Overview.
import test from "node:test";
import assert from "node:assert/strict";
import { presenceMap, teamNow, workingLine } from "./now.ts";

const people: Record<string, string> = { usr_omar: "Omar Reyes", usr_ada: "Ada Lane", usr_bea: "Bea Baker" };
const agents: Record<string, string> = { agt_intake: "Intake", agt_ledger: "Ledger" };
const personName = (id: string): string => people[id] ?? "Someone";
const agentName = (id: string): string => agents[id] ?? "An agent";

test("a working line says where, for whom and on what, in words; a chat the viewer cannot read stays private", () => {
  assert.equal(workingLine({ agentId: "agt_intake", forPerson: "usr_omar", where: "space", since: 1, threadId: "thr_1", title: "sales", channelId: "chn_1" }, personName), "in #sales for Omar Reyes, on the Space");
  assert.equal(workingLine({ agentId: "agt_intake", forPerson: "usr_omar", where: "computer", since: 1 }, personName), "in a private chat for Omar Reyes, on their computer");
  assert.equal(workingLine({ agentId: "agt_intake", forPerson: "", where: "server", since: 1, threadId: "thr_2", title: "Smith intake" }, personName), "in Smith intake, on their server");
  assert.equal(workingLine({ agentId: "agt_intake", forPerson: "usr_omar", where: "space", since: 1, threadId: "thr_1", title: "sales", channelId: "chn_1" }, personName, true), "in #sales for Omar Reyes", "short leaves out the usual place");
  assert.equal(workingLine({ agentId: "agt_intake", forPerson: "usr_omar", where: "computer", since: 1 }, personName, true), "in a private chat for Omar Reyes, on their computer", "short keeps an unusual place");
});

test("Now: people around (online first, you left out) and one row per working agent, its newest turn", () => {
  const n = teamNow({
    me: "usr_ada", personName, agentName,
    presence: [{ personId: "usr_ada", state: "online" }, { personId: "usr_omar", state: "away" }, { personId: "usr_bea", state: "online" }, { personId: "usr_zed", state: "offline" }],
    working: [
      { agentId: "agt_ledger", forPerson: "usr_bea", where: "space", since: 5 },
      { agentId: "agt_intake", forPerson: "usr_omar", where: "space", since: 1, threadId: "thr_1", title: "sales", channelId: "chn_1" },
      { agentId: "agt_intake", forPerson: "usr_bea", where: "space", since: 9, threadId: "thr_9", title: "ops", channelId: "chn_9" },
    ],
  });
  assert.deepEqual(n.people, [{ id: "usr_bea", name: "Bea Baker", state: "online" }, { id: "usr_omar", name: "Omar Reyes", state: "away" }]);
  assert.deepEqual(n.agents.map((a) => `${a.name}: ${a.line}`), ["Intake: in #ops for Bea Baker, on the Space", "Ledger: in a private chat for Bea Baker, on the Space"]);
  assert.ok(!/usr_|agt_|thr_|chn_/.test(JSON.stringify(n.agents.map((a) => a.line))), "names, never ids");
});

test("the dot map holds online and away only; nobody else carries a mark", () => {
  const m = presenceMap([{ personId: "usr_a", state: "online" }, { personId: "usr_b", state: "away" }, { personId: "usr_c", state: "offline" }]);
  assert.deepEqual([...m], [["usr_a", "online"], ["usr_b", "away"]]);
});
