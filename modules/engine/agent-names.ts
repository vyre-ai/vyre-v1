// How the engine names an agent to whoever is reading: the one resolver (owner ruling 3 Nov). access.principals.get names every agent for its reader: an agent the reader may see by its own name, someone else's private
// agent (their assistant, an outside agent they connected) as its person, "Imran Ibarra (Agent)". It is a read, never a permission probe: a call that is refused must not be the way a name is found (rc.43: a plain
// turn refused no call, and agents.get on a private agent was refused and its answer thrown away). Never a raw id: an agent nobody can name reads "An agent".
type Call = (cap: string, input: unknown) => Promise<unknown>;

export const UNNAMED_AGENT = "An agent";

export async function agentDisplay(call: Call, agentId: string): Promise<{ name: string; face?: string }> {
  try {
    const p = (await call("access.principals.get", { principal: { kind: "agent", id: agentId } })) as {
      principal?: { name?: string };
    } | null;
    if (p?.principal?.name && p.principal.name !== agentId) return { name: p.principal.name };
  } catch {
    /* nobody by that id */
  }
  return { name: UNNAMED_AGENT };
}
