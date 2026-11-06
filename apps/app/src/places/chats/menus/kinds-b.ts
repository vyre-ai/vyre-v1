// The right-click menus of Vault items, automations, goals, projects, tabs and the Console rows (team/v1/CONTEXT-MENUS.md; lane l-chrome2a, beside l-calendar's files, folders, notes, records and artifacts).
// Pure, the shape of kinds.ts: each builder gets facts about the row, from real state and what the person may do, and what each item does, and returns the entries of the one Menu surface. An item is here
// only when it works for this person; a toggle's words follow its state; open and read come first, then change, then share, then organise, and danger is last and alone, with its key in the hint column.
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/index.tsx";
import { KEY, starItem, tidy } from "./kinds.ts";

const sep: MenuEntry = { separator: true };
const item = (label: string, onSelect: () => void, o: Partial<MenuItem> = {}): MenuItem => ({ label, onSelect, ...o });
/** The keys these kinds add to the ones kinds.ts has. */
export const KEY_B = { closeTab: "⌘W", reopenTab: "⇧⌘T", reveal: "⌘R" } as const;
const ellipsis = (label: string): string => `${label}…`;

// ---------------------------------------------------------------- Vault item

export interface VaultItemFacts {
  name: string;
  /** What it is: an API key, a login, a card, a note. Rotation and usage are for keys and logins, not cards or notes. */
  kind: string;
  /** The level you hold on it: view, use, edit or manage. */
  level: "view" | "use" | "edit" | "manage";
  /** It has a rotation reminder to restart. */
  rotates: boolean;
  /** The folders it could move to (shared ones you may edit, not the one it is in). Empty: no Move. */
  moveTo: ReadonlyArray<{ id: string; name: string }>;
}
export interface VaultItemDo {
  open(): void;
  edit(): void;
  reveal(): void;
  copyHandle(): void;
  copyName(): void;
  move(folderId: string): void;
  share(): void;
  markRotated(): void;
  usage(): void;
  trash(): void;
}
export function vaultItemMenu(f: VaultItemFacts, d: VaultItemDo): MenuEntry[] {
  const canEdit = f.level === "edit" || f.level === "manage";
  const secret = f.kind !== "card" && f.kind !== "note" && f.kind !== "secure_note";
  return tidy([
    canEdit ? item(ellipsis("Edit"), d.edit, { hint: KEY.enter }) : item("Open", d.open, { hint: KEY.enter }),
    f.level !== "use" ? item(ellipsis("Reveal Values"), d.reveal, { hint: KEY_B.reveal }) : null,
    sep,
    item("Copy Handle", d.copyHandle),
    item("Copy Name", d.copyName),
    f.level === "manage" ? sep : null,
    f.level === "manage" ? item(ellipsis("Share"), d.share) : null,
    f.level === "manage" && f.moveTo.length > 0 ? { head: "Move to Folder" } : null,
    ...(f.level === "manage" ? f.moveTo.map((x) => item(x.name, () => d.move(x.id))) : []),
    canEdit && secret ? sep : null,
    canEdit && secret && f.rotates ? item("Mark as Rotated", d.markRotated) : null,
    secret && (f.level === "manage" || canEdit) ? item(ellipsis("Usage"), d.usage) : null,
    f.level === "manage" ? sep : null,
    f.level === "manage" ? item(ellipsis("Move to Trash"), d.trash, { danger: true, hint: KEY.remove }) : null,
  ]);
}

// ---------------------------------------------------------------- Automation

export interface AutomationFacts {
  name: string;
  enabled: boolean;
  /** A Space automation (shared) or a Personal one. */
  space: boolean;
  /** Owner, admin, or given Edit on it. */
  canEdit: boolean;
  /** May run it now (the manual trigger is open to you). */
  canRun: boolean;
  /** May move it to Trash. */
  canDelete: boolean;
  /** Failed runs to look at, for the Runs line. */
  failedRuns: number;
  /** The group it is in, and the groups it could move to (the other groups of its section). */
  group: string | null;
  groups: ReadonlyArray<{ id: string; name: string }>;
}
export interface AutomationDo {
  open(): void;
  run(): void;
  setEnabled(on: boolean): void;
  test(): void;
  makePersonalCopy(): void;
  move(groupId: string | null): void;
  runs(): void;
  copyLink(): void;
  remove(): void;
}
export function automationMenu(f: AutomationFacts, d: AutomationDo): MenuEntry[] {
  return tidy([
    item("Open", d.open, { hint: KEY.enter }),
    f.canRun ? item("Run Now", d.run) : null,
    f.canEdit ? (f.enabled ? item("Turn Off", () => d.setEnabled(false)) : item("Turn On", () => d.setEnabled(true))) : null,
    f.canEdit ? item(ellipsis("Test"), d.test) : null,
    item(f.failedRuns > 0 ? `Runs (${f.failedRuns} failed)` : "Runs", d.runs),
    sep,
    f.space ? item("Make a Personal Copy", d.makePersonalCopy) : null,
    f.canEdit && (f.groups.length > 0 || f.group !== null) ? { head: "Move to Group" } : null,
    ...(f.canEdit ? f.groups.map((g) => item(g.name, () => d.move(g.id))) : []),
    f.canEdit && f.group !== null ? item("Out of Its Group", () => d.move(null)) : null,
    sep,
    item("Copy Link", d.copyLink),
    f.canDelete ? sep : null,
    f.canDelete ? item(ellipsis("Move to Trash"), d.remove, { danger: true, hint: KEY.remove }) : null,
  ]);
}

// ---------------------------------------------------------------- Goal

export interface GoalFacts {
  title: string;
  status: "running" | "paused" | "stuck" | "done" | "stopped";
  /** The owner, or someone with Manage on it. */
  manage: boolean;
}
export interface GoalDo {
  /** Absent on the goal's own page: it is open. */
  open?: (() => void) | undefined;
  pause(): void;
  resume(): void;
  markStuck(): void;
  report(): void;
  stop(): void;
  copyLink(): void;
}
export function goalMenu(f: GoalFacts, d: GoalDo): MenuEntry[] {
  const live = f.status === "running" || f.status === "stuck";
  const over = f.status === "done" || f.status === "stopped";
  return tidy([
    d.open ? item("Open", d.open, { hint: KEY.enter }) : null,
    f.manage && !over ? sep : null,
    f.manage && live ? item("Pause", d.pause) : null,
    f.manage && f.status === "paused" ? item("Resume", d.resume) : null,
    f.manage && f.status === "running" ? item(ellipsis("Mark Stuck"), d.markStuck) : null,
    f.manage && !over ? item(ellipsis("Report Progress"), d.report) : null,
    sep,
    item("Copy Link", d.copyLink),
    f.manage && !over ? sep : null,
    f.manage && !over ? item(ellipsis("Stop Goal"), d.stop, { danger: true }) : null,
  ]);
}

// ---------------------------------------------------------------- Project

export interface ProjectFacts {
  title: string;
  starred: boolean;
  /** Archived: out of the lists, still readable. */
  archived: boolean;
  /** Manage on the project: share it, add people. */
  manage: boolean;
  /** Edit: pin a file to it. */
  edit: boolean;
  /** A Space admin who holds no Manage on the project: may still change who is on it, so Add People shows. */
  roles?: boolean;
}
export interface ProjectDo {
  /** Absent on the project's own page: it is open. */
  open?: (() => void) | undefined;
  star(on: boolean): void;
  /** The four that need the person's role on the project and a sheet or page of their own: only the project page supplies them. A row that cannot do them leaves them out, and the item is not drawn. */
  share?: (() => void) | undefined;
  addPeople?: (() => void) | undefined;
  pinFile?: (() => void) | undefined;
  archive?: (() => void) | undefined;
  unarchive?: (() => void) | undefined;
  copyLink(): void;
}
/** Archive takes a project out of the lists and keeps it readable (projects.archive); it is a manager's, and always undoable by Unarchive. */
export function projectMenu(f: ProjectFacts, d: ProjectDo): MenuEntry[] {
  return tidy([
    d.open ? item("Open", d.open, { hint: KEY.enter }) : null,
    starItem(f.starred, d.star),
    (f.manage || f.roles === true) && (d.share || d.addPeople) ? sep : null,
    f.manage && d.share ? item(ellipsis("Share"), d.share) : null,
    (f.manage || f.roles === true) && d.addPeople ? item(ellipsis("Add People"), d.addPeople) : null,
    f.edit && d.pinFile ? item(ellipsis("Pin File"), d.pinFile) : null,
    f.manage && (f.archived ? d.unarchive : d.archive) ? sep : null,
    f.manage && f.archived && d.unarchive ? item("Unarchive", d.unarchive) : null,
    f.manage && !f.archived && d.archive ? item("Archive", d.archive) : null,
    sep,
    item("Copy Link", d.copyLink),
  ]);
}

// ---------------------------------------------------------------- Tab

export interface TabFacts {
  title: string;
  pinned: boolean;
  /** How many tabs are open, and how many sit to the right of this one. */
  count: number;
  toTheRight: number;
  /** A tab of an item has an address to copy and a place to open it in; a "new tab" does not. */
  item: boolean;
  /** A closed tab can come back. */
  canReopen: boolean;
}
export interface TabDo {
  close(): void;
  closeOthers(): void;
  closeRight(): void;
  copyLink(): void;
  pin(on: boolean): void;
  reopen(): void;
}
export function tabMenu(f: TabFacts, d: TabDo): MenuEntry[] {
  return tidy([
    item("Close", d.close, { hint: KEY_B.closeTab }),
    f.count > 1 ? item("Close Other Tabs", d.closeOthers) : null,
    f.toTheRight > 0 ? item("Close Tabs to the Right", d.closeRight) : null,
    sep,
    f.item ? item("Copy Link", d.copyLink) : null,
    f.pinned ? item("Unpin", () => d.pin(false)) : item("Pin", () => d.pin(true)),
    f.canReopen ? sep : null,
    f.canReopen ? item("Reopen Closed Tab", d.reopen, { hint: KEY_B.reopenTab }) : null,
  ]);
}

// ---------------------------------------------------------------- Machine (Console and Personal Space lists)

export interface MachineFacts {
  name: string;
  draining: boolean;
  /** Drain or undrain: an admin, or the machine's owner. */
  canDrain: boolean;
  /** Fix and pin an agent: the owner of a computer, an admin for the Space server and servers; an admin does not reach into a member's own computer. */
  canFix: boolean;
  /** Take it out of the Space: a server only, by an admin or its owner; never the Space server and never a linked device. */
  canRemove: boolean;
}
export interface MachineDo {
  open(): void;
  drain(on: boolean): void;
  clearCaches(): void;
  stopIdle(): void;
  pinAgent(): void;
  copyAddress(): void;
  remove(): void;
}
export function machineMenu(f: MachineFacts, d: MachineDo): MenuEntry[] {
  return tidy([
    item("Open", d.open, { hint: KEY.enter }),
    f.canDrain ? (f.draining ? item("Undrain", () => d.drain(false)) : item("Drain", () => d.drain(true))) : null,
    f.canFix ? item(ellipsis("Pin an Agent"), d.pinAgent) : null,
    f.canFix ? sep : null,
    f.canFix ? { head: "Fix" } : null,
    f.canFix ? item("Clear Old Caches", d.clearCaches) : null,
    f.canFix ? item("Stop Idle Sessions", d.stopIdle) : null,
    sep,
    item("Copy Address", d.copyAddress),
    f.canRemove ? sep : null,
    f.canRemove ? item(ellipsis("Remove from the Space"), d.remove, { danger: true, hint: KEY.remove }) : null,
  ]);
}

// ---------------------------------------------------------------- Console rows

/** What every Console row shares: Open and a copy of its name, then its own actions, then Remove last when the person may. */
export interface ConsoleFacts { name: string; /** Manage on the Console object: its changing actions. */ manage: boolean }

export interface ConsolePersonFacts extends ConsoleFacts { suspended: boolean; /** You: you cannot suspend or remove yourself. */ self: boolean; owner: boolean }
export interface ConsolePersonDo { open(): void; copyName(): void; suspend(): void; reactivate(): void; changeRole(): void; remove(): void }
export function consolePersonMenu(f: ConsolePersonFacts, d: ConsolePersonDo): MenuEntry[] {
  const other = f.manage && !f.self;
  return tidy([
    item("Open", d.open, { hint: KEY.enter }),
    item("Copy Name", d.copyName),
    f.manage ? sep : null,
    other && !f.owner ? (f.suspended ? item("Reactivate", d.reactivate) : item("Suspend", d.suspend)) : null,
    f.manage && !f.owner ? item(ellipsis("Change Role"), d.changeRole) : null,
    other && !f.owner ? sep : null,
    other && !f.owner ? item(ellipsis("Remove from Space"), d.remove, { danger: true, hint: KEY.remove }) : null,
  ]);
}

/** A built-in group keeps its name and stays: no Rename, no Delete. */
export interface ConsoleGroupFacts extends ConsoleFacts { builtIn: boolean }
export interface ConsoleGroupDo { open(): void; copyName(): void; addPerson(): void; rename(): void; remove(): void }
export function consoleGroupMenu(f: ConsoleGroupFacts, d: ConsoleGroupDo): MenuEntry[] {
  return tidy([
    item("Open", d.open, { hint: KEY.enter }),
    item("Copy Name", d.copyName),
    f.manage ? sep : null,
    f.manage ? item(ellipsis("Add Person"), d.addPerson) : null,
    f.manage && !f.builtIn ? item(ellipsis("Rename"), d.rename, { hint: KEY.rename }) : null,
    f.manage && !f.builtIn ? sep : null,
    f.manage && !f.builtIn ? item(ellipsis("Delete Group"), d.remove, { danger: true, hint: KEY.remove }) : null,
  ]);
}

export interface ConsoleRoleFacts extends ConsoleFacts { builtIn: boolean; /** People who hold it: a role someone holds cannot be deleted. */ holders: number }
export interface ConsoleRoleDo { open(): void; copyName(): void; duplicate(): void; preview(): void; remove(): void }
export function consoleRoleMenu(f: ConsoleRoleFacts, d: ConsoleRoleDo): MenuEntry[] {
  return tidy([
    item("Open", d.open, { hint: KEY.enter }),
    item("Copy Name", d.copyName),
    f.manage ? sep : null,
    f.manage ? item("Duplicate", d.duplicate) : null,
    f.manage ? item(ellipsis("Preview Changes"), d.preview) : null,
    f.manage && !f.builtIn ? sep : null,
    f.manage && !f.builtIn ? (f.holders > 0 ? item(ellipsis("Delete Role"), d.remove, { danger: true, disabled: true, reason: `${f.holders} ${f.holders === 1 ? "person holds" : "people hold"} this role` }) : item(ellipsis("Delete Role"), d.remove, { danger: true, hint: KEY.remove })) : null,
  ]);
}

export interface ConsoleNumberDo { open(): void; copyNumber(): void; assign(): void; release(): void }
export function consoleNumberMenu(f: ConsoleFacts, d: ConsoleNumberDo): MenuEntry[] {
  return tidy([
    item("Open", d.open, { hint: KEY.enter }),
    item("Copy Number", d.copyNumber),
    f.manage ? sep : null,
    f.manage ? item(ellipsis("Assign"), d.assign) : null,
    f.manage ? sep : null,
    f.manage ? item(ellipsis("Release Number"), d.release, { danger: true }) : null,
  ]);
}

export interface ConsoleDomainDo { open(): void; copyName(): void; check(): void; remove(): void }
export function consoleDomainMenu(f: ConsoleFacts, d: ConsoleDomainDo): MenuEntry[] {
  return tidy([
    item("Open", d.open, { hint: KEY.enter }),
    item("Copy Name", d.copyName),
    f.manage ? sep : null,
    f.manage ? item("Check Now", d.check) : null,
    f.manage ? sep : null,
    f.manage ? item(ellipsis("Remove Domain"), d.remove, { danger: true, hint: KEY.remove }) : null,
  ]);
}
