// The Kanban's one move, as an explicit state machine. A card is moved by a drag, a key, a menu, a multi-select bar or an undo; all five go through this reducer, so a refusal, a second
// person moving the same card, or an Automation moving it mid-drag has one answer, and it is tested here without a renderer. No React, no clock, no calls: `step` returns the next state and
// the one effect the board must run (the move call, or nothing).
import type { MissingField } from "../journey/model.ts";

export type MoveVia = "drag" | "key" | "menu" | "bar" | "undo";

/** Who moved a card while this person held it. */
export interface Mover {
  kind: "person" | "automation";
  /** A name to show: a first name, or the Automation's name. */
  name: string;
}

export type MoveState =
  | { kind: "idle" }
  /** The card is lifted and follows the pointer; `over` is the lane under it, `blocked` the reason that lane would refuse (known before the drop), `moved` a remote move seen since the lift. */
  | {
      kind: "lifted";
      id: string;
      from: string;
      version: number;
      over: string | null;
      blocked: string | null;
      moved: { to: string; by: Mover } | null;
    }
  /** The call is out. `remote` is a move by someone else that arrived meanwhile; the server's answer decides, and the board says what happened. */
  | {
      kind: "committing";
      id: string;
      from: string;
      to: string;
      via: MoveVia;
      remote: { to: string; by: Mover } | null;
    }
  /** The stage wants fields first: the card shows its form in the lane it is going to. */
  | { kind: "needs"; id: string; from: string; to: string; via: MoveVia; missing: readonly MissingField[] }
  /** The move was refused; the reason sits on the card until the next action. The card is in `from`. */
  | { kind: "refused"; id: string; from: string; to: string; reason: string }
  /** Someone else moved the card first; it stays where they put it. */
  | { kind: "conflict"; id: string; by: Mover; at: string };

export type MoveEvent =
  | { t: "lift"; id: string; from: string; version: number }
  | { t: "over"; lane: string | null; blocked?: string | null }
  | { t: "drop" }
  | { t: "cancel" }
  /** The pointer let go of the card (a drag ended, wherever): a held card that was not dropped is put down; a move already out is left alone. */
  | { t: "release" }
  /** A move that never lifts: a key, a menu entry, the bar or an undo. `blocked` is what the stage is known to refuse. */
  | { t: "start"; id: string; from: string; to: string; via: MoveVia; blocked?: string | null }
  | { t: "ok" }
  | { t: "gate"; missing: readonly MissingField[] }
  | { t: "refuse"; reason: string }
  /** The copy shows `id` in `to` now, put there by someone or something that is not this person's current move. */
  | { t: "remote"; id: string; to: string; by: Mover }
  | { t: "fields-saved" }
  | { t: "fields-cancel" }
  | { t: "dismiss" };

export type MoveEffect =
  | { t: "move"; id: string; to: string; via: MoveVia; version?: number }
  /** The refusal to say aloud (a toast): the card keeps its reason on its face too. */
  | { t: "say"; text: string };

export interface Step {
  state: MoveState;
  effect?: MoveEffect;
}

export const IDLE: MoveState = { kind: "idle" };

/** The words for a card someone else moved while it was held or in flight. */
export function movedWords(by: Mover, toTitle: string): string {
  const who = by.kind === "automation" ? (by.name ? `The Automation ${by.name}` : "An Automation") : by.name;
  return `${who} moved it to ${toTitle} first. It stays there.`;
}

/** Whether a state holds this card (so the board draws it lifted, committing, with a form or with a reason). */
export function holds(s: MoveState, id: string): boolean {
  return s.kind !== "idle" && s.id === id;
}

/** The lane to draw a card in while this state holds it: a card waiting on fields is shown where it is going. */
export function drawnIn(s: MoveState, id: string, actual: string): string {
  if (!holds(s, id)) return actual;
  if (s.kind === "needs") return s.to;
  if (s.kind === "committing") return s.to;
  return actual;
}

export function step(s: MoveState, e: MoveEvent): Step {
  switch (e.t) {
    case "lift":
      // a lift while another move is out is ignored: one move at a time per board
      if (s.kind === "committing" || s.kind === "needs") return { state: s };
      return {
        state: { kind: "lifted", id: e.id, from: e.from, version: e.version, over: null, blocked: null, moved: null },
      };
    case "over":
      if (s.kind !== "lifted") return { state: s };
      return { state: { ...s, over: e.lane, blocked: e.lane ? (e.blocked ?? null) : null } };
    case "cancel":
      return s.kind === "lifted" || s.kind === "refused" || s.kind === "conflict" ? { state: IDLE } : { state: s };
    case "release":
      return s.kind === "lifted" ? { state: IDLE } : { state: s };
    case "dismiss":
      return s.kind === "refused" || s.kind === "conflict" ? { state: IDLE } : { state: s };
    case "drop": {
      if (s.kind !== "lifted") return { state: s };
      // dropped on nothing, or back where it came from: nothing happens
      if (!s.over || s.over === s.from) return { state: IDLE };
      // someone (or an Automation) moved it while it was held: it stays where they put it, whatever lane it was dropped on
      if (s.moved) {
        return { state: { kind: "conflict", id: s.id, by: s.moved.by, at: s.moved.to } };
      }
      if (s.blocked) {
        return {
          state: { kind: "refused", id: s.id, from: s.from, to: s.over, reason: s.blocked },
          effect: { t: "say", text: s.blocked },
        };
      }
      return {
        state: { kind: "committing", id: s.id, from: s.from, to: s.over, via: "drag", remote: null },
        effect: { t: "move", id: s.id, to: s.over, via: "drag", version: s.version },
      };
    }
    case "start": {
      if (s.kind === "committing" || s.kind === "needs") return { state: s };
      if (e.from === e.to) return { state: IDLE };
      if (e.blocked)
        return {
          state: { kind: "refused", id: e.id, from: e.from, to: e.to, reason: e.blocked },
          effect: { t: "say", text: e.blocked },
        };
      return {
        state: { kind: "committing", id: e.id, from: e.from, to: e.to, via: e.via, remote: null },
        effect: { t: "move", id: e.id, to: e.to, via: e.via },
      };
    }
    case "remote": {
      if (s.kind === "lifted" && s.id === e.id) return { state: { ...s, moved: { to: e.to, by: e.by } } };
      if (s.kind === "committing" && s.id === e.id && e.to !== s.to)
        return { state: { ...s, remote: { to: e.to, by: e.by } } };
      // the name of whoever moved it arrives after the refusal was drawn: the same conflict, now with their name
      if (s.kind === "conflict" && s.id === e.id) return { state: { ...s, by: e.by, at: e.to } };
      // a card waiting on fields that someone moved elsewhere: the form is moot
      if (s.kind === "needs" && s.id === e.id && e.to !== s.to)
        return { state: { kind: "conflict", id: s.id, by: e.by, at: e.to } };
      return { state: s };
    }
    case "ok":
      return s.kind === "committing" || s.kind === "needs" ? { state: IDLE } : { state: s };
    case "gate":
      if (s.kind !== "committing") return { state: s };
      return { state: { kind: "needs", id: s.id, from: s.from, to: s.to, via: s.via, missing: e.missing } };
    case "refuse":
      if (s.kind !== "committing" && s.kind !== "needs") return { state: s };
      // someone else's move landed first: say that, not the refusal of ours
      if (s.kind === "committing" && s.remote)
        return { state: { kind: "conflict", id: s.id, by: s.remote.by, at: s.remote.to } };
      return {
        state: { kind: "refused", id: s.id, from: s.from, to: s.to, reason: e.reason },
        effect: { t: "say", text: e.reason },
      };
    case "fields-saved":
      if (s.kind !== "needs") return { state: s };
      return {
        state: { kind: "committing", id: s.id, from: s.from, to: s.to, via: s.via, remote: null },
        effect: { t: "move", id: s.id, to: s.to, via: s.via },
      };
    case "fields-cancel":
      return s.kind === "needs" ? { state: IDLE } : { state: s };
  }
}

// ---------------------------------------------------------------- undo

/** One thing a person did that Z puts back: each card and the lane it came from. */
export interface Undoable {
  moves: readonly { id: string; from: string; to: string }[];
}
export const UNDO_DEPTH = 20;

export function pushUndo(stack: readonly Undoable[], u: Undoable): Undoable[] {
  return [...stack, u].slice(-UNDO_DEPTH);
}
export function popUndo(stack: readonly Undoable[]): { rest: Undoable[]; top: Undoable | null } {
  if (stack.length === 0) return { rest: [], top: null };
  return { rest: stack.slice(0, -1), top: stack[stack.length - 1]! };
}
