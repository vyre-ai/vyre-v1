// The shell keyboard map (spec 3.0 Keyboard, 3.9 Settings > Keyboard). One table drives the key handler and the Settings > Keyboard page.
// Cmd on a Mac is Ctrl on Windows and Linux. Shortcuts that belong to one place say so; the shell handler skips those when the place is not open.

export type Platform = "mac" | "other";

export interface Shortcut {
  id: string;
  /** Written as the spec writes it: Cmd-K, Shift-Cmd-1, Cmd-Shift-K, Alt-Down. */
  combo: string;
  title: string;
  /** "shell" works everywhere; otherwise the place that owns it. */
  scope: "shell" | "chats" | "settings" | "inbox";
  /** For a digit range (Cmd-1..9) the lowest and highest digit. */
  digits?: readonly [number, number];
  /** A key of the focused list (a row's P or U), not a shell key: it is in this table so Settings and the help list it, and the list's own handler runs it. */
  local?: true;
}

export const KEYBOARD_MAP: readonly Shortcut[] = [
  { id: "cmdk.open", combo: "Cmd-K", title: "Search", scope: "shell" },
  { id: "tab.new", combo: "Cmd-T", title: "New tab", scope: "shell" },
  { id: "agent.jump", combo: "Cmd-1", title: "Jump to a starred agent", scope: "chats", digits: [1, 9] },
  { id: "space.switch", combo: "Shift-Cmd-1", title: "Switch Space", scope: "shell", digits: [1, 3] },
  { id: "star.toggle", combo: "Cmd-D", title: "Star", scope: "shell" },
  { id: "softphone.open", combo: "Cmd-Shift-K", title: "Softphone", scope: "shell" },
  { id: "settings.find", combo: "Cmd-F", title: "Find a Settings row", scope: "settings" },
  { id: "unread.next", combo: "Alt-Down", title: "Next unread", scope: "inbox" },
  { id: "report.open", combo: "Cmd-Shift-/", title: "Report a problem", scope: "shell" },
  // The Chats sidebar (design of 13 Nov): the places on Option-Cmd-1..5, the six things in the "+" menu, hide, next unread, and the keys of a focused row
  {
    id: "place.go",
    combo: "Alt-Cmd-1",
    title: "Go to a place: Chats, Inbox, Records, Files, Automations",
    scope: "shell",
    digits: [1, 5],
  },
  { id: "chat.new", combo: "Cmd-N", title: "New chat", scope: "shell" },
  { id: "chat.newgroup", combo: "Shift-Cmd-N", title: "New group chat", scope: "shell" },
  { id: "channel.new", combo: "Alt-Cmd-N", title: "New channel", scope: "shell" },
  { id: "goal.new", combo: "Alt-Cmd-G", title: "New goal", scope: "shell" },
  { id: "task.new", combo: "Alt-Cmd-T", title: "New task", scope: "shell" },
  { id: "note.new", combo: "Alt-Cmd-O", title: "New note", scope: "shell" },
  { id: "sidebar.hide", combo: "Cmd-Shift-\\", title: "Hide or show the sidebar", scope: "shell" },
  { id: "chats.unread.next", combo: "Alt-Shift-Down", title: "Next unread chat", scope: "chats" },
  { id: "chats.unread.prev", combo: "Alt-Shift-Up", title: "Previous unread chat", scope: "chats" },
  { id: "list.filter", combo: "F", title: "Filter the list (list focused)", scope: "chats", local: true },
  { id: "row.pin", combo: "P", title: "Pin or unpin the row (list focused)", scope: "chats", local: true },
  { id: "row.read", combo: "U", title: "Mark the row read or unread (list focused)", scope: "chats", local: true },
  { id: "row.mute", combo: "M", title: "Mute or unmute the row (list focused)", scope: "chats", local: true },
  { id: "row.archive", combo: "E", title: "Archive the row (list focused)", scope: "chats", local: true },
  { id: "row.rename", combo: "F2", title: "Rename the row (list focused)", scope: "chats", local: true },
  {
    id: "row.link",
    combo: "Shift-Cmd-C",
    title: "Copy the link of the row (list focused)",
    scope: "chats",
    local: true,
  },
];

export interface KeyLike {
  key: string;
  /** Physical key (Digit1): Shift-1 types "!" but is still the digit 1. */
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export interface Matched {
  id: string;
  /** The digit for Cmd-1..9 and Shift-Cmd-1..3 (1 based). */
  arg?: number;
}

const GLYPH: Record<string, string> = { Cmd: "⌘", Shift: "⇧", Alt: "⌥", Down: "↓", Up: "↑" };

/** Cmd-K as the person sees it: ⌘K on a Mac, Ctrl+K elsewhere. */
export function formatCombo(combo: string, platform: Platform): string {
  const parts = combo.split("-");
  if (platform === "mac") {
    const mods = parts.filter((p) => p === "Alt" || p === "Shift" || p === "Cmd");
    const rest = parts.filter((p) => !mods.includes(p));
    const order = ["Alt", "Shift", "Cmd"];
    return [
      ...order.filter((m) => mods.includes(m)).map((m) => GLYPH[m]),
      ...rest.map((r) => GLYPH[r] ?? r.toUpperCase()),
    ].join("");
  }
  const map = (p: string): string => (p === "Cmd" ? "Ctrl" : p);
  return parts.map((p) => (p === "Down" ? "Down" : map(p).length === 1 ? p.toUpperCase() : map(p))).join("+");
}

/** Which shortcut an event is, or null. `inTerminal`: Cmd-K clears a terminal (the shell skips it there). */
export function matchShortcut(e: KeyLike, platform: Platform, ctx: { inTerminal?: boolean } = {}): Matched | null {
  const mod = platform === "mac" ? e.metaKey === true : e.ctrlKey === true;
  const other = platform === "mac" ? e.ctrlKey === true : e.metaKey === true;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.altKey === true && !mod && !e.shiftKey && key === "ArrowDown") return { id: "unread.next" };
  if (e.altKey === true && !mod && e.shiftKey === true && (key === "ArrowDown" || key === "ArrowUp"))
    return { id: key === "ArrowDown" ? "chats.unread.next" : "chats.unread.prev" };
  if (!mod || other) return null;
  const shift = e.shiftKey === true,
    alt = e.altKey === true;
  // Option-Cmd: the physical key decides (on a Mac, Option changes the letter a key types)
  const letter = /^Key([A-Z])$/.exec(e.code ?? "")?.[1]?.toLowerCase() ?? (key.length === 1 ? key : "");
  if (alt) {
    if (shift) return null;
    const n = /^Digit([1-5])$/.exec(e.code ?? "")?.[1] ?? (/^[1-5]$/.test(key) ? key : null);
    if (n !== null) return { id: "place.go", arg: Number(n) };
    const byLetter: Record<string, string> = { n: "channel.new", g: "goal.new", t: "task.new", o: "note.new" };
    const id = byLetter[letter];
    return id ? { id } : null;
  }
  const digit = /^Digit([1-9])$/.exec(e.code ?? "")?.[1] ?? (/^[1-9]$/.test(key) ? key : null);
  if (digit !== null) {
    const n = Number(digit);
    if (shift) return n <= 3 ? { id: "space.switch", arg: n } : null;
    return { id: "agent.jump", arg: n };
  }
  if (shift) {
    if (key === "n" || letter === "n") return { id: "chat.newgroup" };
    if (key === "\\" || key === "|" || e.code === "Backslash") return { id: "sidebar.hide" };
    if (key === "k") return { id: "softphone.open" };
    if (key === "/" || key === "?") return { id: "report.open" };
    return null;
  }
  if (key === "k") return ctx.inTerminal ? null : { id: "cmdk.open" };
  if (key === "t") return { id: "tab.new" };
  if (key === "n") return { id: "chat.new" };
  if (key === "d") return { id: "star.toggle" };
  if (key === "f") return { id: "settings.find" };
  return null;
}

/** The map as rows for Settings > Keyboard. */
export function keyboardRows(
  platform: Platform,
): { id: string; title: string; keys: string; scope: Shortcut["scope"] }[] {
  return KEYBOARD_MAP.map((s) => {
    const keys = s.digits ? `${formatCombo(s.combo, platform)}…${s.digits[1]}` : formatCombo(s.combo, platform);
    return { id: s.id, title: s.title, keys, scope: s.scope };
  });
}
