// An agent in Records is a row in the record store; the agent itself lives in the agents module. This is the pure part of finding the one behind the other: the row's name against the
// agents the person can see (the same name rule agents.create uses, so "  Intake  " and "intake" are one agent), and the words of the page that says an agent was never set up.
export interface AgentLite { agentId: string; name: string; face?: string; role?: string; status?: string }

export const nameKey = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

/** The agent a record stands for, by name; null when no agent has that name. */
export function agentFor(name: string, agents: readonly AgentLite[]): AgentLite | null {
  const k = nameKey(name);
  return k === "" ? null : agents.find((a) => nameKey(a.name) === k) ?? null;
}

/** Every agent the person can see, teammates included, across pages. */
export async function listAgents(call: (cap: string, input: unknown) => Promise<unknown>): Promise<AgentLite[]> {
  const out: AgentLite[] = [];
  let cursor: string | undefined;
  do {
    const r = await call("agents.list", { teammates: "include", ...(cursor ? { cursor } : {}) }) as { agents: AgentLite[]; next?: string };
    out.push(...r.agents);
    cursor = r.next;
  } while (cursor);
  return out;
}

export type AgentsRow = { kind: "agent"; agent: AgentLite } | { kind: "old"; recordId: string; name: string };

/** The agents, then the rows no agent stands behind. */
export function agentsRows(agents: readonly AgentLite[], rows: readonly { id: string; fields: Record<string, unknown> }[], titleField: string): AgentsRow[] {
  const old = rows.flatMap((r): AgentsRow[] => {
    const name = String(r.fields[titleField] ?? "").trim();
    return name === "" || agentFor(name, agents) ? [] : [{ kind: "old", recordId: r.id, name }];
  });
  return [...agents.map((agent): AgentsRow => ({ kind: "agent", agent })), ...old];
}

export const NOT_SET_UP = "This agent was not set up.";
export const SET_UP = "Set it up";
