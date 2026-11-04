// What Vyre remembers in a place, grouped the way the Knows tab reads (MEMORY-RULES 3, 9). Pure: no drawing here. The rows are memory.place.list's, with people already turned into names by the host.
export type KnowsKind = "decision" | "fact" | "commitment" | "preference" | "role" | "question";
export type KnowsState = "current" | "replaced" | "disputed" | "source_removed" | "removed";

export interface KnowsItem {
  factId: string;
  kind: KnowsKind;
  text: string;
  state: KnowsState;
  /** Who said it, as a name. */
  by: string;
  /** When, as the reader reads times ("Yesterday 4:20 pm"). */
  at: string;
  /** For a replaced one: the words of what replaced it. */
  replacedBy?: string;
  /** For a commitment: who owes it, and when. */
  owes?: string;
  /** Edit and Remove show only where the reader may edit the place. */
  canEdit: boolean;
  messageId?: string;
  /** The chat or thread the words were said in, with messageId: what Source opens. */
  threadId?: string;
  /** Learned in this place (the default), in a place linked to it, or a marker in Space memory pointing back here. */
  scope?: "here" | "linked" | "space";
  /** For linked and space rows: the name of the place it was learned in. */
  from?: string;
  /** For a disputed row: the open question it belongs to, which side of it, and its short answer ("Thursday"). */
  questionId?: string;
  qside?: "a" | "b";
  short?: string;
}

/** What Source asks the host to open: the message, in its chat or thread. The host scrolls to it. */
export interface OpenMessage { threadId: string; messageId: string }
export const openMessage = (i: KnowsItem): OpenMessage | null => (i.threadId && i.messageId ? { threadId: i.threadId, messageId: i.messageId } : null);

export const GROUPS: Array<{ kind: KnowsKind; title: string }> = [
  { kind: "decision", title: "Decisions" }, { kind: "fact", title: "Facts" }, { kind: "commitment", title: "Commitments" },
  { kind: "preference", title: "Preferences" }, { kind: "question", title: "Open questions" }, { kind: "role", title: "Roles" },
];

/** The groups with something in them, current ones first, then what was replaced, then what was disputed; newest last in each, as the people read the room. */
export function groupKnows(items: readonly KnowsItem[]): Array<{ kind: KnowsKind; title: string; items: KnowsItem[] }> {
  // a disputed row is part of an open question, not of its kind: it is listed under Open questions, with its answers
  items = items.map((i) => (i.state === "disputed" && i.questionId ? { ...i, kind: "question" as const } : i));
  const order: Record<KnowsState, number> = { current: 0, disputed: 1, replaced: 2, source_removed: 3, removed: 3 };
  return GROUPS.map((g) => ({ ...g, items: items.filter((i) => (i.scope ?? "here") === "here" && i.kind === g.kind && i.state !== "removed" && i.state !== "source_removed").sort((a, b) => order[a.state] - order[b.state]) })).filter((g) => g.items.length > 0);
}

/** The open questions: one entry per question, with its two answers (a side each), the one the room said first. */
export function openQuestions(items: readonly KnowsItem[]): Array<{ questionId: string; answers: KnowsItem[] }> {
  const by = new Map<string, KnowsItem[]>();
  for (const i of items) if (i.state === "disputed" && i.questionId && (i.scope ?? "here") === "here") by.set(i.questionId, [...(by.get(i.questionId) ?? []), i]);
  return [...by].map(([questionId, answers]) => ({ questionId, answers: answers.sort((a, b) => (a.qside ?? "a").localeCompare(b.qside ?? "a")) }));
}

/** Rows from linked places and markers in Space memory, apart from the place's own. */
export const linkedItems = (items: readonly KnowsItem[]): KnowsItem[] => items.filter((i) => i.scope === "linked" && i.state !== "removed" && i.state !== "source_removed");
export const spaceItems = (items: readonly KnowsItem[]): KnowsItem[] => items.filter((i) => i.scope === "space" && i.state !== "removed" && i.state !== "source_removed");

/** The words under a memory line. A commitment says who owes it and when it is due, then when it was said, without repeating the person. */
export function knowsMark(i: KnowsItem): string {
  const said = i.at.charAt(0).toLowerCase() + i.at.slice(1);
  const open = i.state === "disputed" ? " \u00b7 Open question" : "";
  if (i.kind === "commitment" && i.owes) return `${i.by} \u00b7 due ${i.owes} \u00b7 said ${said}${open}`;
  return `${i.by} \u00b7 ${i.at}${open}`;
}

/** The chip an agent's answer carries: "Remembered from Omar Haddad, 9:50 am". */
export const sourceChip = (by: string, at: string): string => `Remembered from ${by}, ${at}`;
