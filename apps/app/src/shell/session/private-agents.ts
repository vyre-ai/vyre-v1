// Private agents in the shell's directory, the one place every screen turns an id into a name and a face. A person's assistant and an outside agent they connected through /mcp are theirs
// alone: agents.list answers each person with only the agents they may use, so any other agent principal with an owner is someone else's private one. Owner ruling (3 Nov): to everyone else,
// whatever it did is credited to its person, "Irfad Imtiaz (Agent)", with the person's face; its own name never shows. It is never offered: not to @mention, not in Cmd-K, not as a chat.
// The person themselves sees their agents by name. Logs (Console audit) add which agent it was in a details line, from `agentName`.
import type { Principal } from "../../places/home/sections-a/data.tsx";

export interface PrincipalIn { id: string; name: string; kind: string; owner?: string; private?: boolean; agentName?: string }

/** How someone else's private agent is named: its person, marked as their agent. The server already answers it so (access.principals.list); this is the same words. */
export const asAgentOf = (personName: string): string => `${personName} (Agent)`;

/**
 * The shell's directory from access.principals.list and the set agents.list answered (`usable`, null while it loads). The server names someone else's private agent as its person and marks it
 * `private`, with its own name (`agentName`) for owners and admins only. An agent that is not the person's and not in agents.list is not offered either.
 * `own` is this person's assistant, named as the shell names it.
 */
export function directoryOf(rows: readonly PrincipalIn[], own: { id: string; name: string }, meId: string, usable: ReadonlySet<string> | null): Principal[] {
  const people = new Map<string, string>();
  for (const x of rows) if (x.kind === "person") people.set(x.id, x.name);
  return rows.map((x) => {
    const kind = x.kind === "person" ? "person" : "agent";
    const out: Principal = { id: x.id, name: x.id === own.id ? own.name : x.name, kind };
    if (kind !== "agent" || x.owner === undefined) return out;
    out.owner = x.owner;
    if (x.private === true) {
      out.private = true;
      // an older server names it by its own name: never show that to someone else
      if (!x.name.endsWith(" (Agent)")) out.name = asAgentOf(people.get(x.owner) ?? "Someone");
      if (x.agentName !== undefined) out.agentName = x.agentName;
    } else if (x.owner !== meId && x.id.startsWith("agt_") && usable !== null && !usable.has(x.id)) out.hidden = true;
    return out;
  });
}

/** May this person be offered this principal (a mention, a Cmd-K hit, a chat to start)? */
export const offered = (p: object): boolean => (p as { private?: boolean }).private !== true && (p as { hidden?: boolean }).hidden !== true;

/** Agent id to person id, for the faces of private agents (ui/Avatar setStandIns). */
export function standInsOf(list: readonly Principal[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of list) if (p.private === true && p.owner !== undefined) out.set(p.id, p.owner);
  return out;
}
