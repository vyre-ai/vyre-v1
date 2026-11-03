// Private agents in the shell's directory. A person's assistant and an outside agent they connected through /mcp are theirs alone: the agents module answers agents.list with only the agents this
// person may use, so any other agent principal is someone else's private one. It keeps its name, with its person's, so what it did in a shared place stays attributed ("Simba · Irfad's agent"),
// but it is never offered: not in the @mention picker, not in Cmd-K, not as a chat to open.
import type { Principal } from "../../places/home/sections-a/data.tsx";

export interface PrincipalIn { id: string; name: string; kind: string; owner?: string }

/** One access principal as the shell's directory holds it. `usable` is the set agents.list answered, or null while it loads (nothing is marked private until it is known). */
export function principalOf(x: PrincipalIn, own: { id: string; name: string }, meId: string, usable: ReadonlySet<string> | null): Principal {
  const kind = x.kind === "person" ? "person" : "agent";
  const out: Principal = { id: x.id, name: x.id === own.id ? own.name : x.name, kind };
  if (kind === "agent" && x.owner !== undefined) out.owner = x.owner;
  if (kind === "agent" && x.id.startsWith("agt_") && usable !== null && !usable.has(x.id) && x.owner !== meId) out.private = true;
  return out;
}

/** May this person be offered this principal (a mention, a Cmd-K hit, a chat to start)? */
export const offered = (p: object): boolean => (p as { private?: boolean }).private !== true;

/** How a principal is named where it acted: someone else's private agent carries its person, "Simba · Irfad's agent". */
export function attributed(p: Principal | undefined, nameOf: (id: string) => string | undefined): string | undefined {
  if (p === undefined) return undefined;
  if (p.private !== true || p.owner === undefined) return p.name;
  const owner = nameOf(p.owner);
  if (owner === undefined || owner === "") return p.name;
  const first = owner.split(" ")[0] ?? owner;
  return `${p.name} · ${first}’s agent`;
}
