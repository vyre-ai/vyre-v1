// An agent born before its maker was active in the snapshot is Guest with no Space grant; once the maker may edit the Space it becomes a Member agent (and a second run changes nothing).
import test from "node:test";
import assert from "node:assert/strict";
import { agentGrantId, lowAgentUpgradeEvents } from "../src/gateway/principals.ts";

const agent = (id: string, owner: string, roleNames: string) => ({ id, owner, roleNames });
const edit = () => "edit" as const;

test("a Guest agent whose maker may edit the Space gets the Member role and an edit grant under ids made from the agent", () => {
  const ev = lowAgentUpgradeEvents({ space: "spc_a", agents: [agent("agt_one", "usr_dana", "Guest")], levelOf: edit });
  assert.deepEqual(ev.map((e) => e.type), ["principal.role_set", "grant.created"]);
  assert.deepEqual(ev[0]!.payload, { holder: "agt_one", role: "rol_member" });
  assert.equal(ev[1]!.id, agentGrantId("agt_one", "grown"));
  assert.equal(ev[1]!.payload["subject_id"], "agt_one");
  assert.equal(ev[1]!.payload["resource_id"], "spc_a");
  assert.equal(ev[1]!.payload["level"], "edit");
  assert.deepEqual(lowAgentUpgradeEvents({ space: "spc_a", agents: [agent("agt_one", "usr_dana", "Guest")], levelOf: edit }).map((e) => e.id), ev.map((e) => e.id), "same ids every run");
});

test("an agent already Member, one whose maker cannot edit, and a malformed id are left alone", () => {
  const levels: Record<string, "edit" | "view" | "none"> = { usr_dana: "edit", usr_view: "view", usr_none: "none" };
  const ev = lowAgentUpgradeEvents({
    space: "spc_a", levelOf: (p) => levels[p] ?? "none",
    agents: [agent("agt_member", "usr_dana", "Member"), agent("agt_view", "usr_view", "Guest"), agent("agt_none", "usr_none", "Guest"), agent("agent-bad", "usr_dana", "Guest"), agent("agt_two", "usr_dana", "Member, Guest")],
  });
  assert.deepEqual(ev, []);
});
