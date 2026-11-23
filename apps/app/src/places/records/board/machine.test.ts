// The Kanban move machine: the five ways a card moves, and the three failures that must have one answer each (two people on one card, a refusal after the lift, an Automation moving the card
// during a drag), checked without a renderer.
import test from "node:test";
import assert from "node:assert/strict";
import { IDLE, drawnIn, holds, movedWords, popUndo, pushUndo, step, UNDO_DEPTH } from "./machine.ts";
import type { MoveEvent, MoveState } from "./machine.ts";

const run = (events: MoveEvent[], from: MoveState = IDLE) => {
  let state = from;
  const effects: unknown[] = [];
  for (const e of events) {
    const r = step(state, e);
    state = r.state;
    if (r.effect) effects.push(r.effect);
  }
  return { state, effects };
};
const lift = (id = "c1", from = "lead"): MoveEvent => ({ t: "lift", id, from, version: 3 });
const MAYA = { kind: "person", name: "Maya" } as const;
const AUTO = { kind: "automation", name: "Send the agreement" } as const;

test("a drag: lift, hover, drop commits one move with the version it was lifted at", () => {
  const { state, effects } = run([lift(), { t: "over", lane: "prop" }, { t: "drop" }]);
  assert.equal(state.kind, "committing");
  assert.deepEqual(effects, [{ t: "move", id: "c1", to: "prop", via: "drag", version: 3 }]);
  assert.equal(run([{ t: "ok" }], state).state.kind, "idle");
});

test("dropped on nothing, on its own lane, or cancelled: nothing is called", () => {
  assert.deepEqual(run([lift(), { t: "over", lane: null }, { t: "drop" }]).effects, []);
  assert.deepEqual(run([lift(), { t: "over", lane: "lead" }, { t: "drop" }]).effects, []);
  const c = run([lift(), { t: "over", lane: "prop" }, { t: "cancel" }]);
  assert.equal(c.state.kind, "idle");
  assert.deepEqual(c.effects, []);
});

test("a lane known to refuse says why before the drop and calls nothing", () => {
  const r = run([lift(), { t: "over", lane: "sign", blocked: "Needs a signed agreement." }, { t: "drop" }]);
  assert.equal(r.state.kind, "refused");
  assert.deepEqual(r.effects, [{ t: "say", text: "Needs a signed agreement." }]);
  // moving off the blocked lane clears the block
  const s = run([lift(), { t: "over", lane: "sign", blocked: "x" }, { t: "over", lane: "prop" }]).state;
  assert.equal(s.kind === "lifted" && s.blocked, null);
});

test("a refusal that arrives after the drop (a gate that changed mid-drag) puts the reason on the card", () => {
  const r = run([
    lift(),
    { t: "over", lane: "sign" },
    { t: "drop" },
    { t: "refuse", reason: "Needs a signed agreement." },
  ]);
  assert.equal(r.state.kind, "refused");
  assert.equal(r.state.kind === "refused" && r.state.from, "lead");
  assert.equal(drawnIn(r.state, "c1", "lead"), "lead");
  assert.equal(run([{ t: "dismiss" }], r.state).state.kind, "idle");
});

test("two people move one card: if it moved while held, the drop never overwrites it", () => {
  const r = run([lift(), { t: "over", lane: "prop" }, { t: "remote", id: "c1", to: "qual", by: MAYA }, { t: "drop" }]);
  assert.equal(r.state.kind, "conflict");
  assert.deepEqual(r.effects, []);
  assert.equal(r.state.kind === "conflict" && r.state.at, "qual");
  assert.equal(movedWords(MAYA, "Qualified"), "Maya moved it to Qualified first. It stays there.");
});

test("two people move one card: a move that lands while ours is in flight wins when ours is refused", () => {
  const r = run([
    lift(),
    { t: "over", lane: "prop" },
    { t: "drop" },
    { t: "remote", id: "c1", to: "qual", by: MAYA },
    { t: "refuse", reason: "Could not move it. Try again." },
  ]);
  assert.equal(r.state.kind, "conflict");
  assert.equal(r.state.kind === "conflict" && r.state.by.name, "Maya");
});

test("an Automation moves the card during the drag: same rule, said with the Automation's name", () => {
  const r = run([lift(), { t: "over", lane: "prop" }, { t: "remote", id: "c1", to: "sign", by: AUTO }, { t: "drop" }]);
  assert.equal(r.state.kind, "conflict");
  assert.equal(r.state.kind === "conflict" && r.state.by.kind, "automation");
  assert.match(movedWords(AUTO, "Signing"), /^The Automation Send the agreement moved it to Signing first/);
  assert.equal(
    movedWords({ kind: "automation", name: "" }, "Signing"),
    "An Automation moved it to Signing first. It stays there.",
  );
});

test("a remote move of another card, or when idle, changes nothing", () => {
  assert.equal(run([{ t: "remote", id: "c9", to: "qual", by: MAYA }]).state.kind, "idle");
  const s = run([lift(), { t: "remote", id: "c9", to: "qual", by: MAYA }]).state;
  assert.equal(s.kind === "lifted" && s.moved, null);
});

test("a stage that wants fields: the card is drawn in the new lane with its form; saving moves it, cancelling leaves it", () => {
  const need = [{ key: "amount", title: "Amount", stage: "prop", when: "enter" as const }];
  const g = run([
    { t: "start", id: "c4", from: "qual", to: "prop", via: "key" },
    { t: "gate", missing: need },
  ]);
  assert.equal(g.state.kind, "needs");
  assert.equal(drawnIn(g.state, "c4", "qual"), "prop");
  const saved = run([{ t: "fields-saved" }], g.state);
  assert.deepEqual(saved.effects, [{ t: "move", id: "c4", to: "prop", via: "key" }]);
  const again = run([{ t: "gate", missing: need }], saved.state);
  assert.equal(again.state.kind, "needs", "a second gate asks again");
  const off = run([{ t: "fields-cancel" }], g.state);
  assert.equal(off.state.kind, "idle");
  assert.equal(drawnIn(off.state, "c4", "qual"), "qual");
});

test("a card waiting on fields that someone else moved: the form is dropped and the move is theirs", () => {
  const g = run([
    { t: "start", id: "c4", from: "qual", to: "prop", via: "menu" },
    { t: "gate", missing: [] },
    { t: "remote", id: "c4", to: "lead", by: MAYA },
  ]);
  assert.equal(g.state.kind, "conflict");
});

test("key, menu, bar and undo moves start without a lift; the same lane is a no-op; a known block is refused without a call", () => {
  for (const via of ["key", "menu", "bar", "undo"] as const) {
    const r = run([{ t: "start", id: "c1", from: "lead", to: "qual", via }]);
    assert.deepEqual(r.effects, [{ t: "move", id: "c1", to: "qual", via }]);
  }
  assert.deepEqual(run([{ t: "start", id: "c1", from: "lead", to: "lead", via: "key" }]).effects, []);
  const b = run([{ t: "start", id: "c1", from: "lead", to: "sign", via: "key", blocked: "No." }]);
  assert.equal(b.state.kind, "refused");
});

test("one move at a time: a lift or start while a move is out is ignored", () => {
  const out = run([{ t: "start", id: "c1", from: "lead", to: "qual", via: "key" }]).state;
  assert.equal(run([lift("c2")], out).state, out);
  assert.deepEqual(run([{ t: "start", id: "c2", from: "lead", to: "qual", via: "menu" }], out).effects, [
    { t: "say", text: "One move at a time. Try again in a moment." },
  ]);
});

test("holds tells the board which card the machine has", () => {
  const s = run([lift()]).state;
  assert.equal(holds(s, "c1"), true);
  assert.equal(holds(s, "c2"), false);
});

test("undo keeps the last 20 and gives them back newest first", () => {
  let stack: ReturnType<typeof pushUndo> = [];
  for (let i = 0; i < UNDO_DEPTH + 5; i++) stack = pushUndo(stack, { moves: [{ id: `c${i}`, from: "a", to: "b" }] });
  assert.equal(stack.length, UNDO_DEPTH);
  const p = popUndo(stack);
  assert.equal(p.top?.moves[0]?.id, `c${UNDO_DEPTH + 4}`);
  assert.equal(p.rest.length, UNDO_DEPTH - 1);
  assert.equal(popUndo([]).top, null);
});

test("the end of a drag puts a held card down, and leaves a move that is out, or a reason on a card, alone", () => {
  assert.equal(run([lift(), { t: "release" }]).state.kind, "idle");
  const out = run([lift(), { t: "over", lane: "prop" }, { t: "drop" }, { t: "release" }]).state;
  assert.equal(out.kind, "committing");
  const refused = run([lift(), { t: "over", lane: "sign", blocked: "No." }, { t: "drop" }, { t: "release" }]).state;
  assert.equal(refused.kind, "refused");
});

test("the mover's name that arrives after the conflict was drawn fills it in", () => {
  const r = run([
    lift(),
    { t: "over", lane: "prop" },
    { t: "remote", id: "c1", to: "qual", by: { kind: "person", name: "Someone" } },
    { t: "drop" },
    { t: "remote", id: "c1", to: "qual", by: MAYA },
  ]);
  assert.equal(r.state.kind === "conflict" && r.state.by.name, "Maya");
});

test("a call that never answers frees the board; a stage that asks for fields after someone else moved the card is a conflict; a drop on nothing still tells of a remote move", () => {
  const out = run([{ t: "start", id: "c1", from: "lead", to: "qual", via: "key" }, { t: "timeout" }]);
  assert.equal(out.state.kind, "refused");
  assert.equal(run([lift("c2")], out.state).state.kind, "lifted", "free again after the card's reason is shown");
  const g = run([
    { t: "start", id: "c1", from: "lead", to: "qual", via: "key" },
    { t: "remote", id: "c1", to: "prop", by: MAYA },
    { t: "gate", missing: [] },
  ]);
  assert.equal(g.state.kind, "conflict");
  const nothing = run([
    lift(),
    { t: "remote", id: "c1", to: "qual", by: MAYA },
    { t: "over", lane: null },
    { t: "drop" },
  ]);
  assert.equal(nothing.state.kind, "conflict");
  const back = run([lift(), { t: "remote", id: "c1", to: "lead", by: MAYA }, { t: "over", lane: null }, { t: "drop" }]);
  assert.equal(back.state.kind, "idle", "a move that ended where it began is not a conflict");
  const busy = run(
    [{ t: "start", id: "c2", from: "lead", to: "qual", via: "bar" }],
    run([{ t: "start", id: "c1", from: "lead", to: "qual", via: "key" }]).state,
  );
  assert.deepEqual(busy.effects, [{ t: "say", text: "One move at a time. Try again in a moment." }]);
});
