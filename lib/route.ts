// Who answers a message (ARCH 6.5, spec 2.5 and 4.13). One pure function shared by the client (the composer line "Intake will reply", computed over the local replica)
// and the server (engine enqueue), so the label can never disagree with what happens.
//
//   1. m @mentions agents A: responders = A (minus the author).
//   2. else m is addressed to a person who is in the chat (@person, or a reply to someone else's message, no agent mention): nobody, unless it also names the lead ("Dex, ask Aliza..."). A person who is not
//      in the chat is a reference, not an address: the message goes on to rules 3 and 4 as if they were not named.
//   3. else a person speaks to every agent in the chat ("both of you", "each of you", "everyone"): every agent answers, each on its own (a discussion).
//   4. else: the one lead agent of the thread, if any.
// Listeners never run inference per message: no rule above ever returns one unless it was @mentioned. A message from an agent counts one hop (message.depth);
// at the agent_hops limit (default 8, owner ruling 3 Nov 2026) nothing runs until a person replies or presses Continue. Helpers and teammates count: a helper's brief and the result
// it brings back (a Job's line) each carry the next hop, so an agent that starts a helper after every result stops at the same budget.

export interface RouteAgent { id: string; /** the name people say it by, for a message that names the agent in words */ name?: string; mode: "lead" | "listen"; /** a watcher acts unasked as a routine and is never the one agent that answers */ watching?: boolean }
export interface RouteThread { agents: readonly RouteAgent[]; /** a thread on the person's own task, note or goal: no one else is in it unless the people list says so */ personal?: boolean; /** the people in the chat, when known: a mention of anyone else is a reference. Left out: every mentioned person is taken to be in it. */ people?: readonly string[]; /** the thread kind when known: only a person's chat has a lone agent that answers whatever its mode says */ kind?: string }
export interface RouteMention { kind: "agent" | "person"; id: string }
export interface RouteMessage {
  author: { kind: "person" | "agent"; id: string };
  mentions: readonly RouteMention[];
  /** Agent-to-agent hops since the last person message. Persons reset it to 0. */
  depth?: number;
  /** The person whose message this replies to, when it is a reply to a person. */
  replyToPerson?: string | undefined;
  /** A Job's own line, verified by chat.post: its brief or its result. It reaches the lead even when the lead wrote it, and it counts against the hop budget like any agent turn. */
  job?: boolean;
  /** The words, when known: a person who speaks to all the agents gets an answer from each. */
  text?: string;
}
export interface RoutePolicy { agentHops?: number }
export type RouteReason = "mention" | "person_addressed" | "all" | "lead" | "no_lead" | "hop_limit";
export interface RouteResult {
  responders: string[];
  reason: RouteReason;
  /** Agents given as context only ("Docs is listening"); they never run unless in responders. */
  listeners: string[];
}

export const DEFAULT_AGENT_HOPS = 8;
/** Words that speak to every agent in the chat. */
export const ALL_AGENTS = /\b(both of you|each of you|all of you|you two|you both|you all|everyone|everybody|all agents)\b/i;
/** Does the text name this agent in words (\"Dex, can you...\")? Whole words, any case. */
export function namedIn(text: string, name: string): boolean {
  const n = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return n !== "" && new RegExp(`(^|[^\\p{L}\\p{N}_])${n}(?![\\p{L}\\p{N}_])`, "iu").test(text);
}
const PERSON_CHATS: ReadonlySet<string> = new Set(["chat", "ask"]);

export function route(thread: RouteThread, m: RouteMessage, policy: RoutePolicy = {}): RouteResult {
  const limit = policy.agentHops ?? DEFAULT_AGENT_HOPS;
  const listeners = thread.agents.filter((a) => a.mode === "listen").map((a) => a.id);
  const done = (responders: string[], reason: RouteReason): RouteResult => ({ responders, reason, listeners });

  const fromAgent = m.author.kind === "agent";
  const job = m.job === true;
  // one budget for the whole chat: a Job's line (a helper's or a teammate's result) counts like any agent turn
  if (fromAgent && (m.depth ?? 0) >= limit) return done([], "hop_limit");

  const mentionedAgents = [...new Set(m.mentions.filter((x) => x.kind === "agent").map((x) => x.id))].filter((id) => job || !(fromAgent && id === m.author.id));
  if (mentionedAgents.length) return done(mentionedAgents, "mention");
  if (m.mentions.some((x) => x.kind === "agent")) return done([], "mention");   // only self-mentions: an agent never answers itself

  // a person in the chat who is named is spoken to; a person who is not in the chat is only talked about
  const inChat = (id: string): boolean => id !== m.author.id && (thread.people === undefined || thread.people.includes(id));
  const addressed = m.mentions.some((x) => x.kind === "person" && inChat(x.id)) || (m.replyToPerson !== undefined && m.replyToPerson !== m.author.id && inChat(m.replyToPerson));
  if (addressed) {
    // the message also asks the lead something: it names the lead in words
    const named = typeof m.text === "string" ? thread.agents.find((a) => a.mode === "lead" && a.watching !== true && a.name !== undefined && namedIn(m.text!, a.name)) : undefined;
    if (!named || fromAgent) return done([], "person_addressed");
    return done([named.id], "lead");
  }

  // a person speaks to all the agents: each answers alone, on its own, never one relaying the others
  const answering = thread.agents.filter((a) => a.watching !== true).map((a) => a.id);
  if (!fromAgent && answering.length > 1 && typeof m.text === "string" && ALL_AGENTS.test(m.text)) return done(answering, "all");

  // the only agent in a person's chat answers that person whatever its mode says: listening means nothing with no one else to lead. Not a message the host posts (a nudge, a baton line, svc_...),
  // not an agent's, not a run, helper, channel or console thread, and never a watcher.
  // Where the only people present are the person and agents acting for them, their one agent answers without an @ (owner, 4 Nov 2026): a task thread on their task, a note thread, a goal chat. People known
  // to be in it besides the author make it a group, where an @ picks who answers.
  const alone = thread.people !== undefined && thread.people.every((id) => id === m.author.id);
  const solo = thread.agents.length === 1 && thread.agents[0]!.watching !== true && (!fromAgent || job) && !m.author.id.startsWith("svc_")
    && (thread.kind === undefined || PERSON_CHATS.has(thread.kind) || (alone && thread.personal === true));
  const lead = thread.agents.find((a) => a.mode === "lead") ?? (solo ? thread.agents[0] : undefined);
  if (!lead || (fromAgent && !job && lead.id === m.author.id)) return done([], "no_lead");
  return done([lead.id], "lead");
}

/** The depth a reply to `m` carries: agent messages add a hop, person messages reset to zero. */
export function nextDepth(m: Pick<RouteMessage, "author" | "depth">): number {
  return m.author.kind === "agent" ? (m.depth ?? 0) + 1 : 0;
}
