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
