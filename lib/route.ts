// Who answers a message (ARCH 6.5, spec 2.5 and 4.13). One pure function shared by the client (the composer line "Intake will reply", computed over the local replica)
// and the server (engine enqueue), so the label can never disagree with what happens.
//
//   1. m @mentions agents A: responders = A (minus the author).
//   2. else m is addressed to a person (@person, or a reply to someone else's message, no agent mention): nobody.
//   3. else: the one lead agent of the thread, if any.
// Listeners never run inference per message: no rule above ever returns one unless it was @mentioned. A message from an agent counts one hop (message.depth);
// at the agent_hops limit (default 4) nothing runs until a person replies.

export interface RouteAgent { id: string; mode: "lead" | "listen"; /** a watcher acts unasked as a routine and is never the one agent that answers */ watching?: boolean }
export interface RouteThread { agents: readonly RouteAgent[]; /** the thread kind when known: only a person's chat has a lone agent that answers whatever its mode says */ kind?: string }
export interface RouteMention { kind: "agent" | "person"; id: string }
export interface RouteMessage {
  author: { kind: "person" | "agent"; id: string };
  mentions: readonly RouteMention[];
  /** Agent-to-agent hops since the last person message. Persons reset it to 0. */
  depth?: number;
  /** The person whose message this replies to, when it is a reply to a person. */
  replyToPerson?: string | undefined;
}
export interface RoutePolicy { agentHops?: number }
export type RouteReason = "mention" | "person_addressed" | "lead" | "no_lead" | "hop_limit";
export interface RouteResult {
  responders: string[];
  reason: RouteReason;
  /** Agents given as context only ("Docs is listening"); they never run unless in responders. */
  listeners: string[];
}

export const DEFAULT_AGENT_HOPS = 4;
const PERSON_CHATS: ReadonlySet<string> = new Set(["chat", "ask"]);

export function route(thread: RouteThread, m: RouteMessage, policy: RoutePolicy = {}): RouteResult {
  const limit = policy.agentHops ?? DEFAULT_AGENT_HOPS;
  const listeners = thread.agents.filter((a) => a.mode === "listen").map((a) => a.id);
  const done = (responders: string[], reason: RouteReason): RouteResult => ({ responders, reason, listeners });

  const fromAgent = m.author.kind === "agent";
  if (fromAgent && (m.depth ?? 0) >= limit) return done([], "hop_limit");

  const mentionedAgents = [...new Set(m.mentions.filter((x) => x.kind === "agent").map((x) => x.id))].filter((id) => !(fromAgent && id === m.author.id));
  if (mentionedAgents.length) return done(mentionedAgents, "mention");
  if (m.mentions.some((x) => x.kind === "agent")) return done([], "mention");   // only self-mentions: an agent never answers itself

  if (m.mentions.some((x) => x.kind === "person")) return done([], "person_addressed");
  // two people talking: a reply to the other person is for them, and the lead stays out of it
  if (m.replyToPerson !== undefined && m.replyToPerson !== m.author.id) return done([], "person_addressed");

  // the only agent in a person's chat answers that person whatever its mode says: listening means nothing with no one else to lead. Not a message the host posts (a nudge, a baton line, svc_...),
  // not an agent's, not a run, helper, channel or console thread, and never a watcher.
  const solo = thread.agents.length === 1 && thread.agents[0]!.watching !== true && !fromAgent && !m.author.id.startsWith("svc_") && (thread.kind === undefined || PERSON_CHATS.has(thread.kind));
  const lead = thread.agents.find((a) => a.mode === "lead") ?? (solo ? thread.agents[0] : undefined);
  if (!lead || (fromAgent && lead.id === m.author.id)) return done([], "no_lead");
  return done([lead.id], "lead");
}

/** The depth a reply to `m` carries: agent messages add a hop, person messages reset to zero. */
export function nextDepth(m: Pick<RouteMessage, "author" | "depth">): number {
  return m.author.kind === "agent" ? (m.depth ?? 0) + 1 : 0;
}
