// Who may use which profile of the Space browser (DESIGN-agent-workspaces.md): the agent itself drives its own profile; a person never drives another's. To watch and take over, by how the agent is shared
// (the agents module's one rule, agents.share_class, the same sections agents.list uses):
//   * private (a person's Assistant, an outside agent) and personal (shared with nobody): its owner only;
//   * shared with named people: the owner and those people may watch, only the owner and admins take over;
//   * shared with the whole Space (a team agent, like Dex): its owner and the Space's owners and admins watch and take over.
// Pure, so the rule is one place and a test can walk every case.

import { sha256Hex } from "../../../kernel/src/log/hash.ts";

/** The same rule as images/space-browser/browserd/profiles.ts (a test holds the two together): a profile id becomes a folder name. */
export const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/;

export interface ProfileAgent {
  agentId: string;
  /** The person the agent belongs to. */
  ownerId: string;
  /** agents.share_class. */
  class: "private" | "personal" | "shared" | "space";
  /** The people it is shared with by name, without the owner. */
  people?: readonly string[] | undefined;
}

export type ProfileAccess = "owner" | "admin" | "viewer" | "none";

/** The profile of an agent: its id. An Assistant is an agent, so a person's Assistant has a profile of its own. The agent's owner, and a turn acting for nobody, use this one: what was signed in before is theirs. */
export function profileIdOf(agentId: string): string | null {
  return PROFILE_ID.test(agentId) ? agentId : null;
}

/**
 * The profile of a person who uses a shared agent without owning it (owner, 13 Nov, P7 section 10 item 6: only the sign-ins the asker may use): the agent's id, a dash and the person's id, so their cookies,
 * logins and tabs are their own and another person's turn of the same agent never browses as them. Longer than a profile id may be: the person's id is shortened to a hash of it. Folder-safe, and the same
 * every time, so a profile is found again after sleep, restart and update.
 */
export function askerProfileId(agentId: string, person: string): string | null {
  if (!PROFILE_ID.test(agentId)) return null;
  const safe = person.replace(/[^A-Za-z0-9_-]/g, "_");
  const whole = `${agentId}-${safe}`;
  if (PROFILE_ID.test(whole)) return whole;
  const short = `${agentId.slice(0, 44)}-${sha256Hex(person).slice(0, 24)}`;
  return PROFILE_ID.test(short) ? short : null;
}

/** May this person watch this agent's browser, and as what? `isAdmin` is computers.use at manage for the Space. */
export function profileAccess(agent: ProfileAgent, person: string, isAdmin: boolean): ProfileAccess {
  if (agent.ownerId === person) return "owner";
  if (agent.class === "private" || agent.class === "personal") return "none";
  if (isAdmin) return "admin";
  if (agent.class === "shared" && agent.people?.includes(person)) return "viewer";
  return "none";
}

export const mayWatchProfile = (agent: ProfileAgent, person: string, isAdmin: boolean): boolean =>
  profileAccess(agent, person, isAdmin) !== "none";
/** Taking over and giving back: the owner and admins, not a person the agent was only shared with. */
export const mayTakeOver = (access: ProfileAccess): boolean => access === "owner" || access === "admin";
