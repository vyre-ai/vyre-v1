// Ask an agent about a message that was sent without naming one (owner ruling, 3 Nov 2026). In a channel agents listen until named, so a message with no @mention gets no reply; the person
// can still get one without retyping it: "Ask an agent…" on any message (theirs or someone else's), the quiet "No agent will reply. @mention one" line under their own just-sent message, or
// an edit that adds an @mention. Each one posts one short reply from the person who pressed it, threaded to that exact message and naming the agent, so the agent answers as if it had been
// mentioned. The turn runs on the presser's account and the usual audience checks of chat.post apply. A fixed message id per (message, agent, presser) makes it happen once, never twice.
// Pure and free of the conversation's views (model.ts draws in blocks), so the server's tests can read it too.
import type { CapMap } from "../../../../../../generated/types.ts";
import { route } from "../../../../../../lib/route.ts";
import type { Candidate, Message, Thread } from "./model.ts";

/** The people and agents @mentioned in the text, by the first word of their name, as the composer line counts them. model.ts re-exports it. */
export function mentionsIn(text: string, candidates: readonly Candidate[]): { kind: "person" | "agent"; id: string }[] {
  const found: { at: number; kind: "person" | "agent"; id: string }[] = [];
  for (const c of candidates) {
    const first = (c.name.trim().split(/\s+/)[0] ?? c.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`(^|[^\\w])@${first}(?![\\p{L}\\p{N}_])`, "iu").exec(text);
    if (m) found.push({ at: m.index + m[0].length, kind: c.kind, id: c.id });
  }
  return found.sort((a, b) => a.at - b.at).map(({ kind, id }) => ({ kind, id }));
}

export const ASK_AGENT_LABEL = "Ask an Agent…";

/** What the picker needs to know about an agent: agents.list rows, as far as the label goes. */
export interface AgentMeta { agentId: string; name: string; ownerId?: string; kind?: string }

export interface PickerAgent { id: string; label: string; mine: boolean; assistant?: boolean }

/**
 * The channel's agents for the picker, your own Assistant first, named "Assistant" (owner ruling 3 Nov: never "<Person> (Agent)"). Another person's Assistant and an outside agent (credited as
 * "<Person> (Agent)") are not offered. An agent not in this chat is not offered either: only an agent in the room can answer in it.
 */
export function pickerAgents(thread: Pick<Thread, "agents">, meta: readonly AgentMeta[], meId: string, nameOf: (id: string) => string): PickerAgent[] {
  const byId = new Map(meta.map((a) => [a.agentId, a]));
  const out: PickerAgent[] = [];
  for (const a of thread.agents) {
    const m = byId.get(a.agentId);
    const assistant = m?.kind === "assistant";
    const mine = m?.ownerId === meId;
    const name = m?.name ?? nameOf(a.agentId);
    if ((assistant && !mine) || name.endsWith(" (Agent)")) continue;
    out.push({ id: a.agentId, label: assistant ? "Assistant" : name, mine, assistant });
  }
  return [...out.filter((a) => a.assistant), ...out.filter((a) => !a.assistant && a.mine), ...out.filter((a) => !a.assistant && !a.mine)];
}

/** FNV-1a, base 36: a short stable id part. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** The id of the ask: the same message, agent and presser always make the same id, and chat.post answers a second post with that id with the first one. */
export function askClientId(messageId: string, agentId: string, presserId: string): string {
  return `msg_ask${hash(`${messageId}|${agentId}|${presserId}`)}${hash(`${presserId}|${agentId}|${messageId}`)}`;
}

/** The post that asks: the presser's words name the agent and reply to that exact message. */
export function askPost(threadId: string, messageId: string, agent: { id: string; name: string }, presserId: string, key: string): CapMap["chat.post"]["in"] {
  const first = agent.name.trim().split(/\s+/)[0] ?? agent.name;
  return {
    threadId, body: `@${first}`, mentions: [{ kind: "agent", id: agent.id }], replyTo: messageId,
    clientId: askClientId(messageId, agent.id, presserId), idempotencyKey: key,
  };
}

/** The agents an edit newly names: in the edited words, not in the old ones, and in this chat. */
export function addedAgentMentions(before: string, after: string, directory: readonly Candidate[], inChat: readonly string[]): string[] {
  const had = new Set(mentionsIn(before, directory).filter((m) => m.kind === "agent").map((m) => m.id));
  const here = new Set(inChat);
  return [...new Set(mentionsIn(after, directory).filter((m) => m.kind === "agent" && !had.has(m.id) && here.has(m.id)).map((m) => m.id))];
}

/**
 * The message the quiet line hangs under: your own newest message in a channel with agents, when no agent will answer it (nobody named, no lead) and no agent has written since. Null
 * otherwise.
 */
export function unansweredOwn(thread: Thread, rows: readonly Message[], meId: string, directory: readonly Candidate[], hasThread: (messageId: string) => boolean = () => false): Message | null {
  if (thread.kind !== "channel" || thread.agents.length === 0) return null;
  const last = rows[rows.length - 1];
  if (!last || last.author.kind !== "person" || last.author.id !== meId || last.kind !== "text" || last.messageId.startsWith("pending:")) return null;
  // an agent already answers under it (agents reply in threads): the footer under the message says so, and this line would say the opposite
  if (hasThread(last.messageId)) return null;
  const mentions = mentionsIn(last.body, directory);
  if (mentions.some((m) => m.kind === "person")) return null;   // spoken to a person: nobody expects an agent
  const answers = route({ agents: thread.agents.map((a) => ({ id: a.agentId, mode: a.mode })), kind: thread.kind }, { author: { kind: "person", id: meId }, mentions, text: last.body }).responders;
  return answers.length === 0 ? last : null;
}
