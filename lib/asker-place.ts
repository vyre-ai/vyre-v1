// Who gets a place of their own in a shared agent's computer (owner, 13 Nov 2026, P7 section 10 item 6: "a turn sees only the asker's work folder plus the agent's own home, and uses only the sign-ins the
// asker may use"). One rule for the agent's terminal (a folder and a tmux server of their own, modules/terminal/asker.ts) and its browser (a profile of its own, modules/computers/sbrowser/policy.ts), so
// the two never disagree about whose sign-ins a turn may use. The agent's owner keeps what the agent already has (its home, its browser profile: the sign-ins made before this rule are theirs); a
// person's own Assistant and an outside agent are private to one person already; a turn acting for nobody (a wake, a routine) is the agent itself. Everyone else who uses the agent gets a place.

export interface AgentFacts {
  ownerId?: string | undefined;
  kind?: string | undefined;
  runtime?: string | undefined;
}

/** Does `person`, using the agent `agentId` (a turn acting for them, or their own tab), get a place of their own? Unknown facts are no place: the agent's own, as before. */
export function hasOwnPlace(
  agent: AgentFacts | undefined | null,
  agentId: string,
  person: string | undefined,
): person is string {
  if (person === undefined || person === "" || person === agentId || !person.startsWith("usr_")) return false;
  // an agent whose owner is not known (its facts could not be read, a stand-in without one) is the agent's own place: nothing changes
  if (agent === undefined || agent === null || agent.ownerId === undefined || agent.ownerId === "") return false;
  if (agent.kind === "assistant" || agent.runtime === "outside") return false;
  return agent.ownerId !== person;
}
