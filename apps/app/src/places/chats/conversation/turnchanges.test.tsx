// The "what this turn changed" card: a list with one Undo, the changes that cannot be taken back labelled so, and a quiet done state.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { TurnChangesCard, canUndo, isTurnChanges, turnChangesData, undoneLine } from "./turnchanges.tsx";
import type { BlockHost } from "../../../../../../ui/src/blocks/impl-a/index.tsx";

const block = (data: unknown) => ({ id: "b1", type: "turn_changes", v: 1, state: "done", traceId: "t", data }) as never;
const host = {} as BlockHost;
const data = {
  threadId: "thr_1", turnId: "trn_a1", agentId: "agt_1", summary: "2 changes made, 1 that can't be undone",
  changes: [{ label: "Edited Maya Chen (phone)", undoable: true }, { label: "Added intake.pdf", undoable: true }, { label: "Sent a message to Ian. This can't be undone", undoable: false }],
};

test("the data is read safely and Undo shows only while something can go back", () => {
  assert.equal(isTurnChanges({ type: "turn_changes" }), true);
  const d = turnChangesData(data);
  assert.equal(d.changes.length, 3);
  assert.equal(canUndo(d, false), true);
  assert.equal(canUndo(d, true), false);
  assert.equal(canUndo(turnChangesData({ ...data, changes: [{ label: "Sent", undoable: false }] }), false), false);
  assert.deepEqual(turnChangesData(null).changes, []);
});

test("the card shows one Undo and labels what cannot be undone", () => {
  const html = renderToStaticMarkup(<TurnChangesCard block={block(data)} host={host} />);
  assert.equal((html.match(/turnchanges-b1-undo/g) ?? []).length, 1);
  assert.match(html, /Edited Maya Chen/);
  assert.equal((html.match(/can&#x27;t be undone<\/div>|can't be undone<\/div>/g) ?? []).length >= 1, true);
  assert.match(html, /turnchanges-b1-fixed-2/);
  assert.doesNotMatch(html, /turnchanges-b1-fixed-0/);
});

test("an undone card has no Undo", () => {
  const html = renderToStaticMarkup(<TurnChangesCard block={block({ ...data, undone: true })} host={host} />);
  assert.doesNotMatch(html, /turnchanges-b1-undo/);
  assert.match(html, /Undone/);
});

test("the result line counts what went back and what did not", () => {
  assert.equal(undoneLine(2, []), "Undone: 2 changes put back.");
  assert.equal(undoneLine(1, ["x"]), "Undone: 1 change put back. 1 could not be put back.");
});
