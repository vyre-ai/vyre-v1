// The shell's keyboard map (spec 3.0 Keyboard): the keys the shell itself owns. Cmd-1..9 belong to Chats (starred agents) and are not here.
// Ctrl stands in for Cmd off the Mac. The function is pure so the map is tested without a window.

export interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export type ShellKey =
  | { type: "space"; index: number }
  | { type: "new-tab" }
  | { type: "close-tab" }
  | { type: "search" }
  | { type: "report" };

/** Which shell command a key press is, or null when the shell leaves it alone. */
export function shellKey(e: KeyLike): ShellKey | null {
  const mod = e.metaKey === true || e.ctrlKey === true;
  if (!mod || e.altKey === true) return null;
  const k = e.key.toLowerCase();
  if (e.shiftKey === true) {
    if (k === "1" || k === "2" || k === "3" || k === "!" || k === "@" || k === "#") return { type: "space", index: k === "1" || k === "!" ? 0 : k === "2" || k === "@" ? 1 : 2 };
    if (k === "/" || k === "?") return { type: "report" };
    return null;
  }
  if (k === "t") return { type: "new-tab" };
  if (k === "w") return { type: "close-tab" };
  if (k === "k") return { type: "search" };
  return null;
}

/** The keys as the menus and tooltips print them, in one place so the documented table and the handler agree. */
export const SHELL_KEYS: readonly { keys: string; does: string }[] = [
  { keys: "Cmd-K", does: "Search everything" },
  { keys: "Cmd-T", does: "New tab" },
  { keys: "Cmd-W", does: "Close tab" },
  { keys: "Shift-Cmd-1..3", does: "Switch Space" },
  { keys: "Shift-Cmd-/", does: "Report a problem" },
];
