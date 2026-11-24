// The desk's state machine (desk-model.ts): every event in every state, the way back from full, the keys, and random orders of events that never reach a state without a way out.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CLOSED,
  ROOMS,
  deskStep,
  dimsApp,
  keyAction,
  keysMayAct,
  narrowsChat,
  needsShift,
  shown,
} from "./desk-model.ts";
import type { DeskEvent, DeskMode, DeskRoom, DeskState } from "./desk-model.ts";

const MODES: DeskMode[] = ["closed", "dock", "full", "mini"];
const EVENTS: DeskEvent[] = [
  { type: "open" },
  { type: "open", room: "term", mode: "full" },
  { type: "open", room: "files", mode: "dock" },
  { type: "full" },
  { type: "back" },
  { type: "dock" },
  { type: "minimise" },
  { type: "close" },
  { type: "room", room: "term" },
  { type: "room", room: "files" },
  { type: "escape" },
  { type: "scrim" },
  { type: "toggle_full" },
];
const states = (): DeskState[] => {
  const out: DeskState[] = [];
  for (const mode of MODES)
    for (const room of ROOMS) {
      if (mode === "full") for (const prev of ["dock", "mini"] as const) out.push({ mode, prev, room });
      else out.push({ mode, prev: null, room });
    }
  return out;
};
const valid = (s: DeskState): boolean =>
  MODES.includes(s.mode) &&
  ROOMS.includes(s.room) &&
  (s.mode === "full" ? s.prev === "dock" || s.prev === "mini" : s.prev === null);

test("every event in every state answers a valid state: prev is set exactly while full, and the room is always one of the three", () => {
  for (const s of states())
    for (const e of EVENTS) assert.ok(valid(deskStep(s, e)), `${JSON.stringify(s)} + ${JSON.stringify(e)}`);
});

test("full is a visit: Esc, a press outside, back and the toggle return to where it was opened from, with the same room", () => {
  for (const from of ["dock", "mini"] as const)
    for (const room of ROOMS) {
      const s: DeskState = { mode: from, prev: null, room };
      const f = deskStep(s, { type: "full" });
      assert.deepEqual(f, { mode: "full", prev: from, room });
      for (const e of [{ type: "escape" }, { type: "scrim" }, { type: "back" }, { type: "toggle_full" }] as DeskEvent[])
        assert.deepEqual(deskStep(f, e), s, `${from} ${room} ${e.type}`);
    }
});

test("Esc steps down one level only: full goes back, docked becomes the small picture, the small picture and closed ignore it", () => {
  assert.deepEqual(deskStep({ mode: "dock", prev: null, room: "term" }, { type: "escape" }), {
    mode: "mini",
    prev: null,
    room: "term",
  });
  const mini: DeskState = { mode: "mini", prev: null, room: "browser" };
  assert.deepEqual(deskStep(mini, { type: "escape" }), mini);
  assert.deepEqual(deskStep(CLOSED, { type: "escape" }), CLOSED);
  assert.deepEqual(deskStep({ mode: "full", prev: "mini", room: "files" }, { type: "escape" }), {
    mode: "mini",
    prev: null,
    room: "files",
  });
});

test("a press outside changes only the full view; closed means closed; the small picture is not switched between rooms", () => {
  for (const s of states()) {
    if (s.mode !== "full") assert.deepEqual(deskStep(s, { type: "scrim" }), s);
    assert.deepEqual(deskStep(CLOSED, { type: "room", room: "term" }), CLOSED);
  }
  const mini: DeskState = { mode: "mini", prev: null, room: "browser" };
  assert.deepEqual(deskStep(mini, { type: "room", room: "term" }), mini);
});

test("opening: from closed to dock or full (full remembers dock), from mini to dock or full (full remembers mini), when shown only the room changes unless it asks for full from dock", () => {
  assert.deepEqual(deskStep(CLOSED, { type: "open" }), { mode: "dock", prev: null, room: "browser" });
  assert.deepEqual(deskStep(CLOSED, { type: "open", room: "term", mode: "full" }), {
    mode: "full",
    prev: "dock",
    room: "term",
  });
  assert.deepEqual(deskStep({ mode: "mini", prev: null, room: "term" }, { type: "open" }), {
    mode: "dock",
    prev: null,
    room: "term",
  });
  assert.deepEqual(deskStep({ mode: "mini", prev: null, room: "term" }, { type: "open", mode: "full" }), {
    mode: "full",
    prev: "mini",
    room: "term",
  });
  assert.deepEqual(deskStep({ mode: "dock", prev: null, room: "term" }, { type: "open", room: "files" }), {
    mode: "dock",
    prev: null,
    room: "files",
  });
  assert.deepEqual(
    deskStep({ mode: "full", prev: "mini", room: "term" }, { type: "open", room: "files", mode: "dock" }),
    { mode: "full", prev: "mini", room: "files" },
  );
});

test("close from anywhere is closed and forgets where it was", () => {
  for (const s of states()) assert.deepEqual(deskStep(s, { type: "close" }), CLOSED);
});

test("what is drawn: the app dims only in full, the chat narrows only in the dock, nothing is drawn when closed", () => {
  for (const s of states()) {
    assert.equal(dimsApp(s), s.mode === "full");
    assert.equal(narrowsChat(s), s.mode === "dock");
    assert.equal(shown(s), s.mode !== "closed");
  }
});

test("no dead end: from every state, within two events, it can be closed, and within two it can reach every shown mode again", () => {
  for (const s of states()) {
    assert.deepEqual(deskStep(s, { type: "close" }), CLOSED);
    // and it can always be brought back to the dock and then to full and back
    const d = s.mode === "closed" ? deskStep(s, { type: "open" }) : deskStep(s, { type: "dock" });
    assert.equal(d.mode, "dock");
    assert.equal(deskStep(d, { type: "full" }).mode, "full");
    assert.equal(deskStep(deskStep(d, { type: "full" }), { type: "back" }).mode, "dock");
  }
});

test("random orders of events never reach an invalid state and Escape pressed enough always ends at the small picture or closed (never stuck in full)", () => {
  let seed = 7;
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  for (let run = 0; run < 400; run++) {
    let s: DeskState = CLOSED;
    for (let i = 0; i < 60; i++) {
      s = deskStep(s, EVENTS[rnd(EVENTS.length)]!);
      assert.ok(valid(s), JSON.stringify(s));
    }
    s = deskStep(deskStep(s, { type: "escape" }), { type: "escape" });
    assert.ok(s.mode === "mini" || s.mode === "closed", `after two Escapes: ${JSON.stringify(s)}`);
  }
});

test("keys: they act only while you watch; typing and holding the controls leave every letter to the field or the page; closed does nothing; the small picture takes none", () => {
  const dock: DeskState = { mode: "dock", prev: null, room: "browser" };
  const full: DeskState = { mode: "full", prev: "dock", room: "browser" };
  const mini: DeskState = { mode: "mini", prev: null, room: "browser" };
  const watch = { typing: false, holding: false };
  assert.equal(keyAction(dock, "f", watch), "toggle_full");
  assert.equal(keyAction(full, "space", watch), "pause");
  assert.equal(keyAction(full, "t", watch), "take");
  assert.equal(keyAction(full, "s", watch), "stop");
  assert.equal(keyAction(full, "escape", watch), "escape");
  assert.equal(keyAction(dock, "escape", watch), "escape");
  for (const k of ["f", "space", "t", "s", "escape"] as const) {
    assert.equal(keyAction(full, k, { typing: false, holding: true }), null, `${k} while holding belongs to the page`);
    assert.equal(keyAction(CLOSED, k, watch), null);
    assert.equal(keyAction(mini, k, watch), null);
    if (k !== "escape") assert.equal(keyAction(full, k, { typing: true, holding: false }), null, `${k} while typing`);
  }
  assert.equal(
    keyAction(full, "escape", { typing: true, holding: false }),
    "escape",
    "Esc leaves a text field's focus and still goes one step down",
  );
  const rooms: DeskRoom[] = [...ROOMS];
  assert.equal(rooms.length, 3);
});

test("a key press is the desk's only when nothing else has it: not a repeat, not composing, not already handled, not in a field or a control outside the desk, not under another dialog", () => {
  const ok = { active: "none", modalOpen: false, repeat: false, composing: false, prevented: false } as const;
  assert.equal(keysMayAct(ok), true);
  assert.equal(keysMayAct({ ...ok, active: "desk_control" }), true);
  for (const bad of [
    { repeat: true },
    { composing: true },
    { prevented: true },
    { modalOpen: true },
    { active: "field" },
    { active: "outside_control" },
  ] as const)
    assert.equal(keysMayAct({ ...ok, ...bad }), false, JSON.stringify(bad));
});
test("only Stop needs Shift: it ends the agent's work and cannot be taken back", () => {
  assert.equal(needsShift("s"), true);
  for (const k of ["f", "space", "t", "escape"] as const) assert.equal(needsShift(k), false);
});
