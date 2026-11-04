// The right-click menu of each kind of row in Chats: agent, person, chat and channel (team/v1/CONTEXT-MENUS.md). Pure: each builder gets facts about the row and what the person may do, and what each item does,
// and returns the entries of the one Menu surface. Rules every menu follows: an item is here only when it works for this person against real state (a toggle's words follow the state, an admin-only
// item is left out for everyone else), the order is open and read, change, organise, then remove, danger is last and alone, and an item that a key does says so in its hint column (`shortcutFor` runs it).
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/index.tsx";

export const KEY = { enter: "Enter", newTab: "⌘↵", rename: "F2", star: "S", unread: "U", archive: "E", remove: "⌘⌫", profile: "⌘I" } as const;

const sep: MenuEntry = { separator: true };
/** Entries with each run of separators collapsed and none at the ends, so an item left out never leaves an empty group. */
export function tidy(list: readonly (MenuEntry | null | false | undefined)[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const e of list) {
    if (!e) continue;
    if ("separator" in e) { if (out.length > 0 && !("separator" in out[out.length - 1]!)) out.push(e); continue; }
    out.push(e);
  }
  while (out.length > 0 && "separator" in out[out.length - 1]!) out.pop();
  return out;
}
const item = (label: string, onSelect: () => void, o: Partial<MenuItem> = {}): MenuItem => ({ label, onSelect, ...o });

// ---------------------------------------------------------------- agent

export interface AgentFacts {
  name: string;
  /** Your own assistant: it cannot be paused or deleted from here. */
  assistant: boolean;
  starred: boolean;
  status: "awake" | "working" | "asleep" | "paused";
  hasComputer: boolean;
  /** Its computer, when it has one (computers.list), and whether it sleeps now. Absent while unknown: Wake and Sleep are then left out. */
  computer?: { computerId: string; asleep: boolean } | undefined;
  muted: boolean;
  /** agents.manage: pause, wake and sleep its computer, delete. */
  manage: boolean;
  /** access.manage: set up a computer for it. */
  provision: boolean;
}
export interface AgentDo {
  message(): void;
  openProfile?: (() => void) | undefined;
  openComputer?: (() => void) | undefined;
  wake(): void;
  sleep(): void;
  giveComputer(): void;
  pause(): void;
  resume(): void;
  star(on: boolean): void;
  mute(on: boolean): void;
  remove(): void;
}
export function agentMenu(f: AgentFacts, d: AgentDo): MenuEntry[] {
  const computer = f.hasComputer || f.computer !== undefined
    ? [d.openComputer ? item("Open Its Computer", d.openComputer) : null, f.manage && f.computer ? (f.computer.asleep ? item("Wake Its Computer", d.wake) : item("Sleep Its Computer", d.sleep)) : null]
    : [f.provision && !f.assistant ? item("Give It a Computer", d.giveComputer) : null];
  return tidy([
    item(`Message ${f.name}`, d.message, { hint: KEY.enter }),
    d.openProfile ? item("Open Profile", d.openProfile, { hint: KEY.profile }) : null,
    sep,
    ...computer,
    sep,
    f.manage && !f.assistant ? (f.status === "paused" ? item("Resume", d.resume) : item("Pause", d.pause)) : null,
    sep,
    f.starred ? item("Remove Star", () => d.star(false), { hint: KEY.star }) : item("Star", () => d.star(true), { hint: KEY.star }),
    f.muted ? item("Unmute", () => d.mute(false)) : item("Mute", () => d.mute(true)),
    f.manage && !f.assistant ? sep : null,
    f.manage && !f.assistant ? item("Delete Agent…", d.remove, { danger: true, hint: KEY.remove }) : null,
  ]);
}

// ---------------------------------------------------------------- person

export interface PersonFacts { name: string; /** Their direct message with you, when there is one. */ dm: boolean; unread: boolean; muted: boolean }
export interface PersonDo { message(): void; markRead(): void; markUnread(): void; mute(on: boolean): void }
export function personMenu(f: PersonFacts, d: PersonDo): MenuEntry[] {
  return tidy([
    item(`Message ${f.name}`, d.message, { hint: KEY.enter }),
    sep,
    f.dm ? (f.unread ? item("Mark as Read", d.markRead, { hint: KEY.unread }) : item("Mark as Unread", d.markUnread, { hint: KEY.unread })) : null,
    f.muted ? item("Unmute", () => d.mute(false)) : item("Mute", () => d.mute(true)),
  ]);
}

// ---------------------------------------------------------------- chat

export interface ChatFacts {
  starred: boolean;
  unread: boolean;
  /** Not on the server yet: a row that is only drawn. */
  local: boolean;
  archived: boolean;
  /** A direct message with other people: Leave, not Delete. */
  withPeople: boolean;
  muted: boolean;
}
export interface ChatDo {
  open(): void;
  openTab?: (() => void) | undefined;
  rename(): void;
  star(on: boolean): void;
  markRead(): void;
  markUnread(): void;
  mute(on: boolean): void;
  archive(): void;
  unarchive(): void;
  leave(): void;
  remove(): void;
}
/** `has` says which optional parts the caller can do (a sidebar with no Rename leaves it out); by default all. */
export function chatMenu(f: ChatFacts, d: ChatDo, has: { rename?: boolean; mute?: boolean } = {}): MenuEntry[] {
  const rename = has.rename !== false, mute = has.mute !== false;
  return tidy([
    item("Open", d.open, { hint: KEY.enter }),
    d.openTab ? item("Open in New Tab", d.openTab, { hint: KEY.newTab }) : null,
    sep,
    f.local || !rename ? null : item("Rename", d.rename, { hint: KEY.rename }),
    f.starred ? item("Remove Star", () => d.star(false), { hint: KEY.star }) : item("Star", () => d.star(true), { hint: KEY.star }),
    f.unread ? item("Mark as Read", d.markRead, { hint: KEY.unread }) : f.local ? null : item("Mark as Unread", d.markUnread, { hint: KEY.unread }),
    f.local || !mute ? null : f.muted ? item("Unmute", () => d.mute(false)) : item("Mute", () => d.mute(true)),
    sep,
    f.archived ? item("Unarchive", d.unarchive, { hint: KEY.archive }) : item("Archive", d.archive, { hint: KEY.archive }),
    f.local ? null : sep,
    f.local ? null : f.withPeople ? item("Leave chat", d.leave, { danger: true }) : item("Delete chat", d.remove, { danger: true, hint: KEY.remove }),
  ]);
}

// ---------------------------------------------------------------- channel

export interface ChannelFacts { name: string; unread: boolean; starred: boolean; muted: boolean; /** You are in it. */ member: boolean; /** An admin of it. */ admin: boolean }
export interface ChannelDo {
  open(): void;
  markRead(): void;
  markUnread(): void;
  star(on: boolean): void;
  mute(on: boolean): void;
  copyLink(): void;
  leave(): void;
  archive(): void;
}
export function channelMenu(f: ChannelFacts, d: ChannelDo): MenuEntry[] {
  return tidy([
    item("Open", d.open, { hint: KEY.enter }),
    sep,
    f.unread ? item("Mark as Read", d.markRead, { hint: KEY.unread }) : item("Mark as Unread", d.markUnread, { hint: KEY.unread }),
    f.starred ? item("Remove Star", () => d.star(false), { hint: KEY.star }) : item("Star", () => d.star(true), { hint: KEY.star }),
    f.muted ? item("Unmute", () => d.mute(false)) : item("Mute", () => d.mute(true)),
    sep,
    item("Copy Link", d.copyLink),
    f.member || f.admin ? sep : null,
    f.admin ? item("Archive Channel", d.archive, { hint: KEY.archive }) : null,
    f.member ? item("Leave Channel", d.leave, { danger: true }) : null,
  ]);
}

// ---------------------------------------------------------------- keys

/** The label a key press has in the hint column: "S", "U", "F2", "⌘⌫" (Cmd or Ctrl with Backspace) and so on; null for a key that is not a row key. */
export function keyLabel(e: { key?: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }): string | null {
  const k = e.key ?? "";
  const mod = e.metaKey === true || e.ctrlKey === true;
  if (e.altKey === true || e.shiftKey === true) return null;
  if (mod) return k === "Enter" ? KEY.newTab : k === "Backspace" ? KEY.remove : k.toLowerCase() === "i" ? KEY.profile : null;
  if (k === "F2") return KEY.rename;
  return k.length === 1 && /[a-z]/i.test(k) ? k.toUpperCase() : null;
}

/** What a key does on a row: the menu item whose hint is that key (never the Enter row, which opens). Null when the menu has none. */
export function shortcutFor(entries: readonly MenuEntry[], e: Parameters<typeof keyLabel>[0]): MenuItem | null {
  const label = keyLabel(e);
  if (label === null) return null;
  for (const x of entries) if (!("separator" in x) && !("head" in x) && x.hint === label && x.onSelect && x.disabled !== true) return x;
  return null;
}
