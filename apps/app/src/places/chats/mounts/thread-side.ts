// The thread beside its message (audit Threads 2, 8, 10): what the follow control says and offers, and the words of the Threads page rows. Pure, so a .ts test reads them.
import type { MenuEntry } from "../../../../../../ui/src/Menu/props.ts";

export type FollowMode = "follow" | "mute" | "none";

/** My standing in a thread, from its threads.list row (absent: not in it). */
export function modeOf(row: { following?: boolean | undefined; muted?: boolean | undefined } | undefined): FollowMode {
  if (row?.muted) return "mute";
  return row?.following ? "follow" : "none";
}

/** The control's words: what I am now. */
export function followLabel(m: FollowMode): string {
  return m === "follow" ? "Following" : m === "mute" ? "Muted" : "Follow";
}

/** Follow, Mute, Leave: the one menu the control and a Threads row share. `set` writes threads.follow. */
export function followMenu(m: FollowMode, set: (mode: "follow" | "mute" | "leave") => void): MenuEntry[] {
  return [
    { label: "Follow", checked: m === "follow", onSelect: () => set("follow") },
    { label: "Mute", checked: m === "mute", onSelect: () => set("mute") },
    ...(m === "none" ? [] : [{ separator: true } as MenuEntry, { label: "Leave Thread", onSelect: () => set("leave") }]),
  ];
}

/** What a follow change says on the line under the chat. */
export function followSaid(mode: "follow" | "mute" | "leave"): string {
  return mode === "follow" ? "Following this thread. Its replies reach you." : mode === "mute" ? "Muted. Its replies will not notify you or count as new." : "You left the thread.";
}

/** Escape closes the thread beside the chat, unless something on top took the key first (a menu, a sheet, the composer's own list). */
export function closesSide(e: { key: string; defaultPrevented?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }): boolean {
  return e.key === "Escape" && e.defaultPrevented !== true && !e.metaKey && !e.ctrlKey && !e.altKey;
}
