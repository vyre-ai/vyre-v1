// Frozen props for ui/Menu (spec 3.0, ARCH 7.14, D51).
// Items use label and icon so a menu is all icons or no icons.
// Report a problem is appended by this module, never by a caller.

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
  onSelect?: () => void;
}

export type MenuEntry = MenuSeparator | MenuHead | MenuItem;

export interface MenuProps {
  items: readonly MenuEntry[];
  x?: number;
  y?: number;
  /** Defaults to context, which appends Report a problem. */
  source?: MenuSource;
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
