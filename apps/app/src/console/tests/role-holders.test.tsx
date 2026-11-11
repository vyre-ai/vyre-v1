// Roles count people and agents apart (owner walk, 12 Nov 2026: "Member, 4 holders" in a Space with one member and three agents).
import test from "node:test";
import assert from "node:assert/strict";
import { holdersLine, splitOf } from "../pages/Roles.tsx";

test("a role's holders read as people and agents, never one number that mixes them", () => {
  const holders = [{ kind: "person" }, { kind: "agent" }, { kind: "agent" }, { kind: "agent" }];
  assert.equal(holdersLine(4, splitOf(holders)), "1 person, 3 agents");
  assert.equal(holdersLine(2, { people: 2, agents: 0 }), "2 people");
  assert.equal(holdersLine(1, { people: 0, agents: 1 }), "1 agent");
  assert.equal(holdersLine(0, { people: 0, agents: 0 }), "0 people");
  assert.equal(holdersLine(4, undefined), "4 holders", "until the split is read, the plain count");
});
