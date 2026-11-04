// Agents reply in threads (rc.22): in a project's main chat and in a channel, the agent answers under the message that asked it. The chat keeps the ask and one live footer: who is writing,
// how many replies, when the last one came. Pure words and decisions here; the views draw what these return.
import type { LiveTurn } from "../../../shell/session/turn-streams.ts";
import { replyWords } from "../conversation/replies.ts";
import type { ReplySummary } from "../conversation/replies.ts";
import type { Clock } from "../rightpane/model.ts";

export const THREAD_TITLE = "Thread";
export const SWITCH_TITLE = "Agents reply in threads";
export const SWITCH_NOTE = "Approvals and decisions still come to the chat.";
export const ALSO_SENT = "Also sent to the chat";
export const REPLY_PLACEHOLDER = "Reply in thread";
export const EMPTY_THREAD = "No replies yet. The agent answers here when you ask in the chat.";

/** The toast after the switch moves. */
export const switchToast = (on: boolean): string => (on ? "Agents reply in threads" : "Agents reply in the chat");

/** A chat or channel chooses where its agents reply; any other kind of thread has no such choice. */
export const hasSwitch = (t: { kind: string }): boolean => t.kind === "channel" || t.kind === "chat";

/** m:ss for a running turn. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The one line an agent's finished reply gives the footer: its first line, without markdown marks, cut to fit. */
export function outcomeLine(preview: string | undefined, max = 72): string | null {
  const first = (preview ?? "").split("\n").map((l) => l.replace(/^[\s>#*\-\d.)`]+/, "").replace(/[*_`]/g, "").trim()).find((l) => l !== "");
  if (!first) return null;
  return first.length <= max ? first : `${first.slice(0, max - 1).trimEnd()}\u2026`;
}

/** A turn parked on an approval: the approval's one line and who must say yes ("your" for the person looking). */
export interface Waiting { line: string; who: string }
export const waitingHead = (w: Waiting): string => `Waiting for ${w.who === "" ? "your" : w.who} OK`;

/** The held approval of a thread, from its messages (newest last): the newest message says a turn is waiting on a task, and nothing was said after it. */
export function parkedTask(messages: ReadonlyArray<{ kind?: string; blocks?: ReadonlyArray<{ type: string; data?: unknown }> }>): string | null {
  const last = [...messages].reverse().find((m) => m.kind !== "quiet");
  for (const b of last?.blocks ?? []) {
    const d = b.data as { state?: unknown; taskId?: unknown } | null;
    if (b.type === "turn_status" && d?.state === "waiting" && typeof d.taskId === "string" && d.taskId !== "") return d.taskId;
  }
  return null;
}

export interface Footer {
  /** A turn is parked on an approval: "Waiting for your OK" and the approval's line. */
  waiting?: Waiting;
  /** The agent finished and its last reply says so in one line: "Done \u00b7 Book Thursday at 14:00". */
  done?: { agentId: string; line: string };
  /** An agent is writing in the thread right now. */
  writing: boolean;
  agentId?: string;
  /** "Working · 0:23" while writing. */
  head: string | null;
  count: string;
  when: string | null;
  bold: boolean;
  label: string;
}

/** The live turn of a thread, the oldest first writing one. */
export const writingIn = (turns: readonly LiveTurn[]): LiveTurn | undefined => turns.find((t) => t.state === "writing");

/** What the footer under a message says now. `now` is the clock of the device in milliseconds. */
export function footerOf(s: ReplySummary | undefined, turns: readonly LiveTurn[], now: number, c: Clock, waiting?: Waiting): Footer | null {
  const w = writingIn(turns);
  if (!s && !w) return null;
  const sum: ReplySummary = s ?? { threadId: w!.threadId, count: 0, people: [], unread: 0, muted: false };
  const words = replyWords(sum, c);
  const head = w ? `Working · ${mmss(now - w.startedAt)}` : waiting ? waitingHead(waiting) : null;
  const label = [head, words.label].filter((x) => x !== null).join(", ");
  const line = !w && !waiting && s?.lastBy?.kind === "agent" ? outcomeLine(s.preview) : null;
  return { writing: w !== undefined, ...(waiting && !w ? { waiting } : {}), ...(line && s?.lastBy ? { done: { agentId: s.lastBy.id, line } } : {}), ...(w ? { agentId: w.agentId } : {}), head, count: words.count, when: sum.count === 0 ? null : words.when, bold: words.bold, label };
}

/** A footer with nothing in the thread and nobody writing draws no line. */
export const showsFooter = (f: Footer | null, s: ReplySummary | undefined): boolean => f !== null && (f.writing || f.waiting !== undefined || (s?.count ?? 0) > 0);

/**
 * Whether agents reply in threads in a chat, from the chat's row. The server says it outright (`agentRepliesInThreads`); a copy of the row kept on the device holds the person's own choice (`repliesIn`, empty when
 * they never chose) and the kind, from which the default follows: on for a channel and a project's main chat (a chat about a record), off for a chat.
 */
export function repliesOf(t: { kind: string; recordId?: string | undefined; scopeType?: string | undefined; agentRepliesInThreads?: boolean | undefined; repliesIn?: number | boolean | null | undefined }): boolean | undefined {
  if (t.agentRepliesInThreads !== undefined) return t.agentRepliesInThreads;
  if (!hasSwitch(t)) return undefined;
  if (t.repliesIn !== undefined && t.repliesIn !== null) return t.repliesIn === true || t.repliesIn === 1;
  return t.kind === "channel" || (t.recordId !== undefined && t.scopeType === undefined);
}
