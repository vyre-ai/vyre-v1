// How the engine names an agent to whoever is reading: the one resolver (owner ruling 3 Nov). An agent the reader may see is named by agents.get; someone else's private agent (their assistant,
// an outside agent they connected) by access.principals.get, which answers it as its person, "Irfad Imtiaz (Agent)". Never a raw id: an agent nobody can name reads "An agent".
type Call = (cap: string, input: unknown) => Promise<unknown>;

export const UNNAMED_AGENT = "An agent";

export async function agentDisplay(call: Call, agentId: string): Promise<{ name: string; face?: string }> {
  try {
    const a = (await call("agents.get", { agentId })) as { agent?: { name?: string; face?: string } } | null;
    if (a?.agent?.name) return { name: a.agent.name, ...(a.agent.face ? { face: a.agent.face } : {}) };
  } catch { /* someone else's private agent, or gone: access names it */ }
  try {
    const p = (await call("access.principals.get", { principal: { kind: "agent", id: agentId } })) as { principal?: { name?: string } } | null;
    if (p?.principal?.name && p.principal.name !== agentId) return { name: p.principal.name };
  } catch { /* nobody by that id */ }
  return { name: UNNAMED_AGENT };
}
