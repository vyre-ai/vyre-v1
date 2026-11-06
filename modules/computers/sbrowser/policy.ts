// Who may use which profile of the Space browser (DESIGN-agent-workspaces.md): the agent itself drives its own profile; a person never drives another's. To watch and take over:
//   * a person's Assistant: that person only;
//   * a personal agent (made for one person, not shared with the team): its owner only;
//   * a team agent (like Dex): its owner, and owners and admins of the Space (computers.use at manage).
// Pure, so the rule is one place and a test can walk every case.
/** The same rule as images/space-browser/browserd/profiles.ts (a test holds the two together): a profile id becomes a folder name. */
export const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/;

export interface ProfileAgent {
  agentId: string;
  /** The person the agent belongs to. */
  ownerId: string;
  kind?: "assistant" | "teammate" | "agent" | undefined;
  /** Shared with the team (a team agent). A personal agent is not. Unknown counts as personal: the narrower rule. */
  team?: boolean | undefined;
}

export type ProfileAccess = "owner" | "admin" | "none";

/** The profile of an agent: its id. An Assistant is an agent, so a person's Assistant has a profile of its own. */
export function profileIdOf(agentId: string): string | null {
  return PROFILE_ID.test(agentId) ? agentId : null;
}

/** May this person watch and take over this agent's browser? `isAdmin` is computers.use at manage for the Space. */
export function profileAccess(agent: ProfileAgent, person: string, isAdmin: boolean): ProfileAccess {
  if (agent.ownerId === person) return "owner";
  if (agent.kind === "assistant") return "none";
  if (agent.team === true && isAdmin) return "admin";
  return "none";
}

export const mayWatchProfile = (agent: ProfileAgent, person: string, isAdmin: boolean): boolean => profileAccess(agent, person, isAdmin) !== "none";
