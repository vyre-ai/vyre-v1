// The team-agent rule for Vault values (team-vault.ts), against stand-ins for the kernel's answers: what is used where, what fails closed, and that a refusal is decided before the Vault is asked.
import test from "node:test";
import assert from "node:assert/strict";
import { gateTeamAgents, NO_COMPUTER_AGENTS } from "./team-vault.ts";
import type { TeamItem, TeamVaultDeps } from "./team-vault.ts";
import type { VaultLookup } from "./engine-session.ts";

const ITEMS: Record<string, TeamItem> = {
  "#Dana_Mine": { itemId: "vit_mine", scope: "mine", fieldKeys: ["key"] },
  "#For_Scout": { itemId: "vit_agent", scope: "shared", fieldKeys: ["key"] },
  "#Everyone_Key": { itemId: "vit_space", scope: "shared", fieldKeys: ["key"] },
  "#Dana_Only": { itemId: "vit_dana_only", scope: "shared", fieldKeys: ["key"] },
  "#Bank": { itemId: "vit_bank", scope: "shared", fieldKeys: ["user", "password"] },
  "#Space_Owned": { itemId: "vit_space_owned", scope: "shared", fieldKeys: ["key"] },
};
const AGENTS: Record<string, { kind: string; ownerId: string }> = {
  agt_scout: { kind: "agent", ownerId: "usr_owner" }, agt_dana_asst: { kind: "assistant", ownerId: "usr_dana" }, agt_dana_private: { kind: "agent", ownerId: "usr_dana" },
  agt_lonely: { kind: "agent", ownerId: "usr_owner" },
};
const ASKERS: Record<string, string[] | null> = { agt_scout: ["usr_dana", "usr_omar"], agt_dana_asst: ["usr_dana"], agt_dana_private: ["usr_dana"], agt_lonely: [] };
/** Shares of the item with the agent itself, per field: Bank is shared with Everyone with its password hidden (the kernel's answer for that field is no). */
const SHARED: Record<string, (f: readonly string[]) => boolean> = {
  "agt_scout:vit_agent": () => true, "agt_scout:vit_space": () => true, "agt_scout:vit_space_owned": () => true, "agt_scout:vit_bank": (f) => !f.includes("password"),
};
const USES = new Set(["usr_dana:vit_agent", "usr_dana:vit_space", "usr_omar:vit_space", "usr_dana:vit_dana_only", "usr_dana:vit_bank", "usr_omar:vit_bank:user"]);

function rig(over: Partial<TeamVaultDeps> = {}) {
  const asked: string[] = [];
  const refused: Array<{ handle: string; reason: string }> = [];
  const deps: TeamVaultDeps = {
    team: true, agentOf: (a) => AGENTS[a] ?? null, resolve: (h) => ITEMS[h.replace(/\..*$/, "")] ?? null, itemById: () => null,
    sharedWithAgent: (a, i, f) => SHARED[`${a}:${i}`]?.(f) ?? false, askersOf: (a) => (a in ASKERS ? ASKERS[a]! : null),
    personMayUse: (p, i, f) => USES.has(`${p}:${i}`) || f.every((x) => USES.has(`${p}:${i}:${x}`)), deviceOwner: (d) => (d === "dev_dana_mac" ? "usr_dana" : null),
    refused: (r) => { refused.push({ handle: r.handle, reason: r.reason }); },
    ...over,
  };
  const value = (h: string): VaultLookup => ({ kind: "value", itemId: ITEMS[h.replace(/\..*$/, "")]?.itemId ?? h, value: "v-0123456789", spaceOnly: false, injectIntoDeployments: false });
  const g = gateTeamAgents({ lookup: async (h: string) => { asked.push(h); return value(h); } }, deps);
  const ask = async (h: string, agentId: string, extra: Record<string, unknown> = {}) => {
    const r = await g.lookup(h, { agentId, asker: "usr_dana", where: "computer", ...extra });
    return r.kind === "value" ? "value" : `denied:${(r as { reason: string }).reason}`;
  };
  return { ask, asked, refused };
}

test("a team agent: shared with the agent, Everyone or a Space-owned item used; Mine and asker-only refused with their own reasons, decided before the Vault is asked", async () => {
  const r = rig();
  assert.equal(await r.ask("#For_Scout.key", "agt_scout"), "value");
  assert.equal(await r.ask("#Everyone_Key.key", "agt_scout"), "value");
  assert.equal(await r.ask("#Space_Owned.key", "agt_scout"), "value", "an item the Space owns, shared with the agent");
  assert.equal(await r.ask("#Dana_Mine.key", "agt_scout"), "denied:team_agent");
  assert.equal(await r.ask("#Dana_Only.key", "agt_scout"), "denied:team_shared");
  assert.deepEqual(r.asked, ["#For_Scout.key", "#Everyone_Key.key", "#Space_Owned.key"], "a refusal never asks the Vault, so no use is recorded");
  assert.deepEqual(r.refused.map((x) => x.reason), ["team_agent", "team_shared"], "each refusal is recorded as one");
});

test("fourth look 1: a share that hides the field the handle names does not count, and neither does an asker who may use only another field", async () => {
  const r = rig();
  assert.equal(await r.ask("#Bank.user", "agt_scout"), "value", "the field the share gives");
  assert.equal(await r.ask("#Bank.password", "agt_scout"), "denied:team_shared", "the field it hides: Omar may not use it, so it never reaches Scout's computer");
  assert.equal(await r.ask("#Bank", "agt_scout"), "denied:team_shared", "no field named: judged on every field");
});

test("fourth look 2: fail closed: an agent with no row, an empty or unreadable set of askers, an asker not among them", async () => {
  assert.equal(await rig().ask("#For_Scout.key", "agt_deleted"), "denied:team_unknown_agent");
  assert.equal(await rig({ sharedWithAgent: () => false }).ask("#Everyone_Key.key", "agt_lonely"), "denied:team_shared", "nobody may ask it: clause 2 does not pass on an empty set");
  assert.equal(await rig({ sharedWithAgent: () => false, askersOf: () => null }).ask("#Everyone_Key.key", "agt_scout"), "denied:team_shared");
  assert.equal(await rig({ sharedWithAgent: () => false, askersOf: () => ["usr_omar"], personMayUse: () => true }).ask("#Everyone_Key.key", "agt_scout"), "denied:team_shared", "the asker is not among those who may ask");
  // the pseudo-agents that have no computer of their own pass, and only they
  assert.deepEqual([...NO_COMPUTER_AGENTS].sort(), ["memory-upkeep", "room-digest", "step"]);
  for (const a of NO_COMPUTER_AGENTS) assert.equal(await rig().ask("#Dana_Mine.key", a), "value", a);
});

test("over-blocks: the asker's own Assistant, their private agent, their own computer and a Personal Space are not gated; a private agent someone else may ask is", async () => {
  const r = rig();
  assert.equal(await r.ask("#Dana_Mine.key", "agt_dana_asst"), "value");
  assert.equal(await r.ask("#Dana_Mine.key", "agt_dana_private"), "value", "a private agent only Dana may ask is hers");
  assert.equal(await rig({ askersOf: (a) => (a === "agt_dana_private" ? ["usr_dana", "usr_omar"] : null) }).ask("#Dana_Mine.key", "agt_dana_private"), "denied:team_agent", "once Omar may ask it too, it is shared");
  assert.equal(await r.ask("#Dana_Mine.key", "agt_scout", { where: "device", device: "dev_dana_mac" }), "value", "a terminal on Dana's own computer");
  assert.equal(await r.ask("#Dana_Mine.key", "agt_scout", { where: "device", device: "dev_omar_mac" }), "denied:team_agent", "someone else's computer");
  assert.equal(await r.ask("#Dana_Mine.key", "agt_scout", { where: "device" }), "denied:team_agent", "a device the session does not name");
  assert.equal(await rig({ team: false }).ask("#Dana_Mine.key", "agt_scout"), "value", "a Personal Space");
  assert.equal(await r.ask("#Dana_Mine.key", "agt_scout", { account: true }), "value", "the turn's own account key goes to the engine on the host");
});

test("fifth look 2: the value is used only when the Vault returned the very item the gate judged", async () => {
  const refused: string[] = [];
  const g = gateTeamAgents({ lookup: async () => ({ kind: "value", itemId: "vit_other_api", value: "v-0123456789", spaceOnly: false, injectIntoDeployments: false }) }, {
    team: true, agentOf: () => ({ kind: "agent", ownerId: "usr_owner" }), resolve: () => ({ itemId: "vit_api_a", scope: "shared", fieldKeys: ["key"] }), itemById: () => null,
    sharedWithAgent: (_a, i) => i === "vit_api_a", askersOf: () => ["usr_dana"], personMayUse: () => false, deviceOwner: () => null, refused: (r) => { refused.push(String(r.itemId)); },
  });
  const r = await g.lookup("#Api.key", { agentId: "agt_scout", asker: "usr_dana", where: "computer" });
  assert.deepEqual(r, { kind: "denied", reason: "team_shared" }, "the gate judged A; the Vault answered with B");
  assert.deepEqual(refused, ["vit_other_api"]);
});

test("fifth look: a handle with no field on an item whose fields cannot be read is refused", async () => {
  const g = gateTeamAgents({ lookup: async () => ({ kind: "value", itemId: "vit_x", value: "v-0123456789", spaceOnly: false, injectIntoDeployments: false }) }, {
    team: true, agentOf: () => ({ kind: "agent", ownerId: "usr_owner" }), resolve: () => ({ itemId: "vit_x", scope: "shared", fieldKeys: [] }), itemById: () => null,
    sharedWithAgent: () => true, askersOf: () => ["usr_dana"], personMayUse: () => true, deviceOwner: () => null, refused: () => undefined,
  });
  assert.deepEqual(await g.lookup("#X", { agentId: "agt_scout", asker: "usr_dana", where: "computer" }), { kind: "denied", reason: "team_shared" });
});

test("a computer's own Vault calls (vault.items.match, vault.use) are held to the same rule: no Mine item, a Shared one only as shared for the agent; refused before the Vault is asked (lead 12 Nov)", async () => {
  const byId = Object.fromEntries(Object.values(ITEMS).map((i) => [i.itemId, i]));
  const refused: string[] = [];
  const called: Array<{ cap: string; item?: unknown }> = [];
  const deps: TeamVaultDeps = {
    team: true, agentOf: (a) => AGENTS[a] ?? null, resolve: (h) => ITEMS[h.replace(/\..*$/, "")] ?? null, itemById: (id) => byId[id] ?? null,
    sharedWithAgent: (a, i, f) => SHARED[`${a}:${i}`]?.(f) ?? false, askersOf: (a) => (a in ASKERS ? ASKERS[a]! : null),
    personMayUse: (p, i, f) => USES.has(`${p}:${i}`) || f.every((x) => USES.has(`${p}:${i}:${x}`)), deviceOwner: () => null, refused: (r) => { refused.push(`${r.handle}:${r.reason}`); },
  };
  const source = {
    lookup: async (): Promise<VaultLookup> => ({ kind: "unknown" }),
    invoke: async (cap: string, input: Record<string, unknown>) => {
      called.push({ cap, item: input["item"] });
      if (cap === "vault.items.match") return { items: ["vit_mine", "vit_agent", "vit_dana_only", "vit_space"].map((id) => ({ item: { id } })) };
      const item = ITEMS[`#${String(input["item"]).replace(/^#/, "")}`];
      return { itemId: item?.itemId ?? "vit_unknown", handle: input["item"], fields: ["key"] };
    },
  };
  const g = gateTeamAgents(source, deps) as typeof source;
  const who = { agentId: "agt_scout", asker: "usr_dana" };
  const match = (await g.invoke("vault.items.match", { url: "https://x.example" }, who)) as { items: Array<{ item: { id: string } }> };
  assert.deepEqual(match.items.map((x) => x.item.id), ["vit_agent", "vit_space"], "her Mine item and an item not every asker may use are not listed in a team agent's computer");
  await assert.rejects(g.invoke("vault.use", { item: "#Dana_Mine" }, who), (e: unknown) => (e as { error?: { code?: string } }).error?.code === "permission.no_grant");
  await assert.rejects(g.invoke("vault.use", { item: "Dana_Only" }, who));
  assert.deepEqual(called.filter((c) => c.cap === "vault.use"), [], "refused before the Vault was asked: no use recorded");
  assert.deepEqual(refused, ["#Dana_Mine:team_agent", "Dana_Only:team_shared"]);
  assert.deepEqual(await g.invoke("vault.use", { item: "#For_Scout" }, who), { itemId: "vit_agent", handle: "#For_Scout", fields: ["key"] });
  // her own Assistant's computer is hers: nothing changes there
  assert.equal(((await g.invoke("vault.items.match", { url: "https://x.example" }, { agentId: "agt_dana_asst", asker: "usr_dana" })) as { items: unknown[] }).items.length, 4);
});
