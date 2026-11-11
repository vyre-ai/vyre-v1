// Which Vault items a team agent's shared computer may hold (owner rule, 12 Nov: a secret is never readable by another person who asks the same team agent). A team agent's workspace and browser
// profile are shared by everyone who may ask that agent: one user, one set of files, one PATH. Any of them can plant a program that saves the next person's command environment, and no scrubber
// stops that. So in a team agent's places a value is used only when the item was shared for that: a share of the item (or its Vault folder) with the agent, with a group it is in, or with the
// whole Space, which says everyone who can ask the agent may use it through the agent; or, without one, when everyone who may ask the agent may use the item themselves. The agent's own grants
// through its role are not a share: an agent a person made holds a grant on the whole Space, which reaches every shared item. A Mine item never qualifies. In a person's own Assistant (its workspace and browser are theirs alone), and in a Personal Space
// (one person asks every agent), nothing changes. This wraps the Vault lookup the daemon gives the terminal and the browser fill (agent computers too), so it covers every place a value is filled
// into an agent's computer: terminal_run, chrome_* fills, Vyre for Chrome's own fills inside the profile, and the old desktop's Vault channel.
import type { VaultLookup } from "./engine-session.ts";

type Who = { agentId: string; asker: string; where: "host" | "device" | "computer"; account?: boolean; place?: string };
export interface LookupSource { lookup(handle: string, who: Who): Promise<VaultLookup> }

export interface TeamVaultDeps {
  /** Is this a Team Space? A Personal Space has one person, who asks every agent. */
  team: boolean;
  /** The agent's kind and owner; null for no such agent (an automation step, a one-shot request: no computer of its own). */
  agentOf(agentId: string): { kind: string; ownerId: string } | null;
  /** Does the agent itself hold Use on the item (the access engine)? */
  agentMayUse(agentId: string, itemId: string): boolean;
  /** Is the item, or a Vault folder above it, shared with this agent, a group it is in, or the whole Space (a share of the item itself, not the agent's role)? */
  sharedWithAgent(agentId: string, itemId: string): boolean;
  /** Everyone who may ask this agent (people with Use on it); null when that cannot be told. */
  askersOf(agentId: string): readonly string[] | null;
  /** May this person use the item themselves? */
  personMayUse(personId: string, itemId: string): boolean;
  /** "mine" or "shared"; null when the item is not known. */
  itemScope(itemId: string): string | null;
}

export function gateTeamAgents<S extends LookupSource>(source: S, d: TeamVaultDeps): S {
  return {
    ...source,
    async lookup(handle: string, who: Who): Promise<VaultLookup> {
      const r = await source.lookup(handle, who);
      // the turn's own account key goes to the engine process on the host, never into an agent's computer
      if (!d.team || r.kind !== "value" || who.account === true) return r;
      // whose computer it is: the caller's own, or its parent's for a helper working in the parent's workspace
      const at = who.place ?? who.agentId;
      const agent = d.agentOf(at);
      if (agent === null) return r;
      if (agent.kind === "assistant" && agent.ownerId === who.asker) return r;
      if (d.itemScope(r.itemId) === "shared" && d.agentMayUse(at, r.itemId)) {
        if (d.sharedWithAgent(at, r.itemId)) return r;
        const askers = d.askersOf(at);
        if (askers !== null && askers.every((p) => d.personMayUse(p, r.itemId))) return r;
      }
      return { kind: "denied", reason: "team_agent" };
    },
  };
}
