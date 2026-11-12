// One way to name an agent that works for a person (lead, 12 Nov 2026: "Maya's Assistant", never "Maya Lin (Agent)"). Every place that prints such a name, the server's directory and the
// app's credits alike, comes through here, so the words never drift. A person's Assistant is "<First>’s Assistant", the same name the agents module gives it when it is made (agents/crud
// assistantNames). An outside agent a person connected (Claude Code, Codex) is credited to its person, "Maya Lin (Agent)": it is not their Assistant, and its own name stays private.

/** "Maya’s", "James’": the possessive the agents module names an Assistant with. */
export const possessive = (name: string): string => (/s$/i.test(name) ? `${name}’` : `${name}’s`);

/** A person's Assistant, by its person's name: "Maya Lin" gives "Maya’s Assistant". No name gives "Assistant". */
export function assistantName(personName: string): string {
  const first = personName.trim().split(/\s+/)[0] ?? "";
  return first === "" ? "Assistant" : `${possessive(first.charAt(0).toUpperCase() + first.slice(1))} Assistant`;
}

/** An agent named by the person it works for: their Assistant as "Maya’s Assistant", any other agent of theirs as "Maya Lin (Agent)". */
export function agentOfName(personName: string, kind: "assistant" | "outside"): string {
  return kind === "assistant" ? assistantName(personName) : `${personName} (Agent)`;
}

/** Does this name already say whose agent it is ("Maya’s Assistant", "Maya Lin (Agent)")? Then nothing more is added to it. */
export const namesItsPerson = (name: string): boolean => / \(Agent\)$/.test(name) || /[’']s? Assistant$/.test(name) || name === "Assistant";

/** A line that marks an agent ("Edited by Dex (Agent)"), without marking one twice ("Maya’s Assistant", never "Maya’s Assistant (Agent)"). */
export const markedAgent = (name: string): string => (namesItsPerson(name) ? name : `${name} (Agent)`);

/**
 * An agent that acted for a person, as every credit says it (lead, 12 Nov: one name everywhere). The reader's directory already names it: someone else's Assistant "Maya’s Assistant", their
 * outside agent "Maya Lin (Agent)", the reader's own agents by their own names. Only an agent the directory does not know is named here, from its person.
 */
export function agentForPerson(agentId: string, personId: string, o: { nameOf(id: string): string; known(id: string): boolean; assistant?: boolean }): string {
  return o.known(agentId) ? o.nameOf(agentId) : agentOfName(o.nameOf(personId), o.assistant === true ? "assistant" : "outside");
}
