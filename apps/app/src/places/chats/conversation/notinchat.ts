// "Maya is not in this chat." with Add, under the sender's own message (owner, 12 Nov 2026: "exactly like Slack does"). A person @mentioned in a chat they are not in is a reference, not an address:
// nothing reaches them until they are added. The line is decided from data alone (the message's mentions against the chat's members), so it survives a reload while it is true and goes away
// when the person is in the chat, whoever added them. Only the sender sees it; it is never a message in the chat.
import { mentionsIn } from "./askagent.ts";
import type { Candidate } from "./model.ts";

export interface NotInChat {
  messageId: string;
  /** The people the button adds (empty when there is no button). */
  ids: string[];
  text: string;
  /** "Add", "Add both", "Add all 3", or null when this person may not add anyone here or nobody can be added. */
  button: string | null;
}

const first = (name: string): string => name.trim().split(/\s+/)[0] || name;

/** "Maya", "Maya and Omar", "Maya, Omar and Lee". */
export function namesWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export const addLabel = (n: number): string => (n === 1 ? "Add" : n === 2 ? "Add both" : `Add all ${n}`);

/**
 * The line under one message, or null. `members` are the chat's people; `mayAdd` is whether the sender may add people here (any member of a chat or a thread; a channel's managers);
 * `addable` says whether a person can be added at all (a suspended person cannot).
 */
export function notInChatLine(m: { messageId: string; author: { kind: string; id: string }; kind: string; body: string }, o: {
  meId: string; members: ReadonlySet<string>; directory: readonly Candidate[]; mayAdd: boolean; addable?: (id: string) => boolean; dismissed?: ReadonlySet<string>;
}): NotInChat | null {
  if (m.author.kind !== "person" || m.author.id !== o.meId || m.kind !== "text" || m.messageId.startsWith("pending:")) return null;
  if (o.dismissed?.has(m.messageId)) return null;
  const seen = new Set<string>();
  const out = mentionsIn(m.body, o.directory).filter((x) => x.kind === "person" && x.id !== o.meId && !o.members.has(x.id) && !seen.has(x.id) && seen.add(x.id));
  if (out.length === 0) return null;
  const nameOf = (id: string): string => first(o.directory.find((c) => c.id === id)?.name ?? "Someone");
  const can = out.filter((x) => (o.addable ? o.addable(x.id) : true));
  const cannot = out.filter((x) => !can.includes(x));
  if (can.length === 0) {
    const who = namesWords(cannot.map((x) => nameOf(x.id)));
    return { messageId: m.messageId, ids: [], text: `${who} ${cannot.length === 1 ? "is" : "are"} not in this chat and cannot be added.`, button: null };
  }
  const who = namesWords(can.map((x) => nameOf(x.id)));
  const verb = can.length === 1 ? "is" : "are";
  if (!o.mayAdd) return { messageId: m.messageId, ids: [], text: `${who} ${verb} not in this chat. Ask someone who manages it to add ${who}.`, button: null };
  return { messageId: m.messageId, ids: can.map((x) => x.id), text: `${who} ${verb} not in this chat.`, button: addLabel(can.length) };
}
