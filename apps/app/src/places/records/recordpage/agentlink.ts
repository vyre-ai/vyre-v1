// An agent in Records is a row in the record store; the agent itself lives in the agents module. This is the pure part of finding the one behind the other: the row's name against the
// agents the person can see (the same name rule agents.create uses, so "  Intake  " and "intake" are one agent), and the words of the page that says an agent was never set up.
export interface AgentLite { agentId: string; name: string; face?: string; role?: string; status?: string }

export const nameKey = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

/** The agent a record stands for, by name; null when no agent has that name. */
export function agentFor(name: string, agents: readonly AgentLite[]): AgentLite | null {
  const k = nameKey(name);
  return k === "" ? null : agents.find((a) => nameKey(a.name) === k) ?? null;
}

export const NOT_SET_UP = "This agent was not set up.";
export const SET_UP = "Set it up";
