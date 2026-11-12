import test from "node:test";
import assert from "node:assert/strict";
import { agentPicks, vaultPicks, whoPicks } from "./picks.ts";

test("Vault items that can hold a request key are listed by name and handle, and a sign-in, a card or a one-time code is not", () => {
  const out = { items: [
    { id: "vit_1", name: "Acme API", handle: "#Acme_API", kind: "api_key", fieldKeys: ["api_key"] },
    { id: "vit_2", name: "Acme login", handle: "#Acme_login", kind: "login", fieldKeys: ["username", "password"] },
    { id: "vit_3", name: "My Claude", handle: "#My_Claude", kind: "ai_subscription", fieldKeys: ["setup_token"] },
    { id: "vit_4", name: "Visa", handle: "#Visa", kind: "card", fieldKeys: ["number"] },
    { id: "vit_5", name: "No handle", kind: "api_key" },
  ] };
  assert.deepEqual(vaultPicks(out).map((p) => [p.handle, p.fieldKeys]), [["#Acme_API", ["api_key"]], ["#Acme_login", ["username", "password"]]]);
  assert.deepEqual(vaultPicks(undefined), []);
});

test("agents and the people and groups a reviewer can be", () => {
  assert.deepEqual(agentPicks({ agents: [{ agentId: "agt_1", name: "Intake" }, { name: "no id" }] }), [{ id: "agt_1", name: "Intake" }]);
  const who = whoPicks(
    { principals: [{ id: "usr_1", kind: "person", name: "Dana" }, { id: "agt_1", kind: "agent", name: "Intake" }] },
    { groups: [{ groupId: "grp_1", name: "Partners" }] },
  );
  assert.deepEqual(who, [{ assignee: { kind: "person", id: "usr_1" }, name: "Dana" }, { assignee: { kind: "group", id: "grp_1" }, name: "Partners (group)" }]);
});

test("a task's agent picker: a Space Automation offers nobody's Assistant; a Personal one offers only its owner's own", async () => {
  const { taskAgents } = await import("./picks.ts");
  const list = agentPicks({ agents: [
    { agentId: "agt_intake", name: "Intake", kind: "teammate", ownerId: "usr_a" },
    { agentId: "agt_olivia_asst", name: "Assistant", kind: "assistant", ownerId: "usr_olivia" },
    { agentId: "agt_noah_asst", name: "Noah's assistant", kind: "assistant", ownerId: "usr_noah" },
  ] });
  assert.deepEqual(taskAgents(list, "space", "usr_olivia").map((a) => a.id), ["agt_intake"]);
  assert.deepEqual(taskAgents(list, "personal", "usr_olivia").map((a) => a.id), ["agt_intake", "agt_olivia_asst"]);
});

test("an agent on someone's own computer is offered only in its owner's Personal Automation, never in a Space one", async () => {
  const { taskAgents } = await import("./picks.ts");
  const list = agentPicks({ agents: [
    { agentId: "agt_desk", name: "Desk helper", kind: "agent", runtime: "outside", ownerId: "usr_olivia" },
    { agentId: "agt_other_desk", name: "Noah's desk", kind: "agent", runtime: "outside", ownerId: "usr_noah" },
    { agentId: "agt_team", name: "Team", kind: "teammate", runtime: "vyre", ownerId: "usr_noah" },
  ] });
  assert.deepEqual(taskAgents(list, "space", "usr_olivia").map((a) => a.id), ["agt_team"]);
  assert.deepEqual(taskAgents(list, "personal", "usr_olivia").map((a) => a.id), ["agt_desk", "agt_team"]);
});
