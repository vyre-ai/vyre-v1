// ui/PeoplePopover, the pure part: the rows of the people popover of a chat or a project, the words of a role, what a right-click offers, and the arrow-key walk. Nothing is drawn here.
// The popover matches the prototype (vyre-projects.html, ACT.pmembers; c-render.js pop2:ppl): "People and agents", one row per member with the role in muted text on the right,
// a divider, and one footer action that depends on where it opens (a project: Manage on the Overview; a chat: Add people and agents).

export type MemberKind = "person" | "agent" | "outside";

export interface MemberRow {
  id: string;
  name: string;
  kind: MemberKind;
  /** The words on the right: Lead, Member, Reviewer, Guest for a person; Can use, Can edit, Can manage for an agent. */
  role: string;
}

export type PeopleWhere = "chat" | "project";

/** The footer action: where the popover opens decides it. */
export function footerOf(where: PeopleWhere): { label: string; id: "overview" | "add" } {
  return where === "project" ? { label: "Manage on the Overview", id: "overview" } : { label: "Add people and agents", id: "add" };
}

export const TITLE = "People and agents";

/** What the viewer may do to the people here; each is `true` only when the server would allow it. */
export interface MemberPerms {
  message: boolean;
  changeRole: boolean;
  remove: boolean;
  /** A chat: an agent's row also offers Poke and How and when it responds. */
  agentControls?: boolean;
}

export type MemberAction = "message" | "role" | "remove" | "link" | "poke" | "settings";

export interface MemberMenuItem { id: MemberAction; label: string; danger?: boolean }

/** The right-click menu of a row: Message (a person who is not you), Change role and Remove (only when permitted, and never on yourself for Remove), Copy Link (always). */
export function memberMenu(row: MemberRow, perms: MemberPerms, meId: string | undefined): MemberMenuItem[] {
  const out: MemberMenuItem[] = [];
  const me = row.id === meId;
  if (perms.message && row.kind === "person" && !me) out.push({ id: "message", label: "Message" });
  if (perms.agentControls === true && row.kind !== "person") out.push({ id: "poke", label: "Poke" }, { id: "settings", label: "How and when it responds" });
  if (perms.changeRole) out.push({ id: "role", label: "Change role" });
  if (perms.remove && !me) out.push({ id: "remove", label: "Remove", danger: true });
  out.push({ id: "link", label: "Copy Link" });
  return out;
}

/** The arrow keys walk the rows (and the footer after the last); they stop at each end. `at` is -1 before the first move. */
export function walk(at: number, key: string, count: number): number {
  if (count <= 0) return -1;
  if (key === "ArrowDown") return Math.min(count - 1, at + 1);
  if (key === "ArrowUp") return at <= 0 ? 0 : at - 1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return at;
}
