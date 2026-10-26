// The phone's navigation (spec 3.11, ARCH 7.11): five bottom tabs and one history. Back returns to the screen you came from, which is not always the parent: a contact opened from a record
// goes back to that record. No Automations, Journeys or Console on the phone. Pure, so the tests drive it without a renderer.

export type TabId = "chats" | "inbox" | "records" | "files" | "you";

export const MOBILE_TABS: readonly { id: TabId; label: string }[] = [
  { id: "chats", label: "Chats" },
  { id: "inbox", label: "Inbox" },
  { id: "records", label: "Records" },
  { id: "files", label: "Files" },
  { id: "you", label: "You" },
];

/** Places the phone does not have: the first part of a screen key. */
export const NOT_ON_PHONE: readonly string[] = ["automations", "journeys", "console"];

export interface Entry {
  tab: TabId;
  /** A screen key: "chats", "chat:c1", "record:rec_1", "contact:usr_maya". The first part before ":" names the kind. */
  screen: string;
  title?: string;
}

export interface NavState {
  /** Oldest first; the last entry is the screen on show. Never empty. */
  history: readonly Entry[];
}

const rootOf = (tab: TabId): Entry => ({ tab, screen: tab, title: MOBILE_TABS.find((t) => t.id === tab)?.label ?? tab });

export function initialNav(tab: TabId = "chats"): NavState {
  return { history: [rootOf(tab)] };
}

export const current = (s: NavState): Entry => s.history[s.history.length - 1]!;
export const canBack = (s: NavState): boolean => s.history.length > 1;

/** The screen Back would return to: the entry you came from. */
export function origin(s: NavState): Entry | undefined {
  return s.history.length > 1 ? s.history[s.history.length - 2] : undefined;
}

export function isAllowed(screen: string): boolean {
  const kind = screen.split(":")[0]!.toLowerCase();
  return !NOT_ON_PHONE.includes(kind);
}

/** Pressing a tab goes to that tab's first screen and starts its history there (a tab press again while deeper returns to its first screen). */
export function selectTab(_s: NavState, tab: TabId): NavState {
  return { history: [rootOf(tab)] };
}

/** Opens a screen on top of the one on show. A screen the phone does not have is refused; opening what is already on show changes nothing. */
export function open(s: NavState, entry: Entry): NavState {
  if (!isAllowed(entry.screen)) return s;
  const top = current(s);
  if (top.tab === entry.tab && top.screen === entry.screen) return s;
  return { history: [...s.history, entry] };
}

/** Back to the originating screen. At a tab's first screen there is nothing to go back to. */
export function back(s: NavState): NavState {
  return canBack(s) ? { history: s.history.slice(0, -1) } : s;
}

// ---------------------------------------------------------------- swipe actions

/** How far a row has to move before its actions stay open, as a share of the actions' width. */
export const SWIPE_OPEN_AT = 0.5;

/** Where a row rests after a drag of `dx` pixels (negative is left) with `actionsWidth` of buttons behind it: open (all the way over) or closed. */
export function swipeRest(dx: number, actionsWidth: number, wasOpen: boolean): "open" | "closed" {
  // dragging left (negative) opens, dragging right (positive) closes
  const travelled = wasOpen ? actionsWidth - dx : -dx;
  return travelled >= actionsWidth * SWIPE_OPEN_AT ? "open" : "closed";
}

/** The row's offset while the finger is down: it follows the finger but never past the actions' width and never to the right of rest. */
export function swipeOffset(dx: number, actionsWidth: number, wasOpen: boolean): number {
  const raw = (wasOpen ? -actionsWidth : 0) + dx;
  return Math.max(-actionsWidth, Math.min(0, raw));
}
