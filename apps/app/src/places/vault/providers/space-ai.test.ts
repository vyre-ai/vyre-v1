import test from "node:test";
import assert from "node:assert/strict";
import { formOf, usedForLine, usesOf } from "./space-ai.ts";

const names: Record<string, string> = { grp_ops: "Operations", agt_intake: "Intake", agt_docs: "Docs" };
const nameOf = (id: string): string => names[id] ?? id;

test("a Space AI account's row says what it pays for, in plain words", () => {
  assert.equal(usedForLine({ teamChats: { who: "everyone" } }, null, nameOf), "Used for Team chats");
  assert.equal(usedForLine({ teamChats: { who: ["grp_ops"] } }, null, nameOf), "Used for Team chats for Operations");
  assert.equal(usedForLine({ automations: true, goals: true, agentWork: { which: ["agt_intake", "agt_docs"] } }, 50_000, nameOf), "Used for Automations · Goals · Agents' own work: Intake and Docs · up to $500 a month");
  assert.equal(usedForLine({}, null, nameOf), "Not used for anything yet");
  assert.equal(usedForLine(undefined, undefined, nameOf), "Not used for anything yet");
});

test("the sheet's four rows round-trip to the uses object l-vaultfix stores; empty who is everyone, empty which is all, empty cap removes it", () => {
  const f = formOf({ teamChats: { who: ["grp_ops"] }, agentWork: { which: "all" } }, 12_300);
  assert.deepEqual(f, { teamChats: true, who: ["grp_ops"], automations: false, goals: false, agentWork: true, which: [], cap: "123" });
  assert.deepEqual(usesOf(f), { uses: { teamChats: { who: ["grp_ops"] }, agentWork: { which: "all" } }, capCents: 12_300 });
  assert.deepEqual(usesOf({ ...f, teamChats: true, who: [], cap: "" }), { uses: { teamChats: { who: "everyone" }, agentWork: { which: "all" } }, capCents: null });
  assert.deepEqual(usesOf({ teamChats: false, who: [], automations: true, goals: true, agentWork: false, which: [], cap: "$40" }), { uses: { automations: true, goals: true }, capCents: 4000 });
  assert.equal(usesOf({ ...f, cap: "12.50" }), null, "a cap is whole dollars");
});
