// The team-agent rule for Vault values (team-vault.ts), against stand-ins: a team agent's computer holds only items the agent itself may use; a person's own Assistant and a Personal Space are as before.
import test from "node:test";
import assert from "node:assert/strict";
import { gateTeamAgents } from "./team-vault.ts";
import type { VaultLookup } from "./engine-session.ts";

const value = (itemId: string): VaultLookup => ({ kind: "value", itemId, value: "v-0123456789", spaceOnly: false, injectIntoDeployments: false });
const AGENTS: Record<string, { kind: string; ownerId: string }> = { agt_team: { kind: "agent", ownerId: "usr_owner" }, agt_dana_asst: { kind: "assistant", ownerId: "usr_dana" } };
const SCOPE: Record<string, string> = { vit_mine: "mine", vit_agent: "shared", vit_dana_only: "shared", vit_space: "shared", vit_group: "shared" };
// what the agent itself (acting for nobody) may use: the item shared with it, with the whole Space, with a group it is in
const AGENT_USES = new Set(["agt_team:vit_agent", "agt_team:vit_space", "agt_team:vit_group", "agt_team:vit_dana_only"]);   // the agent holds a grant on the whole Space, so it reaches Dana's item too
// who may ask the team agent, and what each may use: an item shared with the agent and with everyone who asks it; Dana's own is hers alone
const ASKERS = ["usr_dana", "usr_omar"];
const PERSON_USES = new Set(["usr_dana:vit_agent", "usr_dana:vit_space", "usr_omar:vit_space", "usr_dana:vit_group", "usr_omar:vit_group", "usr_dana:vit_dana_only"]);
const gate = (team = true) => gateTeamAgents({ lookup: async (h: string) => value(h.slice(1)) }, {
  team, agentOf: (a) => AGENTS[a] ?? null, agentMayUse: (a, i) => AGENT_USES.has(`${a}:${i}`), itemScope: (i) => SCOPE[i] ?? null,
  askersOf: (a) => (a === "agt_team" ? ASKERS : ["usr_dana"]), personMayUse: (p, i) => PERSON_USES.has(`${p}:${i}`),
  // shares of the item itself: with the agent, with a group it is in, with the whole Space (Omar is in none of them for vit_agent: the share with the agent is the consent)
  sharedWithAgent: (a, i) => a === "agt_team" && ["vit_agent", "vit_space", "vit_group"].includes(i),
});
const ask = (g: ReturnType<typeof gate>, item: string, agentId: string, extra: Record<string, unknown> = {}) => g.lookup(`#${item}`, { agentId, asker: "usr_dana", where: "computer", ...extra });

test("a team agent's computer: a private item is refused, an item shared with the agent, the whole Space or a group it is in is used, an item shared only with the asker is refused", async () => {
  const g = gate();
  assert.deepEqual(await ask(g, "vit_mine", "agt_team"), { kind: "denied", reason: "team_agent" });
  assert.equal((await ask(g, "vit_agent", "agt_team")).kind, "value");
  assert.equal((await ask(g, "vit_space", "agt_team")).kind, "value");
  assert.equal((await ask(g, "vit_group", "agt_team")).kind, "value");
  assert.deepEqual(await ask(g, "vit_dana_only", "agt_team"), { kind: "denied", reason: "team_agent" });
});

test("the asker's own Assistant, a Personal Space, a helper in an Assistant's workspace and the turn's own account are as before", async () => {
  const g = gate();
  assert.equal((await ask(g, "vit_mine", "agt_dana_asst")).kind, "value", "a private item in the asker's own Assistant");
  assert.equal((await ask(g, "vit_dana_only", "agt_dana_asst")).kind, "value", "an item shared only with the asker, in their Assistant");
  assert.equal((await ask(gate(false), "vit_mine", "agt_team")).kind, "value", "a Personal Space");
  assert.equal((await ask(g, "vit_mine", "agt_helper", { place: "agt_dana_asst" })).kind, "value", "a helper working in the Assistant's workspace goes by whose computer it is");
  assert.deepEqual(await ask(g, "vit_mine", "agt_helper", { place: "agt_team" }), { kind: "denied", reason: "team_agent" }, "and in a team agent's workspace by that");
  assert.equal((await ask(g, "vit_mine", "agt_team", { account: true })).kind, "value", "the account key goes to the engine on the host, not into a computer");
});
