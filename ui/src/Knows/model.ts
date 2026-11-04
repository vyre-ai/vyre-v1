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
}

export const GROUPS: Array<{ kind: KnowsKind; title: string }> = [
  { kind: "decision", title: "Decisions" }, { kind: "fact", title: "Facts" }, { kind: "commitment", title: "Commitments" },
  { kind: "preference", title: "Preferences" }, { kind: "role", title: "Roles" }, { kind: "question", title: "Open questions" },
];

/** The groups with something in them, current ones first, then what was replaced, then what was disputed; newest last in each, as the people read the room. */
export function groupKnows(items: readonly KnowsItem[]): Array<{ kind: KnowsKind; title: string; items: KnowsItem[] }> {
  const order: Record<KnowsState, number> = { current: 0, disputed: 1, replaced: 2, source_removed: 3, removed: 3 };
  return GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.kind === g.kind && i.state !== "removed" && i.state !== "source_removed").sort((a, b) => order[a.state] - order[b.state]) })).filter((g) => g.items.length > 0);
}

/** The words under a memory line: who, when, and what state it is in. */
export function knowsMark(i: KnowsItem): string {
  const who = `${i.by} · ${i.at}${i.owes ? ` · ${i.owes}` : ""}`;
  return i.state === "disputed" ? `${who} · Open question` : i.state === "replaced" ? who : who;
}

/** The chip an agent's answer carries: "Remembered from Omar Haddad, 9:50 am". */
export const sourceChip = (by: string, at: string): string => `Remembered from ${by}, ${at}`;
