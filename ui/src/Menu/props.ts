// Frozen props for ui/Menu (spec 3.0, ARCH 7.14, D51).
// Items use label and icon so a menu is all icons or no icons.
// Report a problem is appended by this module, never by a caller.

import type { ReactNode } from "react";

export const REPORT_A_PROBLEM = "Report a problem";

/** context: right-click. help: Help menu. shortcut: Cmd-Shift-/. other: leave items alone. */
export type MenuSource = "context" | "help" | "shortcut" | "other";

export interface MenuSeparator {
  separator: true;
}

export interface MenuHead {
  head: string;
}

export interface MenuItem {
  label: string;
  icon?: string;
  checked?: boolean;
  /** A quiet number shown in a right-aligned column (ruling 39): filter menus put their counts here, never in the label. */
  count?: number;
  danger?: boolean;
  /** Shown but not choosable; `reason` is said on hover (a title), so a person sees why. */
  disabled?: boolean;
  reason?: string;
  onSelect?: () => void;
  /** An element before the label (an app logo). It replaces `icon` on this row; the all-or-none rule is about `icon` only. */
  leading?: ReactNode;
  /** More words a typed search matches besides the label (an app name for one of its actions). */
  keywords?: string;
  /** Stays in the list whatever is typed in the search (a closing "Build a connector" row). */
  pinned?: boolean;
}

export type MenuEntry = MenuSeparator | MenuHead | MenuItem;

export interface MenuProps {
  items: readonly MenuEntry[];
  x?: number;
  y?: number;
  /** Defaults to context, which appends Report a problem. */
  source?: MenuSource;
  /** A search field at the top (this is its placeholder). Typing narrows the rows; a group with no match goes away, a pinned row stays. Type-ahead is off. */
  search?: string;
  /** Panel width in px; by default the menu is 220 to 320 wide. */
  width?: number;
}

/** The entries a typed search leaves: matching items, the heads that still have one, pinned items always. Nothing typed leaves all of them. */
export function filterMenuEntries(entries: readonly MenuEntry[], query: string): MenuEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return entries.slice();
  const out: MenuEntry[] = [];
  let head: MenuEntry | null = null;
  let any = false;
  for (const e of entries) {
    if (isSeparator(e)) { head = null; if (out.length > 0 && !isSeparator(out[out.length - 1]!)) out.push(e); continue; }
    if (isHead(e)) { head = e; any = false; continue; }
    const hit = e.pinned === true || e.label.toLowerCase().includes(needle) || (e.keywords ?? "").toLowerCase().includes(needle);
    if (!hit) continue;
    if (head !== null && !any) out.push(head);
    any = true;
    out.push(e);
  }
  while (out.length > 0 && isSeparator(out[out.length - 1]!)) out.pop();
  return out;
}

export function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return "separator" in entry && entry.separator === true;
}

export function isHead(entry: MenuEntry): entry is MenuHead {
  return "head" in entry && !isSeparator(entry);
}

export function isItem(entry: MenuEntry): entry is MenuItem {
  return "label" in entry && !isSeparator(entry) && !isHead(entry);
}

export function isReportItem(entry: MenuEntry): boolean {
  return isItem(entry) && entry.label === REPORT_A_PROBLEM;
}

/** Last actionable item is Report a problem. A separator sits in front of it when the menu is not empty. */
export function appendReportProblem(items: readonly MenuEntry[]): MenuEntry[] {
  const kept = items.filter((entry) => !isReportItem(entry));
  const actionable = kept.filter(isItem);
  const iconned = actionable.every((entry) => typeof entry.icon === "string" && entry.icon.length > 0);
  const report: MenuItem = actionable.length > 0 && iconned
    ? { label: REPORT_A_PROBLEM, icon: "flag" }
    : { label: REPORT_A_PROBLEM };
  const last = kept[kept.length - 1];
  if (kept.length > 0 && (last === undefined || !isSeparator(last))) kept.push({ separator: true });
  kept.push(report);
  return kept;
}

export function resolveMenuItems(props: MenuProps): MenuEntry[] {
  const source = props.source ?? "context";
  if (source === "other") return props.items.slice();
  return appendReportProblem(props.items);
}
