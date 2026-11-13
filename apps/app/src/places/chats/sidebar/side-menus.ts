// The menus of the new Chats sidebar (design 13 Nov, 2.5 and 2.6; team/v1/CONTEXT-MENUS.md rules): one builder per kind of entry, pure. Every kind of row has one, the right-click, the "..." button, the Menu key and the keys
// of the hint column all reach the same items. An item appears only when the sidebar gives what it does (rule 5), so a capability that does not exist yet is not in the menu. The word is Pin (Pinned, Unpin).
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/props.ts";
import { sep, tidy } from "../../../../../../ui/src/Menu/entries.ts";
import { formatCombo } from "../../../shell/keyboard/map.ts";
import type { Platform } from "../../../shell/keyboard/map.ts";
import { FILTER_CHOICES } from "./layout.ts";
import type { FilterId, FilterRow, Item, SectionId } from "./layout.ts";

/** What the sidebar can do with a row. Anything left out is an item left out. */
export interface RowDo {
  open?: () => void;
  openTab?: () => void;
  markRead?: () => void;
  markUnread?: () => void;
  pin?: () => void;
  unpin?: () => void;
  mute?: () => void;
  unmute?: () => void;
  rename?: () => void;
  addPeople?: () => void;
  invite?: () => void;
  copyLink?: () => void;
  copyHandle?: () => void;
  viewProfile?: () => void;
  archive?: () => void;
  unarchive?: () => void;
  deleteChat?: () => void;
  leave?: () => void;
  pause?: () => void;
  editInstructions?: () => void;
  deleteAgent?: () => void;
  reportProgress?: () => void;
  markStuck?: () => void;
  pauseGoal?: () => void;
}
/** What the person may do beyond what they can see: managers delete agents. */
export interface RowCan {
  manageAgent?: boolean;
}

/** The hint a key shows in the right column. These are the keys the focused row runs (ui/Menu/keys.ts for the letters; side-keys.ts for the rest). */
export const HINT = {
  open: "Enter",
  tab: "⌘↵",
  read: "U",
  pin: "P",
  mute: "M",
  rename: "F2",
  archive: "E",
  remove: "⌘⌫",
  profile: "⌘I",
  link: "⇧⌘C",
} as const;

const it = (label: string, onSelect: (() => void) | undefined, o: Partial<MenuItem> = {}): MenuItem | null =>
  onSelect ? { label, onSelect, ...o } : null;
const some = (x: MenuItem | null): x is MenuItem => x !== null;

const isRead = (x: Item): boolean => x.unread === 0 && x.mentions === 0;
function openGroup(_x: Item, d: RowDo, label = "Open"): (MenuItem | null)[] {
  return [it(label, d.open, { hint: HINT.open }), it("Open in a new tab", d.openTab, { hint: HINT.tab })];
}
function pinItem(_x: Item, d: RowDo, pinned: boolean): MenuItem | null {
  return pinned ? it("Unpin", d.unpin, { hint: HINT.pin }) : it("Pin", d.pin, { hint: HINT.pin });
}

/**
 * The menu of one row. `pinned` says whether it sits in Pinned now (the word follows the state). Kinds and their items are the table of design 2.6:
 *  chat (agent, Assistant, group)  Open, tab | Mark, Pin, Mute, Rename, Add people, Copy link | Archive, then Delete (a chat of me and agents) or Leave
 *  direct message / person         Message, tab | Mark, Pin, Mute | View profile, Add to a chat, Copy handle
 *  channel                         Open, tab | Mark, Pin, Mute, Invite people, Copy link | Leave channel
 *  project                         Open project, tab | Mark, Pin, Mute | Copy link
 *  agent (Team)                    Message, tab | Pin, Mute | View profile, Add to a chat | Pause, Edit instructions | Delete agent (managers; never the Assistant)
 *  goal                            Open, tab | Pin, Report progress, Mark stuck, Pause | Copy link
 *  waiting task                    Open, tab | Copy link
 */
export function rowMenu(x: Item, pinned: boolean, d: RowDo, can: RowCan = {}): MenuEntry[] {
  const pin = pinItem(x, d, pinned);
  const mark = (): (MenuItem | null)[] => [
    isRead(x)
      ? it("Mark as unread", d.markUnread, { hint: HINT.read })
      : it("Mark as read", d.markRead, { hint: HINT.read }),
  ];
  const mute = x.muted ? it("Unmute", d.unmute, { hint: HINT.mute }) : it("Mute", d.mute, { hint: HINT.mute });
  const link = it("Copy link", d.copyLink, { hint: HINT.link });
  const clean = (xs: (MenuEntry | null)[]): MenuEntry[] => tidy(xs.filter((e): e is MenuEntry => e !== null));
  switch (x.kind) {
    case "task":
      return clean([...openGroup(x, d), sep, link]);
    case "goal":
      return clean([
        ...openGroup(x, d),
        sep,
        pin,
        it("Report progress…", d.reportProgress),
        it("Mark stuck…", d.markStuck),
        it("Pause", d.pauseGoal),
        sep,
        link,
      ]);
    case "project":
      return clean([...openGroup(x, d, "Open project"), sep, ...mark(), pin, mute, sep, link]);
    case "channel":
      return clean([
        ...openGroup(x, d),
        sep,
        ...mark(),
        pin,
        mute,
        it("Invite people…", d.invite),
        link,
        sep,
        it("Leave channel", d.leave, { danger: true }),
      ]);
    case "person":
      return clean([
        ...openGroup(x, d, "Message"),
        sep,
        ...(x.threadId !== undefined ? mark() : []),
        pin,
        mute,
        sep,
        it("View profile", d.viewProfile, { hint: HINT.profile }),
        it("Add to a chat…", d.addPeople),
        it("Copy @handle", d.copyHandle),
      ]);
    case "agent":
      return clean([
        ...openGroup(x, d, "Message"),
        sep,
        pin,
        mute,
        sep,
        it("View profile", d.viewProfile, { hint: HINT.profile }),
        it("Add to a chat…", d.addPeople),
        ...(x.assistant === true
          ? []
          : [
              sep,
              it("Pause", d.pause),
              it("Edit instructions…", d.editInstructions),
              can.manageAgent === true ? sep : null,
              can.manageAgent === true ? it("Delete agent", d.deleteAgent, { danger: true }) : null,
            ]),
      ]);
    case "chat":
      return clean([
        ...openGroup(x, d),
        sep,
        ...mark(),
        pin,
        mute,
        it("Rename", d.rename, { hint: HINT.rename }),
        it("Add people…", d.addPeople),
        link,
        sep,
        x.archived
          ? it("Unarchive", d.unarchive, { hint: HINT.archive })
          : it("Archive", d.archive, { hint: HINT.archive }),
        x.withPeople === true
          ? it("Leave chat", d.leave, { danger: true })
          : it("Delete chat", d.deleteChat, { danger: true, hint: HINT.remove }),
      ]);
  }
}

// ---------------------------------------------------------------- the fixed rows, the heads, "N more"

export interface FixedDo {
  open?: () => void;
  openTab?: () => void;
  openNotes?: () => void;
  openArtifacts?: () => void;
  newTask?: () => void;
  newNote?: () => void;
  fold?: () => void;
  unfold?: () => void;
}
/** Tasks: Open, a new tab, New task. */
export function tasksMenu(d: FixedDo, keyOf: KeyOf = defaultKey, folded = false): MenuEntry[] {
  return tidy([
    it("Open", d.open, { hint: HINT.open }),
    it("Open in a new tab", d.openTab, { hint: HINT.tab }),
    sep,
    folded ? it("Unfold", d.unfold, { hint: "\u2192" }) : it("Fold", d.fold, { hint: "\u2190" }),
    sep,
    it("New task", d.newTask, { hint: keyOf("task.new") }),
  ]);
}
/** Notes & artifacts: Open (on the tab last used), each tab by name, a new tab, New note. */
export function notesMenu(d: FixedDo, keyOf: KeyOf = defaultKey): MenuEntry[] {
  return tidy([
    it("Open", d.open, { hint: HINT.open }),
    it("Open Notes", d.openNotes),
    it("Open Artifacts", d.openArtifacts),
    it("Open in a new tab", d.openTab, { hint: HINT.tab }),
    sep,
    it("New note", d.newNote, { hint: keyOf("note.new") }),
  ]);
}

export interface HeadDo {
  fold?: () => void;
  unfold?: () => void;
  markAllRead?: () => void;
  newChat?: () => void;
  newChannel?: () => void;
  browseChannels?: () => void;
  invite?: () => void;
  newAgent?: () => void;
  unpinAll?: () => void;
  newGoal?: () => void;
}
/** A section head, and its "N more" (the head's menu): Fold or Unfold, then the section's own items. Needs you has no head: its Tasks row has the menu above. */
export function headMenu(section: SectionId, folded: boolean, d: HeadDo, keyOf: KeyOf = defaultKey): MenuEntry[] {
  const own: Record<SectionId, (MenuItem | null)[]> = {
    needs: [],
    goals: [it("New goal\u2026", d.newGoal, { hint: keyOf("goal.new") })],
    pinned: [it("Unpin all", d.unpinAll, { danger: true })],
    chats: [it("Mark all as read", d.markAllRead), it("New chat", d.newChat, { hint: keyOf("chat.new") })],
    channels: [
      it("New channel…", d.newChannel, { hint: keyOf("channel.new") }),
      it("Browse channels…", d.browseChannels),
    ],
    team: [it("Invite someone…", d.invite), it("New agent…", d.newAgent)],
  };
  const mine = own[section].filter(some);
  return tidy([
    folded ? it("Unfold", d.unfold, { hint: "→" }) : it("Fold", d.fold, { hint: "←" }),
    mine.length > 0 ? sep : null,
    ...mine,
  ]);
}

// ---------------------------------------------------------------- "+" and Filter

export type KeyOf = (shortcutId: string) => string;
const svg = (...d: string[]): string =>
  `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d.map((p) => `<path d="${p}"/>`).join("")}</svg>`;
/** The icons of the "+" menu: the menu's own set has none for these six things, and a menu takes an svg string. */
export const NEW_ICON = {
  chat: svg("M3 3.5h10a1 1 0 011 1v6a1 1 0 01-1 1H7l-3 2.5v-2.5H3a1 1 0 01-1-1v-6a1 1 0 011-1z"),
  group: svg(
    "M6 7.5a2.3 2.3 0 100-4.6 2.3 2.3 0 000 4.600zM2 13.500c.5-2.300 2.100-3.500 4-3.500s3.500 1.200 4 3.500M11.500 7a1.800 1.800 0 100-3.600M11.500 10c1.400 0 2.400.9 2.800 2.500",
  ),
  channel: svg("M6.2 2.5l-1 11M10.8 2.5l-1 11M3 6h10.200M2.800 10h10"),
  goal: svg("M8 14a6 6 0 100-12 6 6 0 000 12zM8 10.500a2.500 2.500 0 100-5 2.500 2.500 0 000 5z"),
  task: svg("M8 14a6 6 0 100-12 6 6 0 000 12zM5.500 8.200l1.800 1.800 3.400-3.600"),
  note: svg("M3.500 2.700h9v7.100l-3.600 3.500H3.500zM12.500 9.800H8.900v3.500"),
} as const;
const platformOf = (): Platform =>
  /Mac|iPhone|iPad/i.test((globalThis as { navigator?: { platform?: string } }).navigator?.platform ?? "Mac")
    ? "mac"
    : "other";
const COMBO: Record<string, string> = {
  "chat.new": "Cmd-N",
  "chat.newgroup": "Shift-Cmd-N",
  "channel.new": "Alt-Cmd-N",
  "goal.new": "Alt-Cmd-G",
  "task.new": "Alt-Cmd-T",
  "note.new": "Alt-Cmd-O",
  "chats.unread.next": "Alt-Shift-Down",
};
/** The key a shortcut id shows in a menu, written for this computer from the one table (shell/keyboard/map.ts). */
export const defaultKey: KeyOf = (id) => (COMBO[id] ? formatCombo(COMBO[id]!, platformOf()) : "");

export interface NewDo {
  newChat?: () => void;
  newGroup?: () => void;
  newChannel?: () => void;
  newGoal?: () => void;
  newTask?: () => void;
  newNote?: () => void;
}
/** The "+" menu: all six things, an icon on every item, each with its key (design 2.5). */
export function newMenu(d: NewDo, keyOf: KeyOf = defaultKey): MenuEntry[] {
  const m = (label: string, icon: string, id: string, f?: () => void): MenuItem | null =>
    it(label, f, { icon, hint: keyOf(id) });
  return tidy([
    { head: "Make" },
    m("New chat", NEW_ICON.chat, "chat.new", d.newChat),
    m("New group chat", NEW_ICON.group, "chat.newgroup", d.newGroup),
    m("New channel", NEW_ICON.channel, "channel.new", d.newChannel),
    m("New goal", NEW_ICON.goal, "goal.new", d.newGoal),
    m("New task", NEW_ICON.task, "task.new", d.newTask),
    m("New note", NEW_ICON.note, "note.new", d.newNote),
  ]);
}

export interface FilterDo {
  pick: (f: FilterId) => void;
  nextUnread?: () => void;
}
/** The filter menu, never pills: head "Show", head "Only", each choice with its count in the quiet column and a tick on the one set, then Next unread. */
export function filterMenu(
  rows: readonly FilterRow[],
  current: FilterId,
  d: FilterDo,
  keyOf: KeyOf = defaultKey,
): MenuEntry[] {
  const group = (g: "show" | "only"): MenuItem[] =>
    rows
      .filter((r) => r.group === g)
      .map((r) => ({
        label: r.label,
        checked: r.id === current,
        ...(r.id === "all" ? {} : { count: r.count }),
        onSelect: () => d.pick(r.id),
      }));
  return tidy([
    { head: "Show" },
    ...group("show"),
    sep,
    { head: "Only" },
    ...group("only"),
    d.nextUnread ? sep : null,
    it("Next unread", d.nextUnread, { hint: keyOf("chats.unread.next") }),
  ]);
}

/** Every kind of entry the sidebar draws has a menu or says why not: the error row's one action (Retry) is on its face; "N more" shares its head's menu. */
export const ENTRY_KINDS_WITH_MENU = [
  "task",
  "goal",
  "project",
  "channel",
  "person",
  "agent",
  "chat",
  "tasks",
  "notes",
  "head",
  "more",
] as const;
export const ENTRY_KINDS_WITHOUT_MENU = ["error", "none", "skeleton", "less", "hint"] as const;
export const FILTER_IDS = FILTER_CHOICES.map((c) => c.id);
