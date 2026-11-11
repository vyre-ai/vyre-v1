// Which Vault items a team agent's shared computer may hold (owner rule, 12 Nov: a secret is never readable by another person who asks the same team agent). A team agent's workspace and browser
// profile are shared by everyone who may ask that agent: one user, one set of files, one PATH. Any of them can plant a program that saves the next person's command environment, and no scrubber
// stops that. So in a team agent's places a value is used only when the item was shared for that:
//   1. a share of the item (or a Vault folder above it) with the agent, a group it is in or the whole Space, held to every condition the Vault applies to that share for the exact field the handle
//      names (start and end, expiry, the ceiling against the item's label, hidden fields, a filter): kernel `sharedThrough`. Such a share says everyone who can ask the agent may use it through it.
//      The agent's own grant on the Space through its role is not a share of the item.
//   2. or, without one, every person who may ask the agent may use that field of the item themselves (the same kernel resolution, as each of them), and the asker is one of them.
// A Mine item never qualifies, except where the computer is the asker's alone: their own Assistant, their private agent (asked by nobody else), or a terminal on their own computer. In a Personal
// Space one person asks every agent, so nothing is gated. The decision comes before the Vault is asked, so a refusal is never recorded as a use; it is recorded as a refusal.
// Everything that cannot be told is a refusal: an agent with no row, an empty or unreadable set of askers, an asker not among them.
import type { VaultLookup } from "./engine-session.ts";

type Who = { agentId: string; asker: string; where: "host" | "device" | "computer"; account?: boolean; place?: string; device?: string };
export interface LookupSource { lookup(handle: string, who: Who): Promise<VaultLookup> }

/** Work that runs as no agent in particular and has no computer of its own (the same list as engine-session.ts NOT_AN_AGENT). Only these may pass without an agent row. */
export const NO_COMPUTER_AGENTS: ReadonlySet<string> = new Set(["step", "room-digest", "memory-upkeep"]);

export interface TeamItem { itemId: string; scope: string; fieldKeys: readonly string[] }

export interface TeamVaultDeps {
  /** Is this a Team Space? A Personal Space has one person, who asks every agent. */
  team: boolean;
  /** The agent's kind and owner; null for no such agent. */
  agentOf(agentId: string): { kind: string; ownerId: string } | null;
  /** The item a handle names for this asker, as the Vault resolves it (their own Mine item first, else a shared one); null when none. */
  resolve(handle: string, asker: string): TeamItem | null;
  /** The same by id, for a handle the Vault resolved some other way (an alias). */
  itemById(itemId: string): TeamItem | null;
  /** Clause 1: the item is shared with the agent itself for these fields (kernel sharedThrough on vault_item and vault_folder grants). */
  sharedWithAgent(agentId: string, itemId: string, fields: readonly string[]): boolean;
  /** Everyone who may ask this agent; null when that cannot be told. */
  askersOf(agentId: string): readonly string[] | null;
  /** May this person use these fields of the item (kernel authorize)? */
  personMayUse(personId: string, itemId: string, fields: readonly string[]): boolean;
  /** The person whose computer this device is; null when not known. */
  deviceOwner(deviceId: string): string | null;
  /** A refusal, recorded as one (never as a use). */
  refused(r: { agentId: string; asker: string; handle: string; itemId: string | null; reason: TeamReason }): void;
}

export type TeamReason = "team_agent" | "team_shared" | "team_unknown_agent";

/** Why not, or null to go on: the decision for one item, before the Vault is asked. */
export function decide(d: TeamVaultDeps, at: string, asker: string, item: TeamItem, field: string | undefined): TeamReason | null {
  const agent = d.agentOf(at);
  if (agent === null) return "team_unknown_agent";
  const askers = d.askersOf(at);
  // the asker's own: their Assistant, or their private agent that nobody else may ask (counted, never assumed)
  if (agent.ownerId === asker && (agent.kind === "assistant" || (askers !== null && askers.length === 1 && askers[0] === asker))) return null;
  if (item.scope !== "shared") return "team_agent";
  const fields = field !== undefined ? [field] : [...item.fieldKeys];
  if (d.sharedWithAgent(at, item.itemId, fields)) return null;
  if (askers !== null && askers.length > 0 && askers.includes(asker) && askers.every((p) => d.personMayUse(p, item.itemId, fields))) return null;
  return "team_shared";
}

export function gateTeamAgents<S extends LookupSource>(source: S, d: TeamVaultDeps): S {
  return {
    ...source,
    async lookup(handle: string, who: Who): Promise<VaultLookup> {
      // the turn's own account key goes to the engine process on the host, never into an agent's computer
      if (!d.team || who.account === true) return source.lookup(handle, who);
      // a terminal on the asker's own computer is their shell, not a shared one: decided by the computer the session is on, which the agent does not choose
      if (who.where === "device" && who.device !== undefined && d.deviceOwner(who.device) === who.asker) return source.lookup(handle, who);
      // whose computer it is: the caller's own, or its parent's for a helper working in the parent's workspace
      const at = who.place ?? who.agentId;
      if (NO_COMPUTER_AGENTS.has(at)) return source.lookup(handle, who);
      const field = /^#[^.]+\.(.+)$/.exec(handle)?.[1];
      const refuse = (itemId: string | null, reason: TeamReason): VaultLookup => { d.refused({ agentId: at, asker: who.asker, handle, itemId, reason }); return { kind: "denied", reason }; };
      const item = d.resolve(handle, who.asker);
      if (item !== null) {
        const why = decide(d, at, who.asker, item, field);
        if (why !== null) return refuse(item.itemId, why);
        return source.lookup(handle, who);
      }
      // a handle only the Vault itself can resolve (an alias): decided on what it resolved to, and refused when that cannot be read
      const r = await source.lookup(handle, who);
      if (r.kind !== "value") return r;
      const byId = d.itemById(r.itemId);
      const why = byId === null ? "team_shared" : decide(d, at, who.asker, byId, field);
      return why === null ? r : refuse(r.itemId, why);
    },
  };
}
