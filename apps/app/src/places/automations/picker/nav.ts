// The step picker's keyboard, as one pure function (owner, 13 Nov 2026, design 2.4): type to filter, arrows, Right opens the submenu, arrows inside it, Enter adds, Left or Escape steps back.
// The screen sends every key and every hover here and draws the state that comes back.
import { pickerRows, submenuOf } from "./model.ts";
import type { PickIn, PickRow } from "./model.ts";

export interface Nav {
  query: string;
  /** The lit row of the main list, counted over rows that are not headings. */
  index: number;
  /** The group or app whose actions show beside the list. */
  open: string | null;
  /** Where the keyboard is. */
  col: "main" | "sub";
  subIndex: number;
}

export const INITIAL: Nav = { query: "", index: 0, open: null, col: "main", subIndex: 0 };

export type Effect = { kind: "choose"; stepId: string } | { kind: "connect" } | { kind: "close" } | null;
export type Input = { key: string } | { type: string } | { hover: string };

/** The rows a person can land on in the main list. */
export function mainRows(m: PickIn, s: Pick<Nav, "query">): Exclude<PickRow, { kind: "heading" }>[] {
  return pickerRows(m, s.query).filter((r): r is Exclude<PickRow, { kind: "heading" }> => r.kind !== "heading");
}

const opens = (r: PickRow | undefined): r is Extract<PickRow, { kind: "group" | "app" }> =>
  r?.kind === "group" || r?.kind === "app";

export function step(m: PickIn, s: Nav, input: Input): { state: Nav; effect: Effect } {
  const rows = mainRows(m, s);
  const none = (state: Nav): { state: Nav; effect: Effect } => ({ state, effect: null });
  if ("type" in input) return none({ query: input.type, index: 0, open: null, col: "main", subIndex: 0 });
  if ("hover" in input) {
    const index = rows.findIndex((r) => "id" in r && r.id === input.hover);
    const row = rows[index];
    if (index < 0 || !opens(row) || s.col === "sub") return none(s);
    return none({ ...s, index, open: input.hover });
  }
  const sub = s.open ? submenuOf(m, s.open) : null;
  const { key } = input;
  if (s.col === "sub" && sub) {
    const n = sub.items.length;
    if (key === "ArrowDown") return none({ ...s, subIndex: (s.subIndex + 1) % n });
    if (key === "ArrowUp") return none({ ...s, subIndex: (s.subIndex - 1 + n) % n });
    if (key === "ArrowLeft" || key === "Escape") return none({ ...s, col: "main", open: null, subIndex: 0 });
    if (key === "Enter") return { state: s, effect: { kind: "choose", stepId: sub.items[s.subIndex]!.id } };
    return none(s);
  }
  const n = rows.length;
  const row = rows[Math.min(s.index, n - 1)];
  if (key === "ArrowDown" || key === "ArrowUp") {
    const index = n === 0 ? 0 : key === "ArrowDown" ? (s.index + 1) % n : (s.index - 1 + n) % n;
    return none({ ...s, index, open: null });
  }
  if ((key === "ArrowRight" || key === "Enter") && opens(row))
    return none({ ...s, open: row.id, col: "sub", subIndex: 0 });
  if (key === "Enter" && row?.kind === "step") return { state: s, effect: { kind: "choose", stepId: row.id } };
  if (key === "Enter" && row?.kind === "connect") return { state: s, effect: { kind: "connect" } };
  if (key === "Escape") {
    if (s.query !== "") return none({ ...INITIAL });
    return { state: s, effect: { kind: "close" } };
  }
  return none(s);
}
