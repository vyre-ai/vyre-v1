// The agent's desk (lane r42-computer, owner-approved 19 Nov): one surface that docks beside the chat, grows to a full view of about 95% of the window, or shrinks to a small live picture.
// It is the same surface in all three, so the live session never reloads when it changes shape. This file is its state machine and nothing else: no view, no network. Every transition is here, and
// the tests walk every state with every event (and random orders of them) to show there is never a dead end and a way out is always one press away.
//
//   closed  nothing is drawn
//   dock    a pane beside the chat (the chat narrows, stays readable)
//   full    about 95% of the window, the app dimmed behind it
//   mini    a small live picture over the chat
//
// `prev` is where full was opened from (dock or mini): Esc, a click outside and the shrink button go back there, so full is always a visit, never a place you are stuck in.
export type DeskMode = "closed" | "dock" | "full" | "mini";
export type DeskRoom = "browser" | "term" | "files";
export const ROOMS: readonly DeskRoom[] = ["browser", "term", "files"];

export interface DeskState {
  mode: DeskMode;
  /** The mode full was entered from; null outside full. */
  prev: "dock" | "mini" | null;
  room: DeskRoom;
}

export type DeskEvent =
  | { type: "open"; room?: DeskRoom; mode?: "dock" | "full" }
  | { type: "full" }
  | { type: "back" }
  | { type: "dock" }
  | { type: "minimise" }
  | { type: "close" }
  | { type: "room"; room: DeskRoom }
  | { type: "escape" }
  | { type: "scrim" }
  | { type: "toggle_full" };

export const CLOSED: DeskState = { mode: "closed", prev: null, room: "browser" };

/** The next state. Total: every event in every state answers a state, and an event that means nothing there answers the same state. */
export function deskStep(s: DeskState, e: DeskEvent): DeskState {
  switch (e.type) {
    case "open": {
      const room = e.room ?? (s.mode === "closed" ? "browser" : s.room);
      // opening something that is already shown changes nothing but the room; opening full from closed remembers dock as where Esc goes back to
      if (s.mode === "closed")
        return e.mode === "full" ? { mode: "full", prev: "dock", room } : { mode: "dock", prev: null, room };
      if (s.mode === "mini")
        return e.mode === "full" ? { mode: "full", prev: "mini", room } : { mode: "dock", prev: null, room };
      if (s.mode === "dock" && e.mode === "full") return { mode: "full", prev: "dock", room };
      return { ...s, room };
    }
    case "full":
      if (s.mode === "dock" || s.mode === "mini") return { ...s, mode: "full", prev: s.mode };
      return s;
    case "back":
      return s.mode === "full" ? { ...s, mode: s.prev ?? "dock", prev: null } : s;
    case "dock":
      return s.mode === "mini" || s.mode === "full" ? { ...s, mode: "dock", prev: null } : s;
    case "minimise":
      return s.mode === "dock" || s.mode === "full" ? { ...s, mode: "mini", prev: null } : s;
    case "close":
      return CLOSED;
    case "room":
      return s.mode === "closed" || s.mode === "mini" ? s : { ...s, room: e.room };
    case "escape":
      // Esc steps down one level: full goes back to where it came from, docked becomes the small picture; the small picture ignores it (it is not a place you are in), closed has nothing to leave
      if (s.mode === "full") return deskStep(s, { type: "back" });
      if (s.mode === "dock") return deskStep(s, { type: "minimise" });
      return s;
    case "scrim":
      // a press outside the full view goes back, the same as Esc from full; outside a dock or a mini picture it is an ordinary press on the app
      return s.mode === "full" ? deskStep(s, { type: "back" }) : s;
    case "toggle_full":
      return s.mode === "full" ? deskStep(s, { type: "back" }) : deskStep(s, { type: "full" });
  }
}

/** Is the desk drawn at all? */
export const shown = (s: DeskState): boolean => s.mode !== "closed";
/** Does the app behind it dim? Only the full view dims it. */
export const dimsApp = (s: DeskState): boolean => s.mode === "full";
/** Does the chat give up width to it? Only the dock. */
export const narrowsChat = (s: DeskState): boolean => s.mode === "dock";

/**
 * What the keys do, by key and what the desk is showing. `typing`: a text field has the keyboard; `holding`: the person holds the controls, so every key belongs to the page or the terminal (typing a t
 * or a space into a page must never pause or hand anything), and they leave with the buttons. Only while you watch do the keys act: F full view, Space pause or resume, T take over, S stop, Esc one step down.
 */
export type DeskKey = "f" | "space" | "t" | "s" | "escape";
export type KeyAction = "toggle_full" | "pause" | "take" | "stop" | "escape" | null;
export function keyAction(s: DeskState, key: DeskKey, o: { typing: boolean; holding: boolean }): KeyAction {
  if (s.mode === "closed" || o.holding) return null;
  if (key === "escape") return s.mode === "mini" ? null : "escape";
  if (s.mode === "mini" || o.typing) return null;
  if (key === "t") return "take";
  if (key === "f") return "toggle_full";
  if (key === "space") return "pause";
  return "stop";
}
