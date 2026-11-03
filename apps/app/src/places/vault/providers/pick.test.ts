import test from "node:test";
import assert from "node:assert/strict";
import { aiCaption, aiName, aiOptions, automaticLine, keptFor, spaceAccounts } from "./pick.ts";
import type { PickRow } from "./pick.ts";

const credits: PickRow = { id: "prv_a", name: "Anthropic API · Team credits", handle: "#Team_Credits", scope: "shared", state: "ok", uses: { automations: true, goals: true, agentWork: { which: ["agt_intake"] } } };
const chats: PickRow = { id: "prv_o", name: "OpenCode Go · Team key", handle: "#OpenCode", scope: "shared", state: "ok", uses: { teamChats: { who: "everyone" } } };
const legacy: PickRow = { id: "prv_l", name: "Old Space key", handle: "#Old", scope: "mine", spaceKey: true, state: "ok" };
const mine: PickRow = { id: "prv_m", name: "My Claude", handle: "#My", scope: "mine", state: "ok" };
const noHandle: PickRow = { id: "prv_x", name: "No handle", scope: "shared", uses: { automations: true } };

test("only Space accounts with a handle are offered: shared keys and the old Space AI key, never a Mine account", () => {
  assert.deepEqual(spaceAccounts([credits, chats, legacy, mine, noHandle]).map((r) => r.id), ["prv_a", "prv_o", "prv_l"]);
});

test("an account is kept for the work its uses say; the old Space AI key is kept for all of it; agent work names the agent", () => {
  assert.equal(keptFor(credits, "automations"), true);
  assert.equal(keptFor(chats, "automations"), false);
  assert.equal(keptFor(legacy, "automations"), true);
  assert.equal(keptFor(credits, "agentWork", "agt_intake"), true);
  assert.equal(keptFor(credits, "agentWork", "agt_other"), false);
  assert.equal(keptFor(credits, "agentWork"), false, "an agent not made yet is not named");
  assert.equal(keptFor({ ...chats, uses: { agentWork: { which: "all" } } }, "agentWork", "agt_any"), true);
});

test("the options start with Automatic and give the reason an account cannot be picked", () => {
  const o = aiOptions([credits, chats, { ...legacy, state: "failing" }], "automations");
  assert.deepEqual(o.map((x) => [x.value, x.label]), [["", "Automatic"], ["#Team_Credits", "Anthropic API · Team credits"], ["#OpenCode", "OpenCode Go · Team key"], ["#Old", "Old Space key"]]);
  assert.equal(o[1]!.blocked, undefined);
  assert.match(o[2]!.blocked!, /Not used for automations/);
  assert.match(o[3]!.blocked!, /Check the key/);
  assert.match(aiOptions([credits], "agentWork", "agt_other")[1]!.blocked!, /Not used for this agent's own work/);
  assert.equal(aiOptions([{ ...credits, capped: true }], "automations")[1]!.capped, true);
});

test("names, captions and the Automatic line", () => {
  assert.equal(aiName([credits], undefined), "Automatic");
  assert.equal(aiName([credits], "#Team_Credits"), "Anthropic API · Team credits");
  assert.equal(aiName([credits], "#Gone"), "#Gone");
  assert.equal(aiCaption(undefined, [credits]), "Cheapest that fits");
  assert.equal(aiCaption("#Team_Credits", [credits]), "Space AI account");
  assert.equal(aiCaption("#Team_Credits", [{ ...credits, capped: true }]), "Space AI account, at its monthly cap");
  assert.equal(automaticLine([credits, chats], "automations"), "Today: Anthropic API · Team credits.");
  assert.equal(automaticLine([credits, { ...chats, uses: { automations: true } }], "automations"), "Today: Anthropic API · Team credits or OpenCode Go · Team key.");
  assert.match(automaticLine([chats], "automations"), /No Space AI account is kept for automations yet/);
  assert.match(automaticLine([{ ...credits, capped: true }], "automations"), /No Space AI account/);
});
