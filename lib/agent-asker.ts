// The rule for what an agent may READ or SHOW, once, for every module (modules do not import each other, so it lives here, beside owner-asked.ts).
//
// When an agent acts for a person (ctx.actingFor), what it may read or show in that turn is bounded by what that person may themselves see. The agent's own standing on a thing (it leads a goal, it started
// a run, it created an Automation, it sits in a chat, it owns a Shared item) lets it WORK on the thing in turns for the thing's owner or for nobody (a wake, a routine, a hand-off): that is the agent's job.
// It never widens what another person who merely asked that agent can see. "The principal is an agent with standing, so allow" is therefore wrong on its own; use agentStanding().
//
// A call with no actingFor, or from anything that is not an agent (a person, the server), is judged by its own standing as before.
interface Caller {
  principal: { kind: string; id: string };
  actingFor?: string | undefined;
}

/**
 * Does the caller's own standing count for this read? True for a person, the server, and an agent acting for nobody. For an agent acting for a person, true only when `askerMay(person)` says that person may
 * themselves see the thing (they own it, are on it, can open the chat, hold the run, and so on).
 */
export function agentStanding(ctx: Caller, askerMay: (person: string) => boolean): boolean {
  // "acting for" names a person (usr_...); an agent acting for another agent, or for nobody, has no person to be bounded by
  if (ctx.principal.kind !== "agent" || ctx.actingFor === undefined || !ctx.actingFor.startsWith("usr_")) return true;
  return askerMay(ctx.actingFor);
}
