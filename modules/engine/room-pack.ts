// The room context pack (owner, 4 Nov, rc.22): an agent tagged in a group chat, a project chat or a channel already understands the room, and its first words come fast. Built on the server from
// the database, with no tool calls, from what the asker may read:
//   roster    who is in the room, person or agent, and the part each plays                      (stable, so the cached prefix holds it)
//   digest    what happened before the recent window, kept by room-digest.ts                     (stable; none when there is no digest: one line says how much came before)
//   recent    the messages since this agent last spoke here, or the last 40, within a budget    (volatile, after the cached part), each with who said it, person or agent, and when in the asker's zone
// A thread adds its whole conversation and the message it hangs off (context.ts parentOf). The message that started the turn is the trigger and is not repeated. What was said before a second person
// joined (the chat's sharedAt) is never in the pack, so a private chat that gains people does not tell them what it was before.
import type { TurnInput } from "../../agent/src/turn-engine/types.ts";
import { describe } from "../../lib/time-convert.ts";

type Obj = Record<string, unknown>;

/** The most messages the window holds when the agent has not spoken here (or spoke long ago), and the most characters it spends. */
export const RECENT_MAX = 40;
export const RECENT_BUDGET_CHARS = 24_000;
export const LINE_CHARS = 1_200;
/** How many messages are read to find the window. */
export const READ_LIMIT = 200;

export interface RoomMessage { messageId: string; threadSeq: number; author: { kind: string; id: string }; kind: string; body: string; createdAt: number }

/** Whether the pack applies: a channel, or a chat with more than one person in it. Agents answering one person alone get the ordinary context. */
export function isRoom(th: Obj | undefined): boolean {
  if (!th) return false;
  const kind = String(th["kind"] ?? "chat");
  if (kind === "ask" || kind === "helper" || kind === "run") return false;
  if (kind === "channel") return true;
  const people = (Array.isArray(th["members"]) ? th["members"] : []).filter((m) => (m as Obj)["kind"] === "person").length;
  return people > 1;
}

const short = (at: number, zone: string): string => describe(at, zone).replace(/^(\w{3})\w* (\d+) (\w{3})\w* \d{4}, (\d\d:\d\d) \(.*\)$/, "$1 $2 $3 $4");

export interface Window {
  /** The lines to show, oldest first. */
  lines: string[];
  /** Messages in the window. */
  shown: number;
  /** Visible messages before the window (not shown). */
  before: number;
  /** The first visible message's time, for "earlier: N messages since <date>". */
  firstAt?: number;
  /** The threadSeq of the first message in the window; the digest covers up to the one before. */
  fromSeq?: number;
}

/**
 * The recent window. `messages` are oldest first, as the asker may read them. Messages from before `sharedAt` are dropped, then the trigger; the window is everything after this agent's last reply
 * (a thread: the whole thread), else the last RECENT_MAX, and then the oldest are dropped until it fits the budget.
 */
export function recentWindow(o: {
  messages: readonly RoomMessage[]; agentId: string; triggerId?: string; sharedAt?: number; isThread: boolean; zone: string;
  nameOf(id: string): string; isAgent(id: string): boolean; budgetChars?: number; max?: number;
}): Window {
  const visible = o.messages.filter((m) => (m.kind === "text" || m.kind === "agent") && m.body.trim() !== "" && m.messageId !== o.triggerId && (o.sharedAt === undefined || m.createdAt >= o.sharedAt));
  const own = (m: RoomMessage): boolean => m.author.kind === "agent" && m.author.id === o.agentId;
  const lastOwn = o.isThread ? -1 : visible.map(own).lastIndexOf(true);
  const max = o.max ?? RECENT_MAX;
  let from = o.isThread ? 0 : lastOwn >= 0 ? lastOwn : Math.max(0, visible.length - max);
  // after its own last reply: the reply itself is the anchor, then everything since; capped at max
  if (visible.length - from > max && !o.isThread) from = visible.length - max;
  const picked = visible.slice(from);
  const budget = o.budgetChars ?? RECENT_BUDGET_CHARS;
  const fmt = (m: RoomMessage): string => {
    const me = own(m);
    const body = m.body.replace(/\s+/g, " ").trim();
    return `[${short(m.createdAt, o.zone)}] ${me ? "You" : o.nameOf(m.author.id)} (${me || o.isAgent(m.author.id) ? "agent" : "person"}): ${body.length > LINE_CHARS ? `${body.slice(0, LINE_CHARS - 1)}…` : body}`;
  };
  const lines: string[] = [];
  let used = 0;
  let start = picked.length;
  for (let i = picked.length - 1; i >= 0; i--) {
    const l = fmt(picked[i]!);
    if (used + l.length > budget && lines.length > 0) break;
    used += l.length;
    lines.unshift(l);
    start = i;
  }
  const first = visible[0];
  return {
    lines, shown: lines.length, before: from + start,
    ...(first ? { firstAt: first.createdAt } : {}),
    ...(picked[start] ? { fromSeq: picked[start]!.threadSeq } : {}),
  };
}

/** The "earlier" words when there is no digest: how much came before the window, and since when. */
export function earlierLine(w: Window, zone: string): string {
  if (w.before <= 0 || w.firstAt === undefined) return "";
  return `Earlier: ${w.before} message${w.before === 1 ? "" : "s"} since ${describe(w.firstAt, zone).replace(/, \d\d:\d\d.*$/, "")}, not shown here. chat_messages_list reads them; transcript_search finds an exact line.`;
}

/** The pack's text: the roster and digest (stable), and the recent window (volatile). */
export function packText(o: { roster: string; digest?: { text: string; upToSeq: number }; window: Window; zone: string; hasMessage: boolean }): { stable: string; recent: string } {
  const stable: string[] = [o.roster];
  if (o.digest && o.digest.text.trim() !== "") {
    stable.push(`Earlier in this room (a digest of messages up to number ${o.digest.upToSeq}; chat_messages_list reads any of them):\n${o.digest.text.trim()}`);
    const gap = o.window.fromSeq !== undefined ? o.window.fromSeq - o.digest.upToSeq - 1 : 0;
    if (gap > 0) stable.push(`${gap} message${gap === 1 ? "" : "s"} between the digest and the recent ones below are not shown.`);
  } else {
    const e = earlierLine(o.window, o.zone);
    if (e) stable.push(e);
  }
  const recent = o.window.lines.length > 0
    ? `The room's recent messages, oldest first, each with who said it and when (${o.zone}):\n${o.window.lines.join("\n")}${o.hasMessage ? "\nThe message that asked you is the one you were just given." : ""}`
    : "";
  return { stable: stable.filter((x) => x !== "").join("\n\n"), recent };
}

/** Whether an input is for a room tool preload: the reads an agent may reach for without searching first. */
export const ROOM_TOOLS: readonly string[] = ["chat_messages_list", "chat_message_get", "chat_catch_up", "chat_search", "tasks_get"];

export const triggerIdOf = (input: TurnInput): string | undefined => input.trigger?.id;
